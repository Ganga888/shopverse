import { describe, expect, it } from 'vitest';
import { renderNotification, sseFrame } from '../src/templates.js';

const env = (type: string, data: unknown) => ({ id: 'e1', type, source: 's', time: '2026-01-01T00:00:00Z', correlationId: 'c1', data });

describe('notification templates', () => {
  it('renders order confirmations with amount in rupees', () => {
    const n = renderNotification(env('OrderConfirmed', { orderId: 'abcdef12-0000', userId: 'u1', userEmail: 'a@b.c', totalCents: 123456 }));
    expect(n).toMatchObject({ userId: 'u1', email: 'a@b.c', kind: 'order_confirmed', title: 'Order ABCDEF12 confirmed' });
    expect(n!.body).toContain('₹1234.56');
  });
  it('renders cancellations with the reason', () => {
    expect(renderNotification(env('OrderCancelled', { orderId: 'o', userId: 'u', reason: 'card_declined' }))!.body).toContain('card_declined');
  });
  it('renders shipment updates', () => {
    expect(renderNotification(env('ShipmentStatusChanged', { orderId: 'o', userId: 'u', status: 'OUT_FOR_DELIVERY' }))!.body).toContain('out for delivery');
  });
  it('ignores non user-facing events', () => {
    expect(renderNotification(env('OrderCreated', {}))).toBeNull();
  });
  it('formats SSE frames', () => {
    expect(sseFrame('x', { a: 1 }, 'id1')).toBe('id: id1\nevent: x\ndata: {"a":1}\n\n');
  });
});
