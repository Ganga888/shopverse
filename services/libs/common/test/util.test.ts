import { describe, expect, it } from 'vitest';
import { makeEvent, parseEnvelope } from '../src/kafka.js';
import { parse, AppError } from '../src/errors.js';
import { withTimeout } from '../src/util.js';
import { z } from 'zod';

describe('event envelope', () => {
  it('defaults correlationId to the event id and round-trips', () => {
    const evt = makeEvent('order-service', 'OrderCreated', { orderId: 'o1' });
    expect(evt.correlationId).toBe(evt.id);
    expect(parseEnvelope(JSON.stringify(evt))).toEqual(evt);
  });
  it('keeps an explicit correlation id', () => {
    expect(makeEvent('x', 'T', {}, 'saga-1').correlationId).toBe('saga-1');
  });
  it('rejects malformed envelopes', () => {
    expect(() => parseEnvelope(JSON.stringify({ type: 'x' }))).toThrow();
  });
});

describe('parse', () => {
  it('returns typed data or throws a 400', () => {
    const s = z.object({ n: z.number() });
    expect(parse(s, { n: 1 }).n).toBe(1);
    try {
      parse(s, { n: 'x' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).statusCode).toBe(400);
    }
  });
});

describe('withTimeout', () => {
  it('rejects slow promises', async () => {
    await expect(withTimeout(new Promise((r) => setTimeout(r, 100)), 10, 'x')).rejects.toThrow('timed out');
  });
});
