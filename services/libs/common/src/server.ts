import { randomUUID } from 'node:crypto';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import type { Admin } from 'kafkajs';
import type { KeyObject } from 'node:crypto';
import type { CryptoKey } from 'jose';
import { createTokenVerifier, type TokenVerifier } from './auth.js';
import type { BaseConfig } from './config.js';
import { createPool, type Pool } from './db.js';
import { registerErrorHandler } from './errors.js';
import { registerHealthRoutes, type HealthCheck, type LifecycleState } from './health.js';
import { connectAdmin, createKafka, EventProducer, startConsumer, type EventHandler, type Kafka, type RunningConsumer } from './kafka.js';
import { createLogger, type Logger } from './logger.js';
import { initMetrics, httpRequestDuration } from './metrics.js';
import { commonMigrationsDir, runMigrations } from './migrate.js';
import { startOutboxRelay } from './outbox.js';
import { createRedis, type Redis } from './redis.js';
import { sleep, type Stoppable } from './util.js';

const SHUTDOWN_KEY = Symbol.for('shopverse.otel.shutdown');

export interface ServiceDeps<C extends BaseConfig> {
  config: C;
  log: Logger;
  pool: Pool | undefined;
  redis: Redis | undefined;
  kafka: Kafka | undefined;
  producer: EventProducer | undefined;
  verifyToken: TokenVerifier;
  state: LifecycleState;
}

export interface ServiceDefinition<C extends BaseConfig> {
  config: C;
  /** Service SQL migrations directory; presence enables Postgres (pool + common + service migrations). */
  migrationsDir?: string;
  redis?: boolean;
  /** Connect an idempotent producer. */
  kafka?: boolean;
  /** Run the transactional outbox relay (requires migrationsDir + kafka). */
  outbox?: boolean;
  consumer?: { topics: string[]; handler: EventHandler; idempotency: 'db' | 'redis' };
  /** Local key for verifying tokens (auth-service); others use JWKS_URL. */
  publicKey?: () => Promise<CryptoKey | KeyObject>;
  routes: (app: FastifyInstance, deps: ServiceDeps<C>) => Promise<void> | void;
  background?: (deps: ServiceDeps<C>) => Stoppable[] | Promise<Stoppable[]>;
  /** Run once after migrations (e.g. seed sample data). */
  onStart?: (deps: ServiceDeps<C>) => Promise<void>;
  /** Extra cleanup run during shutdown after Kafka/background are stopped. */
  onShutdown?: () => Promise<void>;
}

