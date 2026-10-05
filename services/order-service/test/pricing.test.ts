import { describe, expect, it } from 'vitest';
import { applyDiscount, mergeLines, priceLines, PricingError } from '../src/pricing.js';

const products = [
  { id: 'a', name: 'A', priceCents: 1000, currency: 'INR', active: true },
  { id: 'b', name: 'B', priceCents: 250, currency: 'INR', active: true },
  { id: 'c', name: 'C', priceCents: 99, currency: 'INR', active: false },
];

describe('pricing', () => {
  it('merges duplicate lines', () => {
    expect(mergeLines([{ productId: 'a', quantity: 1 }, { productId: 'a', quantity: 2 }])).toEqual([{ productId: 'a', quantity: 3 }]);
  });
  it('prices from catalogue data', () => {
    const r = priceLines([{ productId: 'a', quantity: 2 }, { productId: 'b', quantity: 1 }], products);
    expect(r.subtotalCents).toBe(2250);
    expect(r.currency).toBe('INR');
  });
  it('rejects unknown or inactive products', () => {
    expect(() => priceLines([{ productId: 'c', quantity: 1 }], products)).toThrow(PricingError);
    expect(() => priceLines([{ productId: 'zzz', quantity: 1 }], products)).toThrow(PricingError);
  });
  it('clamps discounts', () => {
    expect(applyDiscount(1000, 200)).toBe(800);
    expect(applyDiscount(1000, 5000)).toBe(0);
    expect(applyDiscount(1000, -5)).toBe(1000);
  });
});
