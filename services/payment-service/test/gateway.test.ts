import { describe, expect, it } from 'vitest';
import { createGateway } from '../src/gateway.js';

describe('mock payment gateway', () => {
  const gw = createGateway('test-key', 0);
  it('authorizes and returns a stable reference', async () => {
    const a = await gw.authorize({ idempotencyKey: 'order:1', amountCents: 1000, currency: 'INR', token: 'tok_visa' });
    const b = await gw.authorize({ idempotencyKey: 'order:1', amountCents: 1000, currency: 'INR', token: 'tok_visa' });
    expect(a.approved).toBe(true);
    expect(a.ref).toBe(b.ref);
  });
  it('declines tok_fail', async () => {
    expect(await gw.authorize({ idempotencyKey: 'order:2', amountCents: 1000, currency: 'INR', token: 'tok_fail' })).toMatchObject({ approved: false, reason: 'card_declined' });
  });
  it('voids known references and rejects unknown ones', async () => {
    await expect(gw.void('gw_abc')).resolves.toBeUndefined();
    await expect(gw.void('bogus')).rejects.toThrow();
  });
  it('fails closed without an API key', async () => {
    await expect(createGateway(undefined, 0).authorize({ idempotencyKey: 'k', amountCents: 1, currency: 'INR', token: 't' })).rejects.toThrow('api key');
  });
});
