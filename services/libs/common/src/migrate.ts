import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import type { Logger } from './logger.js';

export const commonMigrationsDir = fileURLToPath(new URL('../migrations', import.meta.url));
const LOCK_ID = 7_270_001;

/**
 * Apply plain-SQL migrations (sorted by filename) exactly once, each in its own transaction.
 * A Postgres advisory lock serialises concurrent replicas starting at the same time.
 */
export async function runMigrations(pool: pg.Pool, sources: { prefix: string; dir: string }[], log: Logger): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    for (const { prefix, dir } of sources) {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
      for (const file of files) {
        const name = `${prefix}/${file}`;
        if (applied.has(name)) continue;
        const sql = fs.readFileSync(path.join(dir, file), 'utf8');
        try {
          await client.query('BEGIN');
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name]);
          await client.query('COMMIT');
          log.info({ migration: name }, 'migration applied');
        } catch (err) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw new Error(`migration ${name} failed: ${(err as Error).message}`, { cause: err });
        }
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => undefined);
    client.release();
  }
}
