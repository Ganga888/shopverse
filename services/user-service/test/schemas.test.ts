import { describe, expect, it } from 'vitest';
import { addressSchema, profilePatchSchema } from '../src/schemas.js';

describe('user schemas', () => {
  it('normalizes addresses', () => {
    const a = addressSchema.parse({ name: 'A', line1: 'MG Road 1', city: 'Bengaluru', state: 'KA', postalCode: '560001', country: 'in' });
    expect(a.country).toBe('IN');
    expect(a.label).toBe('home');
    expect(a.isDefault).toBe(false);
  });
  it('rejects bad postal codes and empty patches', () => {
    expect(addressSchema.safeParse({ name: 'A', line1: 'x', city: 'c', state: 's', postalCode: '!', country: 'IN' }).success).toBe(false);
    expect(profilePatchSchema.safeParse({}).success).toBe(false);
    expect(profilePatchSchema.safeParse({ phone: null }).success).toBe(true);
  });
});
