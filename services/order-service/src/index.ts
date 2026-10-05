import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  authenticate,
  createHttpClient,
  enqueueOutbox,
  EventTypes,
  isOwnerOrAdmin,
  loadConfig,
  main,
  makeEvent,
  notFound,
  parse,
  runService,
  startLoop,
  TOPICS,
  unprocessable,
  UpstreamError,
  withTx,
  type OrderCreated,
  type ReserveStock,
} from '@shopverse/common';
import { z } from 'zod';
import { applySagaEvent, ordersCreated, SOURCE, sweepTimedOutSagas } from './orchestrator.js';
import { applyDiscount, priceLines, PricingError, type CatalogProduct } from './pricing.js';
import { toSagaEvent } from './saga.js';

const config = loadConfig({
  CATALOG_URL: z.string().default('http://catalog-service.shop:8080'),
  PROMOTION_URL: z.string().default('http://promotion-service.shop:8080'),
  SAGA_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  /** Alias used by the GitOps values; wins over SAGA_TIMEOUT_MS when set. */
  SAGA_TIMEOUT_SECONDS: z.coerce.number().int().positive().optional(),
  SAGA_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(15_000),
});

const sagaTimeoutMs = config.SAGA_TIMEOUT_SECONDS ? config.SAGA_TIMEOUT_SECONDS * 1000 : config.SAGA_TIMEOUT_MS;

const addressSchema = z.object({
  name: z.string().min(1).max(120),
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(1).max(100),
  state: z.string().min(1).max(100),
  postalCode: z.string().min(3).max(12),
  country: z.string().length(2),
  phone: z.string().max(20).optional(),
});

const createOrderSchema = z.object({
  items: z.array(z.object({ productId: z.uuid(), quantity: z.number().int().min(1).max(100) })).min(1).max(50),
  couponCode: z.string().min(1).max(40).optional(),
  paymentToken: z.string().min(1).max(200),
  shippingAddress: addressSchema,
});

