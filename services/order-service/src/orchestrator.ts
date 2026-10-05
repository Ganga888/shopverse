import {
  counter,
  enqueueOutbox,
  EventTypes,
  makeEvent,
  TOPICS,
  withTx,
  type Address,
  type AuthorizePayment,
  type Logger,
  type OrderCancelled,
  type OrderConfirmed,
  type OrderLine,
  type Pool,
  type PoolClient,
  type ReleaseStock,
  type VoidPayment,
} from '@shopverse/common';
import { isTerminal, transition, type OrderStatus, type SagaAction, type SagaEvent } from './saga.js';

export const SOURCE = 'order-service';
export const ordersCreated = counter('orders_created_total', 'Orders accepted');
export const sagaCompleted = counter('saga_completed_total', 'Order sagas finished', ['result']);
export const sagaTimeouts = counter('saga_timeouts_total', 'Order sagas compensated because of timeout');

interface OrderRow {
  id: string;
  user_id: string;
  user_email: string | null;
  status: OrderStatus;
  total_cents: string;
  currency: string;
  shipping_address: Address;
}

async function loadItems(db: PoolClient, orderId: string): Promise<OrderLine[]> {
  const { rows } = await db.query<{ product_id: string; quantity: number; unit_price_cents: string; name: string }>(
    'SELECT product_id, quantity, unit_price_cents, name FROM order_items WHERE order_id = $1 ORDER BY product_id',
    [orderId],
  );
  return rows.map((r) => ({ productId: r.product_id, quantity: r.quantity, unitPriceCents: Number(r.unit_price_cents), name: r.name }));
}

async function emit(db: PoolClient, order: OrderRow, action: SagaAction, context: Record<string, unknown>): Promise<void> {
  const orderId = order.id;
  switch (action.kind) {
    case 'AuthorizePayment': {
      const data: AuthorizePayment = {
        orderId,
        userId: order.user_id,
        amountCents: Number(order.total_cents),
        currency: order.currency,
        paymentToken: String(context.paymentToken ?? ''),
      };
      return enqueueOutbox(db, TOPICS.paymentsCommands, makeEvent(SOURCE, EventTypes.AuthorizePayment, data, orderId));
    }
    case 'ReleaseStock': {
      const data: ReleaseStock = { orderId, reason: action.reason };
      return enqueueOutbox(db, TOPICS.inventoryCommands, makeEvent(SOURCE, EventTypes.ReleaseStock, data, orderId));
    }
    case 'VoidPayment': {
      const data: VoidPayment = { orderId, reason: action.reason };
      return enqueueOutbox(db, TOPICS.paymentsCommands, makeEvent(SOURCE, EventTypes.VoidPayment, data, orderId));
    }
    case 'OrderConfirmed': {
      const data: OrderConfirmed = {
        orderId,
        userId: order.user_id,
        userEmail: order.user_email ?? undefined,
        items: await loadItems(db, orderId),
        totalCents: Number(order.total_cents),
        currency: order.currency,
        shippingAddress: order.shipping_address,
        paymentId: action.paymentId,
      };
      return enqueueOutbox(db, TOPICS.orders, makeEvent(SOURCE, EventTypes.OrderConfirmed, data, orderId));
    }
    case 'OrderCancelled': {
      const data: OrderCancelled = { orderId, userId: order.user_id, userEmail: order.user_email ?? undefined, reason: action.reason };
      return enqueueOutbox(db, TOPICS.orders, makeEvent(SOURCE, EventTypes.OrderCancelled, data, orderId));
    }
  }
}

/**
 * Apply one saga event to an order inside the caller's transaction. Rows are always locked in the
 * order orders -> saga_state to avoid deadlocks between the consumer and the timeout sweeper.
 */
export async function applySagaEvent(db: PoolClient, orderId: string, event: SagaEvent, log: Logger): Promise<OrderStatus | null> {
  const { rows } = await db.query<OrderRow>(
    'SELECT id, user_id, user_email, status, total_cents, currency, shipping_address FROM orders WHERE id = $1 FOR UPDATE',
    [orderId],
  );
  const order = rows[0];
  if (!order) {
    log.warn({ orderId, event: event.type }, 'saga event for unknown order');
    return null;
  }
  const saga = await db.query<{ context: Record<string, unknown> }>('SELECT context FROM saga_state WHERE order_id = $1 FOR UPDATE', [orderId]);
  const context = saga.rows[0]?.context ?? {};

  const t = transition(order.status, event);
  if (t.ignored) {
    log.info({ orderId, status: order.status, event: event.type }, 'saga event ignored');
    return order.status;
  }
  if (t.to !== t.from) {
    await db.query(
      `UPDATE orders SET status = $2, failure_reason = COALESCE($3, failure_reason), payment_id = COALESCE($4, payment_id), updated_at = now()
       WHERE id = $1`,
      [orderId, t.to, t.failureReason ?? null, t.paymentId ?? null],
    );
  }
  const terminal = isTerminal(t.to);
  await db.query(
    `UPDATE saga_state
        SET step = $2, status = $3, updated_at = now(),
            history = history || jsonb_build_array(jsonb_build_object('at', now(), 'event', $4::text, 'from', $5::text, 'to', $6::text)),
            context = CASE WHEN $7 THEN context - 'paymentToken' ELSE context END
      WHERE order_id = $1`,
    [orderId, t.step, t.sagaStatus, event.type, t.from, t.to, terminal],
  );
  for (const action of t.actions) await emit(db, order, action, context);

  if (t.to !== t.from && terminal) {
    sagaCompleted.inc({ result: t.to === 'CONFIRMED' ? 'confirmed' : 'cancelled' });
    if (event.type === 'Timeout') sagaTimeouts.inc();
  }
  log.info({ orderId, from: t.from, to: t.to, event: event.type, actions: t.actions.map((a) => a.kind) }, 'saga transition');
  return t.to;
}

/** Compensate sagas that exceeded their deadline (default 5 minutes). */
export async function sweepTimedOutSagas(pool: Pool, log: Logger, batch = 50): Promise<number> {
  const { rows } = await pool.query<{ order_id: string }>(
    "SELECT order_id FROM saga_state WHERE status = 'RUNNING' AND deadline_at < now() ORDER BY deadline_at LIMIT $1",
    [batch],
  );
  for (const { order_id } of rows) {
    await withTx(pool, (db) => applySagaEvent(db, order_id, { type: 'Timeout' }, log)).catch((err) =>
      log.error({ err, orderId: order_id }, 'failed to compensate timed-out saga'),
    );
  }
  return rows.length;
}
