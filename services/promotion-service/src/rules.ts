export interface Coupon {
  code: string;
  type: 'PERCENT' | 'FIXED';
  value: number;
  minSubtotalCents: number;
  maxDiscountCents: number | null;
  startsAt: Date;
  endsAt: Date | null;
  usageLimit: number | null;
  usedCount: number;
  active: boolean;
}

export type CouponEvaluation =
  | { valid: true; discountCents: number }
  | { valid: false; reason: 'inactive' | 'not_started' | 'expired' | 'usage_limit_reached' | 'min_subtotal_not_met' | 'invalid_subtotal' };

/** Pure coupon rules: validity window, usage limit, minimum basket, percent cap, never exceed subtotal. */
export function evaluateCoupon(c: Coupon, subtotalCents: number, now: Date = new Date()): CouponEvaluation {
  if (!Number.isInteger(subtotalCents) || subtotalCents <= 0) return { valid: false, reason: 'invalid_subtotal' };
  if (!c.active) return { valid: false, reason: 'inactive' };
  if (now < c.startsAt) return { valid: false, reason: 'not_started' };
  if (c.endsAt && now > c.endsAt) return { valid: false, reason: 'expired' };
  if (c.usageLimit !== null && c.usedCount >= c.usageLimit) return { valid: false, reason: 'usage_limit_reached' };
  if (subtotalCents < c.minSubtotalCents) return { valid: false, reason: 'min_subtotal_not_met' };
  let discount = c.type === 'PERCENT' ? Math.floor((subtotalCents * c.value) / 100) : c.value;
  if (c.maxDiscountCents !== null) discount = Math.min(discount, c.maxDiscountCents);
  return { valid: true, discountCents: Math.min(discount, subtotalCents) };
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}
