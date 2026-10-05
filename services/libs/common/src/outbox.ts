import { context, propagation, ROOT_CONTEXT } from '@opentelemetry/api';
import type { EventEnvelope, EventProducer } from './kafka.js';
import type { Pool, Queryable } from './db.js';
import { withTx } from './db.js';
import type { Logger } from './logger.js';
import { outboxPublished } from './metrics.js';
import { startLoop, type Stoppable } from './util.js';

/** Write an event to the outbox inside the caller's business transaction. */
export async function enqueueOutbox(db: Queryable, topic: string, evt: EventEnvelope, key: string = evt.correlationId): Promise<void> {
  const headers: Record<string, string> = {};
  propagation.inject(context.active(), headers); // traceparent/tracestate of the business transaction
  await db.query('INSERT INTO outbox (id, topic, key, payload, headers) VALUES ($1, $2, $3, $4, $5)', [
    evt.id,
    topic,
    key,
    JSON.stringify(evt),
    JSON.stringify(headers),
  ]);
}

/**
 * Relay unpublished outbox rows to Kafka. Rows are locked with FOR UPDATE SKIP LOCKED so several
 * replicas can run the relay concurrently; a row is marked published only after the broker acked it
 * (at-least-once; consumers dedupe on event id). Each message is sent inside the trace context stored with
 * it, so producer/consumer spans join the trace of the request that caused the event. Rows are sent in
 * sequence order (idempotent producer, one in-flight request) to keep per-key ordering.
 */
export function startOutboxRelay(opts: { pool: Pool; producer: EventProducer; log: Logger; intervalMs?: number; batchSize?: number }): Stoppable {
  const { pool, producer, log, intervalMs = 250, batchSize = 200 } = opts;
  let lastCleanup = 0;
  const drain = async () => {
    for (;;) {
      const n = await withTx(pool, async (db) => {
        const { rows } = await db.query<{ id: string; topic: string; key: string | null; payload: EventEnvelope; headers: Record<string, string> }>(
          'SELECT id, topic, key, payload, headers FROM outbox WHERE published_at IS NULL ORDER BY seq LIMIT $1 FOR UPDATE SKIP LOCKED',
          [batchSize],
        );
        if (!rows.length) return 0;
        for (const r of rows) {
          const parent = propagation.extract(ROOT_CONTEXT, r.headers ?? {});
          await context.with(parent, () =>
            producer.sendBatch([{ topic: r.topic, key: r.key, value: JSON.stringify(r.payload), headers: { 'ce-type': r.payload.type, 'ce-id': r.id } }]),
          );
        }
        await db.query('UPDATE outbox SET published_at = now() WHERE id = ANY($1::text[])', [rows.map((r) => r.id)]);
        return rows.length;
      });
      outboxPublished.inc(n);
      if (n < batchSize) break;
    }
    if (Date.now() - lastCleanup > 3_600_000) {
      lastCleanup = Date.now();
      await pool.query("DELETE FROM outbox WHERE published_at < now() - interval '3 days'");
      await pool.query("DELETE FROM processed_events WHERE processed_at < now() - interval '14 days'");
    }
  };
  return startLoop('outbox-relay', intervalMs, drain, (err) => log.error({ err }, 'outbox relay iteration failed'));
}
