import { describe, expect, it } from 'vitest';
import { addQuantity, computeTotals, parseItems, type CartItem } from '../src/cart.js';

const items: CartItem[] = [
  { productId: 'a', name: 'B item', unitPriceCents: 1000, currency: 'INR', quantity: 2 },
  { productId: 'b', name: 'A item', unitPriceCents: 250, currency: 'INR', quantity: 4 },
];

describe('cart totals', () => {
  it('sums lines and applies a clamped discount', () => {
    expect(computeTotals(items, 500)).toEqual({ itemCount: 6, subtotalCents: 3000, discountCents: 500, totalCents: 2500, currency: 'INR' });
    expect(computeTotals(items, 99999).totalCents).toBe(0);
    expect(computeTotals([]).subtotalCents).toBe(0);
  });
  it('parses and sorts hash values', () => {
    const parsed = parseItems({ a: JSON.stringify(items[0]), b: JSON.stringify(items[1]) });
    expect(parsed.map((i) => i.name)).toEqual(['A item', 'B item']);
  });
  it('caps quantities', () => {
    expect(addQuantity(98, 2)).toBe(100);
    expect(() => addQuantity(99, 2)).toThrow(RangeError);
  });
});
