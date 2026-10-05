export interface CatalogProduct {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
  active: boolean;
}

export interface PricedLine {
  productId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
}

export class PricingError extends Error {}

/** Merge duplicate lines and sum quantities. */
export function mergeLines(lines: { productId: string; quantity: number }[]): { productId: string; quantity: number }[] {
  const m = new Map<string, number>();
  for (const l of lines) m.set(l.productId, (m.get(l.productId) ?? 0) + l.quantity);
  return [...m.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}

/** Price order lines from authoritative catalogue data (never trust client prices). */
export function priceLines(lines: { productId: string; quantity: number }[], products: CatalogProduct[]) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const priced: PricedLine[] = mergeLines(lines).map((l) => {
    const p = byId.get(l.productId);
    if (!p || !p.active) throw new PricingError(`product ${l.productId} is not available`);
    return { productId: p.id, name: p.name, unitPriceCents: p.priceCents, quantity: l.quantity };
  });
  const currencies = new Set(priced.map((l) => byId.get(l.productId)!.currency));
  if (currencies.size > 1) throw new PricingError('mixed currencies are not supported');
  const subtotalCents = priced.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
  return { lines: priced, subtotalCents, currency: [...currencies][0] ?? 'INR' };
}

export function applyDiscount(subtotalCents: number, discountCents: number): number {
  return Math.max(0, subtotalCents - Math.min(Math.max(0, discountCents), subtotalCents));
}
