import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  ALL_EVENT_TOPICS,
  authenticate,
  counter,
  createBreaker,
  loadConfig,
  main,
  parse,
  requireRole,
  runService,
  startLoop,
  withTx,
} from '@shopverse/common';
import { z } from 'zod';
import { archiveKey, compress, toJsonl, type AuditRow } from './archive.js';

const config = loadConfig({
  S3_BUCKET: z.string().min(1),
  S3_ENDPOINT: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.string().default('false').transform((v) => v === 'true'),
  ARCHIVE_ENABLED: z.string().default('true').transform((v) => v === 'true'),
  ARCHIVE_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  ARCHIVE_BATCH_SIZE: z.coerce.number().int().positive().max(50_000).default(5_000),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
});
const recorded = counter('audit_events_recorded_total', 'Events written to the audit log', ['topic']);
const archived = counter('audit_events_archived_total', 'Events archived to S3');

const s3 = new S3Client({ region: config.AWS_REGION, endpoint: config.S3_ENDPOINT, forcePathStyle: config.S3_FORCE_PATH_STYLE });
const putObject = createBreaker('s3-audit-put', (key: string, body: Buffer) =>
  s3.send(new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: key, Body: body, ContentType: 'application/x-ndjson', ContentEncoding: 'gzip' })),
  { timeout: 15_000 },
);

const dto = (r: Record<string, unknown>) => ({
  id: r.id, type: r.type, source: r.source, topic: r.topic, correlationId: r.correlation_id, time: r.event_time, data: r.data, archivedAt: r.archived_at, archiveKey: r.archive_key,
});

main(() =>
  runService({
    config,
    migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
    consumer: {
      topics: ALL_EVENT_TOPICS,
      idempotency: 'db',
      handler: async (evt, { db, topic }) => {
        await db!.query(
          `INSERT INTO audit_events (id, type, source, topic, correlation_id, event_time, data)
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
          [evt.id, evt.type, evt.source, topic, evt.correlationId, evt.time, JSON.stringify(evt.data)],
        );
        recorded.inc({ topic });
      },
    },
    background: ({ pool, log }) => {
      if (!config.ARCHIVE_ENABLED) {
        log.warn('S3 archiving disabled (ARCHIVE_ENABLED=false)');
        return [];
      }
      let lastRetention = 0;
      return [
        startLoop('audit-archiver', config.ARCHIVE_INTERVAL_MS, async () => {
          // Rows stay locked (SKIP LOCKED for other replicas) until S3 acknowledged the batch.
          for (;;) {
            const n = await withTx(pool!, async (tx) => {
              const { rows } = await tx.query<AuditRow>(
                'SELECT id, type, source, topic, correlation_id, event_time, data, received_at FROM audit_events WHERE archived_at IS NULL ORDER BY received_at LIMIT $1 FOR UPDATE SKIP LOCKED',
                [config.ARCHIVE_BATCH_SIZE],
              );
              if (!rows.length) return 0;
              const key = archiveKey(new Date(), randomUUID());
              await putObject.fire(key, compress(toJsonl(rows)));
              await tx.query('UPDATE audit_events SET archived_at = now(), archive_key = $2 WHERE id = ANY($1::text[])', [rows.map((r) => r.id), key]);
              log.info({ key, count: rows.length }, 'audit batch archived');
              return rows.length;
            });
            archived.inc(n);
            if (n < config.ARCHIVE_BATCH_SIZE) break;
          }
          if (Date.now() - lastRetention > 3_600_000) {
            lastRetention = Date.now();
            const r = await pool!.query(`DELETE FROM audit_events WHERE archived_at IS NOT NULL AND archived_at < now() - ($1::int * interval '1 day')`, [config.AUDIT_RETENTION_DAYS]);
            if (r.rowCount) log.info({ deleted: r.rowCount }, 'expired archived audit rows purged from postgres');
          }
        }, (err) => log.error({ err }, 'audit archiver failed')),
      ];
    },
    onShutdown: async () => s3.destroy(),
    routes: (app, { pool, verifyToken }) => {
      const db = pool!;
      const admin = [authenticate(verifyToken), requireRole('admin')];

      app.get('/api/v1/audit/events', { preHandler: admin }, async (req) => {
        const q = parse(
          z.object({
            correlationId: z.string().max(100).optional(),
            type: z.string().max(100).optional(),
            since: z.coerce.date().optional(),
            limit: z.coerce.number().int().min(1).max(500).default(100),
          }),
          req.query,
        );
        const where: string[] = [];
        const values: unknown[] = [];
        if (q.correlationId) where.push(`correlation_id = $${values.push(q.correlationId)}`);
        if (q.type) where.push(`type = $${values.push(q.type)}`);
        if (q.since) where.push(`event_time >= $${values.push(q.since)}`);
        values.push(q.limit);
        const { rows } = await db.query(
          `SELECT * FROM audit_events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY event_time DESC LIMIT $${values.length}`,
          values,
        );
        return { items: rows.map(dto) };
      });

      app.get('/api/v1/audit/orders/:orderId', { preHandler: admin }, async (req) => {
        const { orderId } = parse(z.object({ orderId: z.uuid() }), req.params);
        const { rows } = await db.query('SELECT * FROM audit_events WHERE correlation_id = $1 ORDER BY event_time, received_at', [orderId]);
        return { orderId, timeline: rows.map(dto) };
      });
    },
  }),
);
