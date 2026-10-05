import { describe, expect, it } from 'vitest';
import { gatewayRef, hashRequest, mockGatewayDecision, resolveIdempotency } from '../src/domain.js';

describe('mock gateway', () => {
  it('declines tok_fail', () => {
    expect(mockGatewayDecision({ amountCents: 1000, token: 'tok_fail' })).toEqual({ approved: false, reason: 'card_declined' });
  });
  it('declines amounts ending in .13', () => {
    expect(mockGatewayDecision({ amountCents: 1013, token: 'tok_visa' }).approved).toBe(false);
    expect(mockGatewayDecision({ amountCents: 349913, token: 'tok_visa' }).reason).toBe('insufficient_funds');
  });
  it('approves everything else', () => {
    expect(mockGatewayDecision({ amountCents: 1000, token: 'tok_visa' }).approved).toBe(true);
    expect(mockGatewayDecision({ amountCents: 1012, token: 'tok_visa' }).approved).toBe(true);
  });
  it('produces stable gateway references per idempotency key', () => {
    expect(gatewayRef('order:1')).toBe(gatewayRef('order:1'));
    expect(gatewayRef('order:1')).not.toBe(gatewayRef('order:2'));
  });
});

describe('idempotency', () => {
  const h = hashRequest({ amountCents: 100, currency: 'INR', paymentToken: 't' });
  it('hash is independent of key order', () => {
    expect(hashRequest({ currency: 'INR', paymentToken: 't', amountCents: 100 })).toBe(h);
    expect(hashRequest({ currency: 'INR', paymentToken: 't', amountCents: 101 })).not.toBe(h);
  });
  it('proceeds on a new key', () => {
    expect(resolveIdempotency(undefined, h)).toEqual({ action: 'proceed' });
  });
  it('replays the stored response for the same request', () => {
    expect(resolveIdempotency({ requestHash: h, statusCode: 201, response: { ok: 1 } }, h)).toEqual({ action: 'replay', statusCode: 201, response: { ok: 1 } });
  });
  it('rejects key reuse with a different body', () => {
    expect(resolveIdempotency({ requestHash: 'other', statusCode: 201, response: {} }, h).action).toBe('conflict');
  });
  it('reports in-flight requests', () => {
    expect(resolveIdempotency({ requestHash: h, statusCode: null, response: null }, h).action).toBe('in_progress');
  });
});
