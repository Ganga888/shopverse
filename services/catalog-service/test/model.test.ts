import { describe, expect, it } from 'vitest';
import { CACHE, toEventData, toProduct } from '../src/model.js';

const row = {
  id: 'p1', sku: 'S', name: 'N', description: 'D', category: 'c', price_cents: '1999', currency: 'INR',
  image_url: null, active: true, version: 3, created_at: new Date(0), updated_at: new Date(0),
};

describe('catalog model', () => {
  it('maps rows to DTOs with numeric prices', () => {
    expect(toProduct(row)).toMatchObject({ id: 'p1', priceCents: 1999, version: 3 });
    expect(toEventData(toProduct(row))).toMatchObject({ productId: 'p1', priceCents: 1999, version: 3 });
  });
  it('builds deterministic list cache keys independent of key order', () => {
    expect(CACHE.listKey(1, { a: 1, b: 2 })).toBe(CACHE.listKey(1, { b: 2, a: 1 }));
    expect(CACHE.listKey(1, { a: 1 })).not.toBe(CACHE.listKey(2, { a: 1 }));
  });
});
