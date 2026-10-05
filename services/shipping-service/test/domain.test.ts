import { describe, expect, it } from 'vitest';
import { canTransition, etaDate, pickCarrier, trackingNumber } from '../src/domain.js';

describe('shipping domain', () => {
  it('only allows forward transitions', () => {
    expect(canTransition('CREATED', 'SHIPPED')).toBe(true);
    expect(canTransition('SHIPPED', 'PACKED')).toBe(false);
    expect(canTransition('DELIVERED', 'DELIVERED')).toBe(false);
  });
  it('derives a stable tracking number per order', () => {
    expect(trackingNumber('o1')).toBe(trackingNumber('o1'));
    expect(trackingNumber('o1')).toMatch(/^SV[0-9A-F]{12}$/);
  });
  it('chooses carriers by destination', () => {
    expect(pickCarrier('IN', '560001').carrier).toBe('BlueDart');
    expect(pickCarrier('IN', 'site').carrier).toBe('IndiaPost');
    expect(pickCarrier('US', '94016').carrier).toBe('DHL');
  });
  it('computes ETA dates', () => {
    expect(etaDate(new Date('2026-01-30T10:00:00Z'), 2)).toBe('2026-02-01');
  });
});
