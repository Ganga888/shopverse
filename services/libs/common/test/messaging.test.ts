import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EventProducer, makeEvent, startConsumer, type EventHandler } from '../src/kafka.js';
import { createLogger } from '../src/logger.js';
import { runMigrations } from '../src/migrate.js';
import { enqueueOutbox, startOutboxRelay } from '../src/outbox.js';

const log = createLogger('test', 'silent');

function fakeKafka() {
  const sent: { topic: string; messages: { key: string | null; value: string; headers?: Record<string, string> }[] }[] = [];
  let eachMessage: ((p: unknown) => Promise<void>) | undefined;
  const kafka = {
    producer: () => ({
      connect: async () => {},
      disconnect: async () => {},
      sendBatch: async ({ topicMessages }: { topicMessages: typeof sent }) => void sent.push(...topicMessages),
    }),
    consumer: () => ({
      connect: async () => {},
      subscribe: async () => {},
      disconnect: async () => {},
      run: async (cfg: { eachMessage: typeof eachMessage }) => void (eachMessage = cfg.eachMessage),
    }),
  };
  const deliver = (topic: string, value: string) =>
    eachMessage!({ topic, partition: 0, message: { key: Buffer.from('k'), value: Buffer.from(value) }, heartbeat: async () => {} });
  return { kafka: kafka as never, sent, deliver };
}

function fakeRedis() {
  const store = new Map<string, string>();
  return {
    set: async (k: string, v: string, ..._args: unknown[]) => (store.has(k) ? null : (store.set(k, v), 'OK')),
    del: async (k: string) => Number(store.delete(k)),
  } as never;
}

describe('EventProducer', () => {
  it('groups a batch by topic', async () => {
    const f = fakeKafka();
    const p = await EventProducer.connect(f.kafka);
    await p.sendBatch([
      { topic: 'a', key: '1', value: 'x' },
      { topic: 'b', key: '2', value: 'y' },
      { topic: 'a', key: '3', value: 'z' },
    ]);
    expect(f.sent.map((t) => [t.topic, t.messages.length])).toEqual([['a', 2], ['b', 1]]);
  });
});

describe('consumer', () => {
  it('dedupes redelivered events (redis idempotency)', async () => {
    const f = fakeKafka();
    const seen: string[] = [];
    const handler: EventHandler = async (evt) => void seen.push(evt.id);
    await startConsumer({ kafka: f.kafka, groupId: 'g', topics: ['t'], handler, producer: await EventProducer.connect(f.kafka), log, maxRetries: 3, idempotency: 'redis', redis: fakeRedis() });
    const evt = JSON.stringify(makeEvent('s', 'T', {}));
    await f.deliver('t', evt);
    await f.deliver('t', evt);
    expect(seen).toHaveLength(1);
  });

  it('retries then dead-letters to <topic>.dlq with the failure reason', async () => {
    const f = fakeKafka();
    let calls = 0;
    const handler: EventHandler = async () => {
      calls++;
      throw new Error('downstream exploded');
    };
    await startConsumer({ kafka: f.kafka, groupId: 'g', topics: ['orders.events'], handler, producer: await EventProducer.connect(f.kafka), log, maxRetries: 2, idempotency: 'redis', redis: fakeRedis() });
    await f.deliver('orders.events', JSON.stringify(makeEvent('s', 'T', {})));
    expect(calls).toBe(2);
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0].topic).toBe('orders.events.dlq');
    expect(f.sent[0].messages[0].headers).toMatchObject({ 'dlq-reason': 'downstream exploded', 'dlq-attempts': '2', 'dlq-source-group': 'g' });
  });

  it('dead-letters malformed envelopes immediately', async () => {
    const f = fakeKafka();
    await startConsumer({ kafka: f.kafka, groupId: 'g', topics: ['t'], handler: async () => {}, producer: await EventProducer.connect(f.kafka), log, maxRetries: 3, idempotency: 'redis', redis: fakeRedis() });
    await f.deliver('t', '{"not":"an envelope"}');
    expect(f.sent[0].topic).toBe('t.dlq');
  });

  it('uses processed_events inside the handler transaction (db idempotency)', async () => {
    const f = fakeKafka();
    const processed = new Set<string>();
    const statements: string[] = [];
    const client = {
      query: async (sql: string, params: unknown[] = []) => {
        statements.push(sql.split(' ')[0]);
        if (sql.startsWith('INSERT INTO processed_events')) {
          const id = params[0] as string;
          if (processed.has(id)) return { rowCount: 0, rows: [] };
          processed.add(id);
        }
        return { rowCount: 1, rows: [] };
      },
      release: () => {},
    };
    let handled = 0;
    await startConsumer({ kafka: f.kafka, groupId: 'g', topics: ['t'], handler: async (_e, ctx) => void (ctx.db && handled++), producer: await EventProducer.connect(f.kafka), log, maxRetries: 3, idempotency: 'db', pool: { connect: async () => client } as never });
    const evt = JSON.stringify(makeEvent('s', 'T', {}));
    await f.deliver('t', evt);
    await f.deliver('t', evt);
    expect(handled).toBe(1);
    expect(statements).toEqual(['BEGIN', 'INSERT', 'COMMIT', 'BEGIN', 'INSERT', 'COMMIT']);
  });
});

