import { fileURLToPath } from 'node:url';
import {
  authenticate,
  counter,
  enqueueOutbox,
  EventTypes,
  loadConfig,
  main,
  makeEvent,
  notFound,
  parse,
  requireRole,
  runService,
  SAMPLE_PRODUCTS,
  TOPICS,
  type PoolClient,
  type ReserveStock,
  type StockReservationFailed,
} from '@shopverse/common';
import { z } from 'zod';
import { normalizeLines, planReservation, type StockRow } from './domain.js';

const SOURCE = 'inventory-service';
const config = loadConfig();
const reservationsTotal = counter('stock_reservations_total', 'Stock reservation outcomes', ['result']);

async function lockStock(db: PoolClient, productIds: string[]): Promise<StockRow[]> {
  const { rows } = await db.query<{ product_id: string; available: number; reserved: number }>(
    'SELECT product_id, available, reserved FROM stock WHERE product_id = ANY($1::uuid[]) ORDER BY product_id FOR UPDATE',
    [productIds],
  );
  return rows.map((r) => ({ productId: r.product_id, available: r.available, reserved: r.reserved }));
}

async function reserve(db: PoolClient, cmd: ReserveStock): Promise<void> {
  const existing = await db.query('SELECT 1 FROM reservations WHERE order_id = $1 LIMIT 1', [cmd.orderId]);
  if (existing.rowCount) {
    // Saga retry of an order we already handled: re-emit success (reservation is all-or-nothing).
    await enqueueOutbox(db, TOPICS.inventory, makeEvent(SOURCE, EventTypes.StockReserved, { orderId: cmd.orderId }, cmd.orderId));
    return;
  }
  const lines = normalizeLines(cmd.items);
  // A valid UUID is required for the uuid[] cast; reject garbage early.
  if (lines.some((l) => !/^[0-9a-f-]{36}$/i.test(l.productId))) {
    const data: StockReservationFailed = { orderId: cmd.orderId, reason: 'invalid product id' };
    await enqueueOutbox(db, TOPICS.inventory, makeEvent(SOURCE, EventTypes.StockReservationFailed, data, cmd.orderId));
    return;
  }
  const stock = await lockStock(db, lines.map((l) => l.productId));
  const plan = planReservation(stock, lines);
  if (!plan.ok) {
    reservationsTotal.inc({ result: 'failed' });
    const data: StockReservationFailed = { orderId: cmd.orderId, reason: plan.reason, productId: plan.productId };
    await enqueueOutbox(db, TOPICS.inventory, makeEvent(SOURCE, EventTypes.StockReservationFailed, data, cmd.orderId));
    return;
  }
  for (const l of plan.lines) {
    await db.query('UPDATE stock SET available = available - $2, reserved = reserved + $2, updated_at = now() WHERE product_id = $1', [l.productId, l.quantity]);
    await db.query("INSERT INTO reservations (order_id, product_id, quantity, status) VALUES ($1, $2, $3, 'RESERVED')", [cmd.orderId, l.productId, l.quantity]);
  }
  reservationsTotal.inc({ result: 'reserved' });
  await enqueueOutbox(db, TOPICS.inventory, makeEvent(SOURCE, EventTypes.StockReserved, { orderId: cmd.orderId }, cmd.orderId));
}

