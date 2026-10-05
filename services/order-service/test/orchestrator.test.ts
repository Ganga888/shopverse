import { describe, expect, it } from 'vitest';
import { applySagaEvent, sweepTimedOutSagas } from '../src/orchestrator.js';
import type { OrderStatus } from '../src/saga.js';

type Row = Record<string, unknown>;
const silent = { info: () => {}, warn: () => {}, error: () => {} } as never;

/** Minimal in-memory stand-in for a pg client: answers the orchestrator's queries and records writes. */
function fakeDb(status: OrderStatus | null) {
  const order = status && {
    id: 'o1', user_id: 'u1', user_email: 'u1@example.com', status, total_cents: '2500', currency: 'INR',
    shipping_address: { name: 'a', line1: 'b', city: 'c', state: 'd', postalCode: '560001', country: 'IN' },
  };
  const outbox: { topic: string; type: string; data: Row }[] = [];
  const updates: { sql: string; params: unknown[] }[] = [];
  const query = async (sql: string, params: unknown[] = []) => {
    if (sql.startsWith('SELECT id, user_id')) return { rows: order ? [order] : [], rowCount: order ? 1 : 0 };
    if (sql.startsWith('SELECT context')) return { rows: [{ context: { paymentToken: 'tok_visa' } }], rowCount: 1 };
    if (sql.startsWith('SELECT product_id')) return { rows: [{ product_id: 'p1', quantity: 2, unit_price_cents: '1250', name: 'P' }], rowCount: 1 };
    if (sql.startsWith('INSERT INTO outbox')) {
      const evt = JSON.parse(params[3] as string);
      outbox.push({ topic: params[1] as string, type: evt.type, data: evt.data });
      return { rows: [], rowCount: 1 };
    }
    updates.push({ sql, params });
    return { rows: [], rowCount: 1 };
  };
  return { db: { query } as never, outbox, updates };
}

describe('saga orchestrator persistence', () => {
  it('StockReserved -> STOCK_RESERVED and AuthorizePayment command with amount and token', async () => {
    const f = fakeDb('PENDING');
    expect(await applySagaEvent(f.db, 'o1', { type: 'StockReserved' }, silent)).toBe('STOCK_RESERVED');
    expect(f.outbox).toEqual([
      { topic: 'payments.commands', type: 'AuthorizePayment', data: { orderId: 'o1', userId: 'u1', amountCents: 2500, currency: 'INR', paymentToken: 'tok_visa' } },
    ]);
    expect(f.updates[0].params.slice(0, 2)).toEqual(['o1', 'STOCK_RESERVED']);
  });

  it('PaymentAuthorized -> CONFIRMED and OrderConfirmed carries items and address', async () => {
    const f = fakeDb('STOCK_RESERVED');
    expect(await applySagaEvent(f.db, 'o1', { type: 'PaymentAuthorized', paymentId: 'pay1' }, silent)).toBe('CONFIRMED');
    expect(f.outbox).toHaveLength(1);
    expect(f.outbox[0]).toMatchObject({ topic: 'orders.events', type: 'OrderConfirmed', data: { paymentId: 'pay1', userEmail: 'u1@example.com', totalCents: 2500 } });
    expect(f.outbox[0].data.items).toEqual([{ productId: 'p1', quantity: 2, unitPriceCents: 1250, name: 'P' }]);
    // terminal transition scrubs the payment token from the saga context
    expect(f.updates.find((u) => u.sql.includes('UPDATE saga_state'))!.params[6]).toBe(true);
  });

  it('PaymentFailed -> ReleaseStock + OrderCancelled', async () => {
    const f = fakeDb('STOCK_RESERVED');
    expect(await applySagaEvent(f.db, 'o1', { type: 'PaymentFailed', reason: 'card_declined' }, silent)).toBe('CANCELLED');
    expect(f.outbox.map((o) => `${o.topic}:${o.type}`)).toEqual(['inventory.commands:ReleaseStock', 'orders.events:OrderCancelled']);
    expect(f.outbox[1].data).toMatchObject({ reason: 'card_declined', userId: 'u1' });
  });

  it('timeout after reservation also voids the payment', async () => {
    const f = fakeDb('STOCK_RESERVED');
    await applySagaEvent(f.db, 'o1', { type: 'Timeout' }, silent);
    expect(f.outbox.map((o) => o.type)).toEqual(['ReleaseStock', 'VoidPayment', 'OrderCancelled']);
  });

  it('ignores events for terminal orders without writing', async () => {
    const f = fakeDb('CONFIRMED');
    expect(await applySagaEvent(f.db, 'o1', { type: 'Timeout' }, silent)).toBe('CONFIRMED');
    expect(f.outbox).toEqual([]);
    expect(f.updates).toEqual([]);
  });

  it('returns null for unknown orders', async () => {
    const f = fakeDb(null);
    expect(await applySagaEvent(f.db, 'nope', { type: 'StockReserved' }, silent)).toBeNull();
  });

  it('sweeper compensates every overdue saga in its own transaction', async () => {
    const f = fakeDb('PENDING');
    const statements: string[] = [];
    const client = { query: async (sql: string, p?: unknown[]) => (statements.push(sql), f.db && (f.db as { query: (s: string, p?: unknown[]) => Promise<unknown> }).query(sql, p)), release: () => {} };
    const pool = {
      query: async () => ({ rows: [{ order_id: 'o1' }, { order_id: 'o2' }], rowCount: 2 }),
      connect: async () => client,
    };
    expect(await sweepTimedOutSagas(pool as never, silent)).toBe(2);
    expect(statements.filter((s) => s === 'BEGIN')).toHaveLength(2);
    expect(statements.filter((s) => s === 'COMMIT')).toHaveLength(2);
    expect(f.outbox.filter((o) => o.type === 'OrderCancelled')).toHaveLength(2);
  });
});
