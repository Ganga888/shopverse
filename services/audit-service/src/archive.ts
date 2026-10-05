import { gzipSync } from 'node:zlib';

export interface AuditRow {
  id: string;
  type: string;
  source: string;
  topic: string;
  correlation_id: string;
  event_time: Date | string;
  data: unknown;
  received_at: Date | string;
}

/** One JSON object per line, in the CloudEvents-style envelope plus audit metadata. */
export function toJsonl(rows: AuditRow[]): string {
  return rows
    .map((r) =>
      JSON.stringify({
        id: r.id,
        type: r.type,
        source: r.source,
        topic: r.topic,
        correlationId: r.correlation_id,
        time: new Date(r.event_time).toISOString(),
        receivedAt: new Date(r.received_at).toISOString(),
        data: r.data,
      }),
    )
    .join('\n') + '\n';
}

/** Hive-style partitioned key (Athena friendly): events/dt=YYYY-MM-DD/hour=HH/<ts>-<batchId>.jsonl.gz */
export function archiveKey(now: Date, batchId: string): string {
  const iso = now.toISOString();
  return `events/dt=${iso.slice(0, 10)}/hour=${iso.slice(11, 13)}/${iso.replace(/[:.]/g, '-')}-${batchId}.jsonl.gz`;
}

export function compress(jsonl: string): Buffer {
  return gzipSync(Buffer.from(jsonl, 'utf8'));
}
