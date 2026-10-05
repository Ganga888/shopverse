import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { archiveKey, compress, toJsonl } from '../src/archive.js';

const row = { id: 'e1', type: 'OrderCreated', source: 'order-service', topic: 'orders.events', correlation_id: 'o1', event_time: '2026-03-01T10:00:00.000Z', data: { a: 1 }, received_at: '2026-03-01T10:00:01.000Z' };

describe('audit archive', () => {
  it('writes one JSON document per line', () => {
    const out = toJsonl([row, { ...row, id: 'e2' }]);
    const lines = out.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({ id: 'e1', correlationId: 'o1', topic: 'orders.events', data: { a: 1 } });
  });
  it('builds partitioned keys', () => {
    expect(archiveKey(new Date('2026-03-01T09:05:06.789Z'), 'b1')).toBe('events/dt=2026-03-01/hour=09/2026-03-01T09-05-06-789Z-b1.jsonl.gz');
  });
  it('gzips round-trip', () => {
    expect(gunzipSync(compress('x\n')).toString()).toBe('x\n');
  });
});
