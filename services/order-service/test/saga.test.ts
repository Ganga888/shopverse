import { describe, expect, it } from 'vitest';
import { isTerminal, toSagaEvent, transition, type OrderStatus, type SagaEvent } from '../src/saga.js';

const kinds = (s: OrderStatus, e: SagaEvent) => transition(s, e).actions.map((a) => a.kind);

describe('order saga state machine', () => {
  it('happy path: PENDING -> STOCK_RESERVED -> CONFIRMED', () => {
    const t1 = transition('PENDING', { type: 'StockReserved' });
    expect(t1.to).toBe('STOCK_RESERVED');
    expect(t1.step).toBe('AUTHORIZING_PAYMENT');
    expect(t1.sagaStatus).toBe('RUNNING');
    expect(kinds('PENDING', { type: 'StockReserved' })).toEqual(['AuthorizePayment']);

    const t2 = transition('STOCK_RESERVED', { type: 'PaymentAuthorized', paymentId: 'p1' });
    expect(t2.to).toBe('CONFIRMED');
    expect(t2.sagaStatus).toBe('COMPLETED');
    expect(t2.paymentId).toBe('p1');
    expect(t2.actions).toEqual([{ kind: 'OrderConfirmed', paymentId: 'p1' }]);
  });

  it('stock reservation failure cancels without releasing stock', () => {
    const t = transition('PENDING', { type: 'StockReservationFailed', reason: 'out of stock' });
    expect(t.to).toBe('CANCELLED');
    expect(t.sagaStatus).toBe('COMPENSATED');
    expect(t.failureReason).toBe('out of stock');
    expect(t.actions).toEqual([{ kind: 'OrderCancelled', reason: 'out of stock' }]);
  });

  it('payment failure releases stock then cancels', () => {
    expect(kinds('STOCK_RESERVED', { type: 'PaymentFailed', reason: 'declined' })).toEqual(['ReleaseStock', 'OrderCancelled']);
    expect(transition('STOCK_RESERVED', { type: 'PaymentFailed', reason: 'declined' }).to).toBe('CANCELLED');
  });

  it('timeout compensates from every running state', () => {
    expect(kinds('PENDING', { type: 'Timeout' })).toEqual(['ReleaseStock', 'OrderCancelled']);
    expect(kinds('STOCK_RESERVED', { type: 'Timeout' })).toEqual(['ReleaseStock', 'VoidPayment', 'OrderCancelled']);
    expect(transition('STOCK_RESERVED', { type: 'Timeout' }).failureReason).toBe('saga timeout');
  });

  it('terminal states ignore duplicates and timeouts', () => {
    for (const e of [{ type: 'Timeout' }, { type: 'PaymentFailed', reason: 'x' }, { type: 'StockReserved' }] as SagaEvent[]) {
      const t = transition('CONFIRMED', e);
      expect(t.ignored).toBe(true);
      expect(t.actions).toEqual([]);
    }
    expect(transition('CANCELLED', { type: 'Timeout' }).ignored).toBe(true);
    expect(transition('CANCELLED', { type: 'PaymentFailed', reason: 'x' }).ignored).toBe(true);
  });

  it('compensates late events after cancellation', () => {
    const late = transition('CANCELLED', { type: 'StockReserved' });
    expect(late.to).toBe('CANCELLED');
    expect(late.ignored).toBe(false);
    expect(late.actions.map((a) => a.kind)).toEqual(['ReleaseStock']);
    expect(kinds('CANCELLED', { type: 'PaymentAuthorized', paymentId: 'p' })).toEqual(['VoidPayment']);
  });

  it('ignores out-of-order events', () => {
    expect(transition('PENDING', { type: 'PaymentAuthorized', paymentId: 'p' }).ignored).toBe(true);
    expect(transition('STOCK_RESERVED', { type: 'StockReserved' }).ignored).toBe(true);
  });

  it('maps kafka events to saga events', () => {
    expect(toSagaEvent('StockReserved', {})).toEqual({ type: 'StockReserved' });
    expect(toSagaEvent('PaymentFailed', { reason: 'declined' })).toEqual({ type: 'PaymentFailed', reason: 'declined' });
    expect(toSagaEvent('PaymentAuthorized', { paymentId: 'p1' })).toEqual({ type: 'PaymentAuthorized', paymentId: 'p1' });
    expect(toSagaEvent('StockCommitted', {})).toBeNull();
    expect(isTerminal('CONFIRMED') && isTerminal('CANCELLED') && !isTerminal('PENDING')).toBe(true);
  });
});