/** Release (compensation) or commit (order confirmed) the RESERVED rows of an order. Idempotent. */
async function settle(db: PoolClient, orderId: string, mode: 'release' | 'commit'): Promise<void> {
  const { rows } = await db.query<{ product_id: string; quantity: number }>(
    "SELECT product_id, quantity FROM reservations WHERE order_id = $1 AND status = 'RESERVED' ORDER BY product_id FOR UPDATE",
    [orderId],
  );
  if (!rows.length) return;
  await lockStock(db, rows.map((r) => r.product_id));
  for (const r of rows) {
    if (mode === 'release') {
      await db.query('UPDATE stock SET available = available + $2, reserved = GREATEST(reserved - $2, 0), updated_at = now() WHERE product_id = $1', [r.product_id, r.quantity]);
    } else {
      await db.query('UPDATE stock SET reserved = GREATEST(reserved - $2, 0), updated_at = now() WHERE product_id = $1', [r.product_id, r.quantity]);
    }
  }
  const status = mode === 'release' ? 'RELEASED' : 'COMMITTED';
  await db.query("UPDATE reservations SET status = $2, updated_at = now() WHERE order_id = $1 AND status = 'RESERVED'", [orderId, status]);
  reservationsTotal.inc({ result: mode === 'release' ? 'released' : 'committed' });
  const type = mode === 'release' ? EventTypes.StockReleased : EventTypes.StockCommitted;
  await enqueueOutbox(db, TOPICS.inventory, makeEvent(SOURCE, type, { orderId, items: rows.map((r) => ({ productId: r.product_id, quantity: r.quantity })) }, orderId));
}

const toDto = (r: { product_id: string; available: number; reserved: number; updated_at: Date }) => ({
  productId: r.product_id,
  available: r.available,
  reserved: r.reserved,
  inStock: r.available > 0,
  updatedAt: r.updated_at,
});

main(() =>
  runService({
    config,
    migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
    kafka: true,
    outbox: true,
    consumer: {
      topics: [TOPICS.inventoryCommands, TOPICS.orders],
      idempotency: 'db',
      handler: async (evt, { db, log }) => {
        const data = evt.data as { orderId: string };
        switch (evt.type) {
          case EventTypes.ReserveStock:
            return reserve(db!, evt.data as ReserveStock);
          case EventTypes.ReleaseStock:
          case EventTypes.OrderCancelled:
            return settle(db!, data.orderId, 'release');
          case EventTypes.OrderConfirmed:
            return settle(db!, data.orderId, 'commit');
          default:
            log.debug('event not relevant for inventory');
        }
      },
    },
    onStart: async ({ pool, config: cfg, log }) => {
      if (!cfg.SEED_SAMPLE_DATA) return;
      for (const p of SAMPLE_PRODUCTS) {
        await pool!.query('INSERT INTO stock (product_id, available) VALUES ($1, 100) ON CONFLICT DO NOTHING', [p.id]);
      }
      log.info('sample stock seeded');
    },
    routes: (app, { pool, verifyToken }) => {
      const db = pool!;
      const admin = [authenticate(verifyToken), requireRole('admin')];

      app.get('/api/v1/inventory', async (req) => {
        const { ids } = parse(z.object({ ids: z.string().min(1) }), req.query);
        const list = ids.split(',').filter((id) => z.uuid().safeParse(id).success).slice(0, 100);
        const { rows } = await db.query('SELECT product_id, available, reserved, updated_at FROM stock WHERE product_id = ANY($1::uuid[])', [list]);
        return { items: rows.map(toDto) };
      });

      app.get('/api/v1/inventory/:productId', async (req) => {
        const { productId } = parse(z.object({ productId: z.uuid() }), req.params);
        const { rows } = await db.query('SELECT product_id, available, reserved, updated_at FROM stock WHERE product_id = $1', [productId]);
        if (!rows[0]) throw notFound('stock record');
        return toDto(rows[0]);
      });

      app.put('/api/v1/inventory/:productId', { preHandler: admin }, async (req) => {
        const { productId } = parse(z.object({ productId: z.uuid() }), req.params);
        const { available } = parse(z.object({ available: z.number().int().min(0).max(1_000_000) }), req.body);
        const { rows } = await db.query(
          `INSERT INTO stock (product_id, available) VALUES ($1, $2)
           ON CONFLICT (product_id) DO UPDATE SET available = EXCLUDED.available, updated_at = now()
           RETURNING product_id, available, reserved, updated_at`,
          [productId, available],
        );
        return toDto(rows[0]);
      });
    },
  }),
);