describe('transactional outbox', () => {
  it('stores the event with its key and relays unpublished rows', async () => {
    const rows: { id: string; topic: string; key: string; payload: unknown; headers: Record<string, string> }[] = [];
    const published: string[] = [];
    const db = {
      query: async (sql: string, params: unknown[] = []) => {
        if (sql.startsWith('INSERT INTO outbox')) {
          rows.push({ id: params[0] as string, topic: params[1] as string, key: params[2] as string, payload: JSON.parse(params[3] as string), headers: JSON.parse(params[4] as string) });
        }
        if (sql.startsWith('SELECT id, topic')) return { rows: rows.filter((r) => !published.includes(r.id)), rowCount: rows.length };
        if (sql.startsWith('UPDATE outbox')) published.push(...(params[0] as string[]));
        return { rows: [], rowCount: 0 };
      },
      release: () => {},
    };
    const evt = makeEvent('s', 'OrderCreated', { orderId: 'o1' }, 'o1');
    await enqueueOutbox(db as never, 'orders.events', evt);
    expect(rows[0]).toMatchObject({ topic: 'orders.events', key: 'o1' });

    const f = fakeKafka();
    const relay = startOutboxRelay({ pool: { connect: async () => db, query: db.query } as never, producer: await EventProducer.connect(f.kafka), log, intervalMs: 10 });
    await new Promise((r) => setTimeout(r, 50));
    await relay.stop();
    expect(published).toEqual([evt.id]);
    expect(f.sent[0].topic).toBe('orders.events');
    expect(JSON.parse(f.sent[0].messages[0].value)).toEqual(evt);
  });
});

describe('migration runner', () => {
  it('applies new files once, in order, each in a transaction', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
    fs.writeFileSync(path.join(dir, '0002_b.sql'), 'B;');
    fs.writeFileSync(path.join(dir, '0001_a.sql'), 'A;');
    fs.writeFileSync(path.join(dir, 'README.md'), 'ignored');
    const executed: string[] = [];
    const client = {
      query: async (sql: string) => {
        executed.push(sql);
        if (sql.startsWith('SELECT name')) return { rows: [{ name: 'svc/0001_a.sql' }] };
        return { rows: [] };
      },
      release: () => {},
    };
    await runMigrations({ connect: async () => client } as never, [{ prefix: 'svc', dir }], log);
    expect(executed).not.toContain('A;');
    const i = executed.indexOf('B;');
    expect(executed.slice(i - 1, i + 3)).toEqual(['BEGIN', 'B;', 'INSERT INTO schema_migrations(name) VALUES ($1)', 'COMMIT']);
    expect(executed[0]).toContain('pg_advisory_lock');
    expect(executed.at(-1)).toContain('pg_advisory_unlock');
  });
});
