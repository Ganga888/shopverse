import { describe, expect, it } from 'vitest';
import { evaluateCoupon, normalizeCode, type Coupon } from '../src/rules.js';

const now = new Date('2026-06-01T00:00:00Z');
const base: Coupon = {
  code: 'WELCOME10',
  type: 'PERCENT',
  value: 10,
  minSubtotalCents: 0,
  maxDiscountCents: null,
  startsAt: new Date('2026-01-01T00:00:00Z'),
  endsAt: null,
  usageLimit: null,
  usedCount: 0,
  active: true,
};

describe('coupon rules', () => {
  it('applies percentage discounts (floored)', () => {
    expect(evaluateCoupon(base, 12345, now)).toEqual({ valid: true, discountCents: 1234 });
  });
  it('caps percentage discounts', () => {
    expect(evaluateCoupon({ ...base, maxDiscountCents: 500 }, 100000, now)).toEqual({ valid: true, discountCents: 500 });
  });
  it('fixed discounts never exceed the subtotal', () => {
    expect(evaluateCoupon({ ...base, type: 'FIXED', value: 50000 }, 30000, now)).toEqual({ valid: true, discountCents: 30000 });
  });
  it('enforces minimum subtotal', () => {
    expect(evaluateCoupon({ ...base, minSubtotalCents: 200000 }, 199999, now)).toEqual({ valid: false, reason: 'min_subtotal_not_met' });
  });
  it('enforces validity window', () => {
    expect(evaluateCoupon({ ...base, startsAt: new Date('2026-07-01Z') }, 1000, now)).toMatchObject({ reason: 'not_started' });
    expect(evaluateCoupon({ ...base, endsAt: new Date('2026-05-01Z') }, 1000, now)).toMatchObject({ reason: 'expired' });
  });
  it('enforces usage limits and active flag', () => {
    expect(evaluateCoupon({ ...base, usageLimit: 5, usedCount: 5 }, 1000, now)).toMatchObject({ reason: 'usage_limit_reached' });
    expect(evaluateCoupon({ ...base, usageLimit: 5, usedCount: 4 }, 1000, now).valid).toBe(true);
    expect(evaluateCoupon({ ...base, active: false }, 1000, now)).toMatchObject({ reason: 'inactive' });
  });
  it('rejects invalid subtotals', () => {
    expect(evaluateCoupon(base, 0, now)).toMatchObject({ reason: 'invalid_subtotal' });
  });
  it('normalizes codes', () => {
    expect(normalizeCode(' welcome10 ')).toBe('WELCOME10');
  });
});
