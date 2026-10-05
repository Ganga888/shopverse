import { createHash } from 'node:crypto';

export const STATUSES = ['CREATED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const;
export type ShipmentStatus = (typeof STATUSES)[number];

/** Shipments only move forward, one or more steps at a time. */
export function canTransition(from: ShipmentStatus, to: ShipmentStatus): boolean {
  return STATUSES.indexOf(to) > STATUSES.indexOf(from);
}

/** Deterministic per order, so a redelivered OrderConfirmed cannot create a second tracking number. */
export function trackingNumber(orderId: string): string {
  return `SV${createHash('sha256').update(orderId).digest('hex').slice(0, 12).toUpperCase()}`;
}

export function pickCarrier(country: string, postalCode: string): { carrier: string; days: number } {
  if (country.toUpperCase() !== 'IN') return { carrier: 'DHL', days: 7 };
  const metroPrefixes = ['11', '40', '56', '60', '70', '50'];
  return metroPrefixes.some((p) => postalCode.startsWith(p)) ? { carrier: 'BlueDart', days: 2 } : { carrier: 'IndiaPost', days: 5 };
}

export function etaDate(from: Date, days: number): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
