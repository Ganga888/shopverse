import type { EventEnvelope } from '@shopverse/common';

export interface Notification {
  id: string;
  userId: string;
  email?: string;
  kind: string;
  title: string;
  body: string;
  correlationId: string;
  createdAt: string;
}

const inr = (cents: number) => `₹${(cents / 100).toFixed(2)}`;
const shortId = (id: string) => id.slice(0, 8).toUpperCase();

/** Turn a domain event into a user-facing notification (null when the event is not user-facing). */
export function renderNotification(evt: EventEnvelope): Notification | null {
  const d = evt.data as Record<string, unknown>;
  const base = { id: evt.id, correlationId: evt.correlationId, createdAt: evt.time };
  switch (evt.type) {
    case 'UserRegistered':
      return { ...base, userId: String(d.userId), email: String(d.email), kind: 'welcome', title: 'Welcome to ShopVerse', body: `Hi ${String(d.name)}, your account is ready. Happy shopping!` };
    case 'OrderConfirmed':
      return {
        ...base,
        userId: String(d.userId),
        email: d.userEmail ? String(d.userEmail) : undefined,
        kind: 'order_confirmed',
        title: `Order ${shortId(String(d.orderId))} confirmed`,
        body: `We received your payment of ${inr(Number(d.totalCents))}. We'll let you know when it ships.`,
      };
    case 'OrderCancelled':
      return {
        ...base,
        userId: String(d.userId),
        email: d.userEmail ? String(d.userEmail) : undefined,
        kind: 'order_cancelled',
        title: `Order ${shortId(String(d.orderId))} cancelled`,
        body: `Your order could not be completed (${String(d.reason)}). Any authorised amount has been released.`,
      };
    case 'ShipmentCreated':
      return {
        ...base,
        userId: String(d.userId),
        kind: 'shipment_created',
        title: `Order ${shortId(String(d.orderId))} is being packed`,
        body: `Carrier ${String(d.carrier)}, tracking number ${String(d.trackingNumber)}.`,
      };
    case 'ShipmentStatusChanged':
      return {
        ...base,
        userId: String(d.userId),
        kind: 'shipment_status',
        title: `Shipment update for order ${shortId(String(d.orderId))}`,
        body: `Your shipment is now ${String(d.status).replace(/_/g, ' ').toLowerCase()}.`,
      };
    default:
      return null;
  }
}

export const keys = {
  list: (userId: string) => `notif:list:${userId}`,
  channel: (userId: string) => `notif:ch:${userId}`,
  channelPattern: 'notif:ch:*',
  email: (userId: string) => `notif:email:${userId}`,
};

export function sseFrame(event: string, data: unknown, id?: string): string {
  return `${id ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
