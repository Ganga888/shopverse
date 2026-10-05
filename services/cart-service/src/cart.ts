export interface CartItem {
  productId: string;
  name: string;
  unitPriceCents: number;
  currency: string;
  quantity: number;
}

export const MAX_QTY_PER_ITEM = 100;
export const MAX_DISTINCT_ITEMS = 50;

export const cartKey = (userId: string) => `cart:${userId}`;
export const couponKey = (userId: string) => `cart:${userId}:coupon`;

export function parseItems(hash: Record<string, string>): CartItem[] {
  return Object.values(hash)
    .map((v) => JSON.parse(v) as CartItem)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function computeTotals(items: CartItem[], discountCents = 0) {
  const subtotalCents = items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
  const discount = Math.min(Math.max(0, discountCents), subtotalCents);
  return {
    itemCount: items.reduce((s, i) => s + i.quantity, 0),
    subtotalCents,
    discountCents: discount,
    totalCents: subtotalCents - discount,
    currency: items[0]?.currency ?? 'INR',
  };
}

/** New quantity after adding `add` units; throws when the per-line cap would be exceeded. */
export function addQuantity(current: number, add: number): number {
  const next = current + add;
  if (next > MAX_QTY_PER_ITEM) throw new RangeError(`quantity per item cannot exceed ${MAX_QTY_PER_ITEM}`);
  return next;
}
