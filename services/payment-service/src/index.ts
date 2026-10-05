import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  AppError,
  authenticate,
  conflict,
  counter,
  enqueueOutbox,
  EventTypes,
  isOwnerOrAdmin,
  loadConfig,
  main,
  makeEvent,
  notFound,
  parse,
  badRequest,
  runService,
  TOPICS,
  withTx,
  type AuthorizePayment,
  type Logger,
  type PaymentAuthorized,
  type PaymentFailed,
  type PoolClient,
  type VoidPayment,
} from '@shopverse/common';
import { z } from 'zod';
import { hashRequest, resolveIdempotency } from './domain.js';
import { createGateway, type PaymentGateway } from './gateway.js';

const SOURCE = 'payment-service';
const config = loadConfig({
  PAYMENT_GATEWAY_API_KEY: z.string().optional(),
  PAYMENT_GATEWAY_LATENCY_MS: z.coerce.number().int().nonnegative().default(30),
});
const paymentsTotal = counter('payments_total', 'Payment authorizations', ['result']);

interface PaymentRow {
  id: string;
  status: 'AUTHORIZED' | 'FAILED' | 'VOIDED';
  amount_cents: string;
  gateway_ref: string | null;
  failure_reason: string | null;
}

async function emitOutcome(db: PoolClient, orderId: string, p: PaymentRow): Promise<void> {
  if (p.status === 'AUTHORIZED') {
    const data: PaymentAuthorized = { orderId, paymentId: p.id, amountCents: Number(p.amount_cents) };
    await enqueueOutbox(db, TOPICS.payments, makeEvent(SOURCE, EventTypes.PaymentAuthorized, data, orderId));
  } else {
    const data: PaymentFailed = { orderId, reason: p.failure_reason ?? (p.status === 'VOIDED' ? 'payment voided' : 'payment failed') };
    await enqueueOutbox(db, TOPICS.payments, makeEvent(SOURCE, EventTypes.PaymentFailed, data, orderId));
  }
}

/** Saga step: authorize exactly once per order (order_id is unique; replays re-emit the stored outcome). */
async function handleAuthorize(db: PoolClient, gateway: PaymentGateway, cmd: AuthorizePayment, log: Logger): Promise<void> {
  const existing = await db.query<PaymentRow>('SELECT id, status, amount_cents, gateway_ref, failure_reason FROM payments WHERE order_id = $1 FOR UPDATE', [cmd.orderId]);
  if (existing.rows[0]) {
    log.info({ orderId: cmd.orderId, status: existing.rows[0].status }, 'duplicate AuthorizePayment, re-emitting outcome');
    return emitOutcome(db, cmd.orderId, existing.rows[0]);
  }
  const result = await gateway.authorize({ idempotencyKey: `order:${cmd.orderId}`, amountCents: cmd.amountCents, currency: cmd.currency, token: cmd.paymentToken });
  const row: PaymentRow = {
    id: randomUUID(),
    status: result.approved ? 'AUTHORIZED' : 'FAILED',
    amount_cents: String(cmd.amountCents),
    gateway_ref: result.ref,
    failure_reason: result.approved ? null : (result.reason ?? 'declined'),
  };
  await db.query(
    'INSERT INTO payments (id, order_id, user_id, amount_cents, currency, status, gateway_ref, failure_reason) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [row.id, cmd.orderId, cmd.userId, cmd.amountCents, cmd.currency, row.status, row.gateway_ref, row.failure_reason],
  );
  paymentsTotal.inc({ result: result.approved ? 'authorized' : 'failed' });
  await emitOutcome(db, cmd.orderId, row);
}

/** Compensation: void an authorization, or leave a VOIDED tombstone so a late AuthorizePayment fails. */
async function handleVoid(db: PoolClient, gateway: PaymentGateway, cmd: VoidPayment): Promise<void> {
  const existing = await db.query<PaymentRow>('SELECT id, status, amount_cents, gateway_ref, failure_reason FROM payments WHERE order_id = $1 FOR UPDATE', [cmd.orderId]);
  const p = existing.rows[0];
  if (!p) {
    await db.query(
      "INSERT INTO payments (id, order_id, user_id, amount_cents, status, failure_reason) VALUES ($1, $2, 'system', 0, 'VOIDED', $3) ON CONFLICT (order_id) DO NOTHING",
      [randomUUID(), cmd.orderId, `voided before authorization: ${cmd.reason}`],
    );
    return;
  }
  if (p.status !== 'AUTHORIZED') return;
  if (p.gateway_ref) await gateway.void(p.gateway_ref);
  await db.query("UPDATE payments SET status = 'VOIDED', failure_reason = $2, updated_at = now() WHERE id = $1", [p.id, cmd.reason]);
  paymentsTotal.inc({ result: 'voided' });
  await enqueueOutbox(db, TOPICS.payments, makeEvent(SOURCE, EventTypes.PaymentVoided, { orderId: cmd.orderId, paymentId: p.id }, cmd.orderId));
}