export async function runService<C extends BaseConfig>(def: ServiceDefinition<C>): Promise<void> {
  const cfg = def.config;
  const log = createLogger(cfg.SERVICE_NAME, cfg.LOG_LEVEL);
  initMetrics(cfg.SERVICE_NAME);
  process.on('unhandledRejection', (err) => log.error({ err }, 'unhandled rejection'));
  process.on('uncaughtException', (err) => {
    log.fatal({ err }, 'uncaught exception');
    process.exit(1);
  });

  const state: LifecycleState = { shuttingDown: false, started: false };
  const checks: HealthCheck[] = [];
  const stoppables: Stoppable[] = [];
  let consumer: RunningConsumer | undefined;
  let admin: Admin | undefined;

  let pool: Pool | undefined;
  if (def.migrationsDir) {
    pool = createPool(cfg, log);
    await runMigrations(pool, [
      { prefix: 'common', dir: commonMigrationsDir },
      { prefix: cfg.SERVICE_NAME, dir: def.migrationsDir },
    ], log);
    const p = pool;
    checks.push({ name: 'postgres', check: () => p.query('SELECT 1') });
  }

  let redis: Redis | undefined;
  if (def.redis || def.consumer?.idempotency === 'redis') {
    if (!cfg.REDIS_URL) throw new Error('REDIS_URL is required');
    redis = createRedis(cfg.REDIS_URL, log);
    const r = redis;
    checks.push({ name: 'redis', check: () => r.ping() });
  }

  let kafka: Kafka | undefined;
  let producer: EventProducer | undefined;
  if (def.kafka || def.consumer || def.outbox) {
    if (!cfg.kafkaBrokers.length) throw new Error('KAFKA_BROKERS is required');
    kafka = createKafka(cfg, log);
    producer = await EventProducer.connect(kafka);
    admin = await connectAdmin(kafka);
    const a = admin;
    checks.push({ name: 'kafka', check: () => a.describeCluster() });
  }

  const verifyToken = createTokenVerifier({
    issuer: cfg.JWT_ISSUER,
    jwksUrl: cfg.JWKS_URL,
    publicKey: def.publicKey ? await def.publicKey() : undefined,
  });
  const deps: ServiceDeps<C> = { config: cfg, log, pool, redis, kafka, producer, verifyToken, state };

  if (def.onStart) await def.onStart(deps);

  const app = buildApp(log);
  registerHealthRoutes(app, checks, state);
  await def.routes(app, deps);

  await app.listen({ host: '0.0.0.0', port: cfg.PORT });

  if (def.consumer && kafka && producer) {
    consumer = await startConsumer({
      kafka,
      producer,
      log,
      groupId: cfg.SERVICE_NAME,
      topics: def.consumer.topics,
      handler: def.consumer.handler,
      maxRetries: cfg.KAFKA_MAX_RETRIES,
      idempotency: def.consumer.idempotency,
      pool,
      redis,
    });
  }
  if (def.outbox) {
    if (!pool || !producer) throw new Error('outbox requires postgres and kafka');
    stoppables.push(startOutboxRelay({ pool, producer, log, intervalMs: cfg.OUTBOX_POLL_INTERVAL_MS }));
  }
  if (def.background) stoppables.push(...(await def.background(deps)));
  state.started = true;
  log.info({ port: cfg.PORT }, 'service started');

  const shutdown = async (signal: string) => {
    if (state.shuttingDown) return;
    state.shuttingDown = true;
    log.info({ signal }, 'shutdown started: failing readiness');
    const force = setTimeout(() => {
      log.error('graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, cfg.SHUTDOWN_TIMEOUT_MS);
    force.unref();
    try {
      // Give the load balancer / endpoints controller time to stop routing to this pod.
      await sleep(cfg.SHUTDOWN_DELAY_MS);
      await app.close(); // stop accepting, finish in-flight requests
      if (consumer) await consumer.stop(); // finish current message, commit offsets
      for (const s of stoppables) await s.stop();
      if (def.onShutdown) await def.onShutdown();
      await producer?.disconnect();
      await admin?.disconnect();
      await pool?.end();
      await redis?.quit();
      const otel = (globalThis as Record<symbol, unknown>)[SHUTDOWN_KEY] as (() => Promise<void>) | undefined;
      if (otel) await otel().catch(() => undefined);
      log.info('shutdown complete');
      process.exit(0);
    } catch (err) {
      log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

/** Fastify instance with the shared conventions: logger, request ids, JSON parsing, metrics hook, error handler. */
export function buildApp(log: Logger): FastifyInstance {
  const app = Fastify({
    loggerInstance: log,
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: true,
    bodyLimit: 1_048_576,
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
    forceCloseConnections: 'idle',
  }) as unknown as FastifyInstance;

  // Accept bodyless requests that still send `content-type: application/json` (common in HTTP clients),
  // while keeping Fastify's prototype-poisoning protection for real bodies.
  const defaultJsonParser = app.getDefaultJsonParser('error', 'error');
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    if (body === '') return done(null, undefined);
    defaultJsonParser(req, body as string, done);
  });

  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions.url ?? 'unmatched';
    const status = reply.statusCode;
    httpRequestDuration.observe({ route, method: req.method, status: String(status) }, reply.elapsedTime / 1000);
    if (!route.startsWith('/healthz') && route !== '/metrics') {
      req.log[status >= 500 ? 'error' : 'info']({ method: req.method, route, url: req.url, status, durationMs: Math.round(reply.elapsedTime) }, 'request completed');
    }
  });
  registerErrorHandler(app);
  return app;
}

/** Convenience used by each service's index.ts to log startup failures and exit non-zero. */
export function main(start: () => Promise<void>): void {
  start().catch((err) => {
    console.error(JSON.stringify({ level: 'fatal', message: 'startup failed', err: String(err?.stack ?? err) }));
    process.exit(1);
  });
}
