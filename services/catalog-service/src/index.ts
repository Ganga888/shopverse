import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  authenticate,
  conflict,
  counter,
  enqueueOutbox,
  EventTypes,
  loadConfig,
  main,
  makeEvent,
  notFound,
  parse,
  requireRole,
  runService,
  SAMPLE_PRODUCTS,
  TOPICS,
  withTx,
  type Logger,
  type PoolClient,
  type Redis,
} from '@shopverse/common';
import { z } from 'zod';
import { CACHE, toEventData, toProduct, type Product, type ProductRow } from './model.js';

const SOURCE = 'catalog-service';
const config = loadConfig({ CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(CACHE.productTtlSec) });
const cacheOps = counter('catalog_cache_requests_total', 'Catalog cache lookups', ['kind', 'result']);
const productWrites = counter('catalog_product_writes_total', 'Product mutations', ['op']);

const createSchema = z.object({
  sku: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  description: z.string().max(5000).default(''),
  category: z.string().min(1).max(64).transform((c) => c.toLowerCase()),
  priceCents: z.number().int().min(0).max(100_000_000),
  currency: z.string().length(3).default('INR'),
  imageUrl: z.url().nullable().default(null),
});
const updateSchema = createSchema.partial().extend({ active: z.boolean().optional() });
const listSchema = z.object({
  category: z.string().max(64).optional(),
  ids: z.string().max(4000).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

async function writeEvent(tx: PoolClient, type: string, p: Product) {
  await enqueueOutbox(tx, TOPICS.catalog, makeEvent(SOURCE, type, toEventData(p), p.id), p.id);
}

/** Cache helpers never fail the request: Redis problems degrade to DB reads. */
function cache(redis: Redis, log: Logger) {
  return {
    async get<T>(key: string, kind: string): Promise<T | null> {
      try {
        const v = await redis.get(key);
        cacheOps.inc({ kind, result: v ? 'hit' : 'miss' });
        return v ? (JSON.parse(v) as T) : null;
      } catch (err) {
        cacheOps.inc({ kind, result: 'error' });
        log.warn({ err: (err as Error).message }, 'cache read failed');
        return null;
      }
    },
    async set(key: string, value: unknown, ttl: number) {
      await redis.set(key, JSON.stringify(value), 'EX', ttl).catch((err) => log.warn({ err: err.message }, 'cache write failed'));
    },
    async invalidate(id: string) {
      await redis
        .multi()
        .del(CACHE.productKey(id))
        .incr(CACHE.generationKey)
        .exec()
        .catch((err) => log.warn({ err: err.message }, 'cache invalidation failed'));
    },
    async generation(): Promise<string> {
      return (await redis.get(CACHE.generationKey).catch(() => null)) ?? '0';
    },
  };
}

main(() =>
  runService({
    config,
    migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
    redis: true,
    kafka: true,
    outbox: true,
    onStart: async ({ pool, config: cfg, log }) => {
      if (!cfg.SEED_SAMPLE_DATA) return;
      await withTx(pool!, async (tx) => {
        for (const s of SAMPLE_PRODUCTS) {
          const { rows } = await tx.query<ProductRow>(
            `INSERT INTO products (id, sku, name, description, category, price_cents, image_url)
             VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING RETURNING *`,
            [s.id, s.sku, s.name, s.description, s.category, s.priceCents, s.imageUrl],
          );
          if (rows[0]) await writeEvent(tx, EventTypes.ProductCreated, toProduct(rows[0]));
        }
      });
      log.info('sample catalogue seeded');
    },
    routes: (app, { pool, redis, log, verifyToken }) => {
      const db = pool!;
      const c = cache(redis!, log);
      const admin = [authenticate(verifyToken), requireRole('admin')];

      app.get('/api/v1/products', async (req) => {
        const q = parse(listSchema, req.query);
        if (q.ids) {
          // Authoritative lookup used by order/cart services: always from the database.
          const ids = q.ids.split(',').filter((id) => z.uuid().safeParse(id).success).slice(0, 100);
          const { rows } = await db.query<ProductRow>('SELECT * FROM products WHERE id = ANY($1::uuid[])', [ids]);
          return { items: rows.map(toProduct), page: 1, limit: ids.length, total: rows.length };
        }
        const key = CACHE.listKey(await c.generation(), { category: q.category ?? null, page: q.page, limit: q.limit });
        const cached = await c.get<unknown>(key, 'list');
        if (cached) return cached;
        const params: unknown[] = [q.limit, (q.page - 1) * q.limit];
        const where = q.category ? 'WHERE active AND category = $3' : 'WHERE active';
        if (q.category) params.push(q.category.toLowerCase());
        const [list, count] = await Promise.all([
          db.query<ProductRow>(`SELECT * FROM products ${where} ORDER BY created_at DESC, id LIMIT $1 OFFSET $2`, params),
          db.query<{ n: string }>(`SELECT count(*) AS n FROM products ${where.replace('$3', '$1')}`, q.category ? [q.category.toLowerCase()] : []),
        ]);
        const body = { items: list.rows.map(toProduct), page: q.page, limit: q.limit, total: Number(count.rows[0].n) };
        await c.set(key, body, CACHE.listTtlSec);
        return body;
      });

      app.get('/api/v1/products/:id', async (req) => {
        const { id } = parse(z.object({ id: z.uuid() }), req.params);
        const cached = await c.get<Product>(CACHE.productKey(id), 'product');
        if (cached) return cached;
        const { rows } = await db.query<ProductRow>('SELECT * FROM products WHERE id = $1', [id]);
        if (!rows[0]) throw notFound('product');
        const p = toProduct(rows[0]);
        await c.set(CACHE.productKey(id), p, config.CACHE_TTL_SECONDS);
        return p;
      });

      app.post('/api/v1/products', { preHandler: admin }, async (req, reply) => {
        const b = parse(createSchema, req.body);
        try {
          const p = await withTx(db, async (tx) => {
            const { rows } = await tx.query<ProductRow>(
              `INSERT INTO products (id, sku, name, description, category, price_cents, currency, image_url)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
              [randomUUID(), b.sku, b.name, b.description, b.category, b.priceCents, b.currency.toUpperCase(), b.imageUrl],
            );
            const created = toProduct(rows[0]);
            await writeEvent(tx, EventTypes.ProductCreated, created);
            return created;
          });
          productWrites.inc({ op: 'create' });
          await c.invalidate(p.id);
          return reply.code(201).send(p);
        } catch (err) {
          if ((err as { code?: string }).code === '23505') throw conflict('sku already exists');
          throw err;
        }
      });

      app.put('/api/v1/products/:id', { preHandler: admin }, async (req) => {
        const { id } = parse(z.object({ id: z.uuid() }), req.params);
        const b = parse(updateSchema, req.body);
        const p = await withTx(db, async (tx) => {
          const { rows } = await tx.query<ProductRow>(
            `UPDATE products SET
               sku = COALESCE($2, sku), name = COALESCE($3, name), description = COALESCE($4, description),
               category = COALESCE($5, category), price_cents = COALESCE($6, price_cents), currency = COALESCE($7, currency),
               image_url = CASE WHEN $8 THEN $9 ELSE image_url END, active = COALESCE($10, active),
               version = version + 1, updated_at = now()
             WHERE id = $1 RETURNING *`,
            [id, b.sku ?? null, b.name ?? null, b.description ?? null, b.category ?? null, b.priceCents ?? null, b.currency?.toUpperCase() ?? null, b.imageUrl !== undefined, b.imageUrl ?? null, b.active ?? null],
          );
          if (!rows[0]) throw notFound('product');
          const updated = toProduct(rows[0]);
          await writeEvent(tx, EventTypes.ProductUpdated, updated);
          return updated;
        });
        productWrites.inc({ op: 'update' });
        await c.invalidate(id);
        return p;
      });

      app.delete('/api/v1/products/:id', { preHandler: admin }, async (req, reply) => {
        const { id } = parse(z.object({ id: z.uuid() }), req.params);
        await withTx(db, async (tx) => {
          const { rows } = await tx.query<ProductRow>('UPDATE products SET active = false, version = version + 1, updated_at = now() WHERE id = $1 RETURNING *', [id]);
          if (!rows[0]) throw notFound('product');
          await writeEvent(tx, EventTypes.ProductDeleted, toProduct(rows[0]));
        });
        productWrites.inc({ op: 'delete' });
        await c.invalidate(id);
        return reply.code(204).send();
      });
    },
  }),
);