const authorizeSchema = z.object({
  orderId: z.uuid().optional(),
  amountCents: z.number().int().positive().max(100_000_000),
  currency: z.string().length(3).default('INR'),
  paymentToken: z.string().min(1).max(200),
});

const gateway = createGateway(config.PAYMENT_GATEWAY_API_KEY, config.PAYMENT_GATEWAY_LATENCY_MS);

main(() =>
  runService({
    config,
    migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
    kafka: true,
    outbox: true,
    consumer: {
      topics: [TOPICS.paymentsCommands],
      idempotency: 'db',
      handler: async (evt, { db, log }) => {
        if (evt.type === EventTypes.AuthorizePayment) return handleAuthorize(db!, gateway, evt.data as AuthorizePayment, log);
        if (evt.type === EventTypes.VoidPayment) return handleVoid(db!, gateway, evt.data as VoidPayment);
        log.warn('unknown payments command ignored');
      },
    },
    routes: (app, { pool, verifyToken }) => {
      const db = pool!;
      const auth = authenticate(verifyToken);

      // Direct (non-saga) authorization API protected by Idempotency-Key semantics.
      app.post('/api/v1/payments/authorize', { preHandler: auth }, async (req, reply) => {
        const key = req.headers['idempotency-key'];
        if (typeof key !== 'string' || key.length < 8 || key.length > 100) throw badRequest('Idempotency-Key header (8-100 chars) is required');
        const body = parse(authorizeSchema, req.body);
        const userId = req.user!.sub;
        const requestHash = hashRequest(body);
        const inserted = await db.query(
          'INSERT INTO idempotency_keys (user_id, key, request_hash) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [userId, key, requestHash],
        );
        if (inserted.rowCount === 0) {
          const { rows } = await db.query('SELECT request_hash, status_code, response FROM idempotency_keys WHERE user_id = $1 AND key = $2', [userId, key]);
          const decision = resolveIdempotency(rows[0] && { requestHash: rows[0].request_hash, statusCode: rows[0].status_code, response: rows[0].response }, requestHash);
          if (decision.action === 'replay') return reply.code(decision.statusCode).header('idempotent-replayed', 'true').send(decision.response);
          if (decision.action === 'conflict') throw new AppError(422, 'IDEMPOTENCY_KEY_REUSED', decision.message);
          if (decision.action === 'in_progress') throw conflict('a request with this Idempotency-Key is still in progress');
        }
        try {
          const result = await gateway.authorize({ idempotencyKey: `${userId}:${key}`, amountCents: body.amountCents, currency: body.currency, token: body.paymentToken });
          const id = randomUUID();
          const status = result.approved ? 'AUTHORIZED' : 'FAILED';
          const response = { paymentId: id, status, gatewayRef: result.ref, reason: result.reason ?? null, amountCents: body.amountCents, currency: body.currency };
          const statusCode = result.approved ? 201 : 402;
          await withTx(db, async (tx) => {
            await tx.query(
              'INSERT INTO payments (id, order_id, user_id, amount_cents, currency, status, gateway_ref, failure_reason) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
              [id, body.orderId ?? null, userId, body.amountCents, body.currency, status, result.ref, result.reason ?? null],
            );
            await tx.query('UPDATE idempotency_keys SET status_code = $3, response = $4 WHERE user_id = $1 AND key = $2', [userId, key, statusCode, JSON.stringify(response)]);
          });
          paymentsTotal.inc({ result: result.approved ? 'authorized' : 'failed' });
          return reply.code(statusCode).send(response);
        } catch (err) {
          // Let the client retry with the same key after a transient failure.
          await db.query('DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2 AND status_code IS NULL', [userId, key]);
          if ((err as { code?: string }).code === '23505') throw conflict('a payment already exists for this order');
          throw err;
        }
      });

      app.get('/api/v1/payments/orders/:orderId', { preHandler: auth }, async (req) => {
        const { orderId } = parse(z.object({ orderId: z.uuid() }), req.params);
        const { rows } = await db.query('SELECT id, order_id, user_id, amount_cents, currency, status, failure_reason, created_at, updated_at FROM payments WHERE order_id = $1', [orderId]);
        const p = rows[0];
        if (!p || !isOwnerOrAdmin(req.user, p.user_id)) throw notFound('payment');
        return { paymentId: p.id, orderId: p.order_id, amountCents: Number(p.amount_cents), currency: p.currency, status: p.status, failureReason: p.failure_reason, createdAt: p.created_at, updatedAt: p.updated_at };
      });
    },
  }),
);
