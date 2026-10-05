import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  authenticate,
  counter,
  enqueueOutbox,
  EventTypes,
  isOwnerOrAdmin,
  loadConfig,
  main,
  makeEvent,
  notFound,
  parse,
  requireRole,
  runService,
  TOPICS,
  unprocessable,
  withTx,
  type OrderConfirmed,
  type ShipmentCreated,
  type ShipmentStatusChanged,
} from '@shopverse/common';
import { z } from 'zod';
import { canTransition, etaDate, pickCarrier, STATUSES, trackingNumber, type ShipmentStatus } from './domain.js';

const SOURCE = 'shipping-service';
const config = loadConfig();
const shipmentsCreated = counter('shipments_created_total', 'Shipments created');

const dto = (r: Record<string, unknown>) => ({
  shipmentId: r.id, orderId: r.order_id, userId: r.user_id, status: r.status, carrier: r.carrier, trackingNumber: r.tracking_number,
  eta: r.eta, address: r.address, items: r.items, history: r.history, createdAt: r.created_at, updatedAt: r.updated_at,
});

main(() =>
  runService({
    config,
    migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
    outbox: true,
    consumer: {
      topics: [TOPICS.orders],
      idempotency: 'db',
      handler: async (evt, { db, log }) => {
        if (evt.type !== EventTypes.OrderConfirmed) return;
        const o = evt.data as OrderConfirmed;
        const { carrier, days } = pickCarrier(o.shippingAddress.country, o.shippingAddress.postalCode);
        const id = randomUUID();
        const tn = trackingNumber(o.orderId);
        const r = await db!.query(
          `INSERT INTO shipments (id, order_id, user_id, status, carrier, tracking_number, address, items, eta, history)
           VALUES ($1, $2, $3, 'CREATED', $4, $5, $6, $7, $8, jsonb_build_array(jsonb_build_object('status', 'CREATED', 'at', now())))
           ON CONFLICT (order_id) DO NOTHING`,
          [id, o.orderId, o.userId, carrier, tn, JSON.stringify(o.shippingAddress), JSON.stringify(o.items), etaDate(new Date(), days)],
        );
        if (!r.rowCount) return;
        const data: ShipmentCreated = { shipmentId: id, orderId: o.orderId, userId: o.userId, carrier, trackingNumber: tn };
        await enqueueOutbox(db!, TOPICS.shipping, makeEvent(SOURCE, EventTypes.ShipmentCreated, data, o.orderId));
        shipmentsCreated.inc();
        log.info({ orderId: o.orderId, carrier }, 'shipment created');
      },
    },
    routes: (app, { pool, verifyToken }) => {
      const db = pool!;
      const auth = authenticate(verifyToken);

      app.get('/api/v1/shipping/orders/:orderId', { preHandler: auth }, async (req) => {
        const { orderId } = parse(z.object({ orderId: z.uuid() }), req.params);
        const { rows } = await db.query('SELECT * FROM shipments WHERE order_id = $1', [orderId]);
        if (!rows[0] || !isOwnerOrAdmin(req.user, rows[0].user_id)) throw notFound('shipment');
        return dto(rows[0]);
      });

      app.get('/api/v1/shipping/track/:trackingNumber', async (req) => {
        const { trackingNumber: tn } = parse(z.object({ trackingNumber: z.string().regex(/^SV[0-9A-F]{12}$/) }), req.params);
        const { rows } = await db.query('SELECT status, carrier, eta, history FROM shipments WHERE tracking_number = $1', [tn]);
        if (!rows[0]) throw notFound('shipment');
        return { trackingNumber: tn, status: rows[0].status, carrier: rows[0].carrier, eta: rows[0].eta, history: rows[0].history };
      });

      app.patch('/api/v1/shipping/:id/status', { preHandler: [auth, requireRole('admin')] }, async (req) => {
        const { id } = parse(z.object({ id: z.uuid() }), req.params);
        const { status } = parse(z.object({ status: z.enum(STATUSES) }), req.body);
        return withTx(db, async (tx) => {
          const { rows } = await tx.query('SELECT * FROM shipments WHERE id = $1 FOR UPDATE', [id]);
          const s = rows[0];
          if (!s) throw notFound('shipment');
          if (!canTransition(s.status as ShipmentStatus, status)) throw unprocessable(`cannot move shipment from ${s.status} to ${status}`);
          const upd = await tx.query(
            `UPDATE shipments SET status = $2, updated_at = now(), history = history || jsonb_build_array(jsonb_build_object('status', $2::text, 'at', now()))
             WHERE id = $1 RETURNING *`,
            [id, status],
          );
          const data: ShipmentStatusChanged = { shipmentId: id, orderId: s.order_id, userId: s.user_id, status };
          await enqueueOutbox(tx, TOPICS.shipping, makeEvent(SOURCE, EventTypes.ShipmentStatusChanged, data, s.order_id));
          return dto(upd.rows[0]);
        });
      });
    },
  }),
);