main(() =>
  runService({
    config,
    migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
    kafka: true,
    outbox: true,
    consumer: {
      topics: [TOPICS.inventory, TOPICS.payments],
      idempotency: 'db',
      handler: async (evt, { db, log }) => {
        const sagaEvent = toSagaEvent(evt.type, evt.data as Record<string, unknown>);
        if (!sagaEvent) return; // StockReleased, StockCommitted, PaymentVoided: informational
        const orderId = String((evt.data as { orderId?: string }).orderId ?? evt.correlationId);
        await applySagaEvent(db!, orderId, sagaEvent, log);
      },
    },
    background: ({ pool, log }) => [
      startLoop('saga-timeout-sweeper', config.SAGA_SWEEP_INTERVAL_MS, async () => {
        const n = await sweepTimedOutSagas(pool!, log);
        if (n) log.warn({ count: n }, 'compensated timed-out sagas');
      }, (err) => log.error({ err }, 'saga sweeper failed')),
    ],
    routes: (app, { pool, verifyToken }) => {
      const db = pool!;
      const auth = authenticate(verifyToken);
      const catalog = createHttpClient('catalog-service', config.CATALOG_URL);
      const promotions = createHttpClient('promotion-service', config.PROMOTION_URL);

      app.post('/api/v1/orders', { preHandler: auth }, async (req, reply) => {
        const user = req.user!;
        const body = parse(createOrderSchema, req.body);
        const idempotencyKey = (req.headers['idempotency-key'] as string | undefined)?.slice(0, 100);
        if (idempotencyKey) {
          const existing = await db.query('SELECT id, status, total_cents FROM orders WHERE user_id = $1 AND idempotency_key = $2', [user.sub, idempotencyKey]);
          if (existing.rows[0]) {
            const o = existing.rows[0];
            return reply.code(200).send({ orderId: o.id, status: o.status, totalCents: Number(o.total_cents), replayed: true });
          }
        }
        const authz = { authorization: `Bearer ${user.token}` };
        const ids = [...new Set(body.items.map((i) => i.productId))];
        const { items: products } = await catalog.request<{ items: CatalogProduct[] }>(`/api/v1/products?ids=${ids.join(',')}&limit=100`, { headers: authz });
        let priced;
        try {
          priced = priceLines(body.items, products);
        } catch (err) {
          if (err instanceof PricingError) throw unprocessable(err.message);
          throw err;
        }
        let discountCents = 0;
        if (body.couponCode) {
          try {
            const r = await promotions.request<{ discountCents: number }>('/api/v1/promotions/redeem', {
              method: 'POST',
              headers: authz,
              body: JSON.stringify({ code: body.couponCode, subtotalCents: priced.subtotalCents }),
            });
            discountCents = r.discountCents;
          } catch (err) {
            if (err instanceof UpstreamError && err.status < 500) throw unprocessable('coupon is not valid', err.body);
            throw err;
          }
        }
        const totalCents = applyDiscount(priced.subtotalCents, discountCents);
        const orderId = randomUUID();
        await withTx(db, async (tx) => {
          await tx.query(
            `INSERT INTO orders (id, user_id, user_email, status, subtotal_cents, discount_cents, total_cents, currency, coupon_code, shipping_address, idempotency_key)
             VALUES ($1, $2, $3, 'PENDING', $4, $5, $6, $7, $8, $9, $10)`,
            [orderId, user.sub, user.email ?? null, priced.subtotalCents, priced.subtotalCents - totalCents, totalCents, priced.currency, body.couponCode ?? null, JSON.stringify(body.shippingAddress), idempotencyKey ?? null],
          );
          for (const l of priced.lines) {
            await tx.query('INSERT INTO order_items (order_id, product_id, name, unit_price_cents, quantity) VALUES ($1, $2, $3, $4, $5)', [orderId, l.productId, l.name, l.unitPriceCents, l.quantity]);
          }
          await tx.query(
            `INSERT INTO saga_state (order_id, step, status, context, history, deadline_at)
             VALUES ($1, 'RESERVING_STOCK', 'RUNNING', $2, jsonb_build_array(jsonb_build_object('at', now(), 'event', 'OrderCreated', 'to', 'PENDING')), now() + ($3::int * interval '1 millisecond'))`,
            [orderId, JSON.stringify({ paymentToken: body.paymentToken }), sagaTimeoutMs],
          );
          const lines = priced.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPriceCents: l.unitPriceCents, name: l.name }));
          const created: OrderCreated = { orderId, userId: user.sub, items: lines, totalCents, currency: priced.currency };
          await enqueueOutbox(tx, TOPICS.orders, makeEvent(SOURCE, EventTypes.OrderCreated, created, orderId));
          const reserve: ReserveStock = { orderId, items: lines.map(({ productId, quantity }) => ({ productId, quantity })) };
          await enqueueOutbox(tx, TOPICS.inventoryCommands, makeEvent(SOURCE, EventTypes.ReserveStock, reserve, orderId));
        });
        ordersCreated.inc();
        return reply.code(202).header('location', `/api/v1/orders/${orderId}`).send({
          orderId,
          status: 'PENDING',
          subtotalCents: priced.subtotalCents,
          discountCents: priced.subtotalCents - totalCents,
          totalCents,
          currency: priced.currency,
        });
      });

      app.get('/api/v1/orders', { preHandler: auth }, async (req) => {
        const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }), req.query);
        const { rows } = await db.query(
          'SELECT id, status, total_cents, currency, created_at, updated_at, failure_reason FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
          [req.user!.sub, q.limit],
        );
        return {
          items: rows.map((o) => ({ orderId: o.id, status: o.status, totalCents: Number(o.total_cents), currency: o.currency, failureReason: o.failure_reason, createdAt: o.created_at, updatedAt: o.updated_at })),
        };
      });

      app.get('/api/v1/orders/:id', { preHandler: auth }, async (req) => {
        const { id } = parse(z.object({ id: z.uuid() }), req.params);
        const { rows } = await db.query(
          `SELECT o.*, s.step, s.status AS saga_status, s.history, s.deadline_at FROM orders o JOIN saga_state s ON s.order_id = o.id WHERE o.id = $1`,
          [id],
        );
        const o = rows[0];
        if (!o || !isOwnerOrAdmin(req.user, o.user_id)) throw notFound('order');
        const items = await db.query('SELECT product_id, name, unit_price_cents, quantity FROM order_items WHERE order_id = $1', [id]);
        return {
          orderId: o.id,
          userId: o.user_id,
          status: o.status,
          subtotalCents: Number(o.subtotal_cents),
          discountCents: Number(o.discount_cents),
          totalCents: Number(o.total_cents),
          currency: o.currency,
          couponCode: o.coupon_code,
          paymentId: o.payment_id,
          failureReason: o.failure_reason,
          shippingAddress: o.shipping_address,
          items: items.rows.map((i) => ({ productId: i.product_id, name: i.name, unitPriceCents: Number(i.unit_price_cents), quantity: i.quantity })),
          saga: { step: o.step, status: o.saga_status, deadlineAt: o.deadline_at, history: o.history },
          createdAt: o.created_at,
          updatedAt: o.updated_at,
        };
      });
    },
  }),
);
