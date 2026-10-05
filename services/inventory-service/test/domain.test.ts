import { describe, expect, it } from 'vitest';
import { applyCommit, applyRelease, applyReserve, normalizeLines, planReservation } from '../src/domain.js';

const stock = [
  { productId: 'b', available: 5, reserved: 0 },
  { productId: 'a', available: 1, reserved: 2 },
];

describe('reservation planning', () => {
  it('reserves when every line has stock, in lock order', () => {
    const plan = planReservation(stock, [{ productId: 'b', quantity: 2 }, { productId: 'a', quantity: 1 }]);
    expect(plan).toEqual({ ok: true, lines: [{ productId: 'a', quantity: 1 }, { productId: 'b', quantity: 2 }] });
  });
  it('is all-or-nothing when one line is short', () => {
    const plan = planReservation(stock, [{ productId: 'b', quantity: 2 }, { productId: 'a', quantity: 2 }]);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.productId).toBe('a');
  });
  it('sums duplicate lines before checking', () => {
    expect(planReservation(stock, [{ productId: 'b', quantity: 3 }, { productId: 'b', quantity: 3 }]).ok).toBe(false);
    expect(normalizeLines([{ productId: 'x', quantity: 1 }, { productId: 'x', quantity: 2 }])).toEqual([{ productId: 'x', quantity: 3 }]);
  });
  it('fails for unknown products', () => {
    const plan = planReservation(stock, [{ productId: 'zzz', quantity: 1 }]);
    expect(plan).toMatchObject({ ok: false, reason: 'unknown product' });
  });
});

describe('stock arithmetic', () => {
  it('reserve -> release restores availability', () => {
    const s = { productId: 'a', available: 10, reserved: 0 };
    const r = applyReserve(s, 4);
    expect(r).toMatchObject({ available: 6, reserved: 4 });
    expect(applyRelease(r, 4)).toMatchObject({ available: 10, reserved: 0 });
  });
  it('reserve -> commit consumes stock', () => {
    const r = applyReserve({ productId: 'a', available: 10, reserved: 0 }, 4);
    expect(applyCommit(r, 4)).toMatchObject({ available: 6, reserved: 0 });
  });
  it('refuses to over-reserve', () => {
    expect(() => applyReserve({ productId: 'a', available: 1, reserved: 0 }, 2)).toThrow();
  });
});
