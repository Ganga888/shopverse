import fs from 'node:fs';
import pg from 'pg';
import type { BaseConfig } from './config.js';
import type { Logger } from './logger.js';

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;
export type Queryable = Pick<pg.Pool, 'query'> | pg.PoolClient;

export function createPool(cfg: BaseConfig, log: Logger): pg.Pool {
  let ssl: pg.PoolConfig['ssl'] = false;
  if (cfg.dbSsl) {
    ssl = fs.existsSync(cfg.DB_SSL_CA_PATH)
      ? { ca: fs.readFileSync(cfg.DB_SSL_CA_PATH, 'utf8'), rejectUnauthorized: true }
      : { rejectUnauthorized: true };
  }
  const pool = new pg.Pool({
    host: cfg.DB_HOST,
    port: cfg.DB_PORT,
    database: cfg.DB_NAME,
    user: cfg.DB_USER,
    password: cfg.DB_PASSWORD,
    ssl,
    max: cfg.DB_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: cfg.SERVICE_NAME,
    statement_timeout: 15_000,
  });
  pool.on('error', (err) => log.error({ err }, 'idle postgres client error'));
  return pool;
}

export async function withTx<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
