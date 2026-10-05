import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  authenticate,
  conflict,
  counter,
  createHttpClient,
  enqueueOutbox,
  EventTypes,
  forbidden,
  isOwnerOrAdmin,
  loadConfig,
  main,
  makeEvent,
  notFound,
  parse,
  runService,
  TOPICS,
  UpstreamError,
  withTx,
  type ReviewCreated,
} from '@shopverse/common';
import { z } from 'zod';
import { summarize } from './summary.js';

const SOURCE = 'review-service';
const config = loadConfig({ CATALOG_URL: z.string().default('http://catalog-service.shop:8080') });
const reviewsCreated = counter('reviews_created_total', 'Reviews created', ['rating']);

const dto = (r: Record<string, unknown>) => ({
  reviewId: r.id, productId: r.product_id, userId: r.user_id, userName: r.user_name, rating: r.rating, title: r.title, body: r.body, createdAt: r.created_at,
});

main(() =>
  runService({
    config,
    migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
    kafka: true,
    outbox: true,
    routes: (app, { pool, verifyToken }) => {
      const db = pool!;
      const auth = authenticate(verifyToken);
      const catalog = createHttpClient('catalog-service', config.CATALOG_URL);

      app.get('/api/v1/reviews', async (req) => {
        const q = parse(
          z.object({ productId: z.uuid(), limit: z.coerce.number().int().min(1).max(100).default(20), offset: z.coerce.number().int().min(0).default(0) }),
          req.query,
        );
        const [list, agg] = await Promise.all([
          db.query('SELECT * FROM reviews WHERE product_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3', [q.productId, q.limit, q.offset]),
          db.query<{ rating: number; n: string }>('SELECT rating, count(*) AS n FROM reviews WHERE product_id = $1 GROUP BY rating', [q.productId]),
        ]);
        return { productId: q.productId, summary: summarize(agg.rows.map((r) => ({ rating: Number(r.rating), n: Number(r.n) }))), items: list.rows.map(dto) };
      });

      app.post('/api/v1/reviews', { preHandler: auth }, async (req, reply) => {
        const b = parse(
          z.object({ productId: z.uuid(), rating: z.number().int().min(1).max(5), title: z.string().min(1).max(200), body: z.string().max(5000).default('') }),
          req.body,
        );
        try {
          await catalog.request(`/api/v1/products/${b.productId}`);
        } catch (err) {
          if (err instanceof UpstreamError && err.status === 404) throw notFound('product');
          throw err;
        }
        const id = randomUUID();
        try {
          const row = await withTx(db, async (tx) => {
            const { rows } = await tx.query(
              'INSERT INTO reviews (id, product_id, user_id, user_name, rating, title, body) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
              [id, b.productId, req.user!.sub, req.user!.name ?? '', b.rating, b.title, b.body],
            );
            const data: ReviewCreated = { reviewId: id, productId: b.productId, userId: req.user!.sub, rating: b.rating };
            await enqueueOutbox(tx, TOPICS.reviews, makeEvent(SOURCE, EventTypes.ReviewCreated, data, b.productId), b.productId);
            return rows[0];
          });
          reviewsCreated.inc({ rating: String(b.rating) });
          return reply.code(201).send(dto(row));
        } catch (err) {
          if ((err as { code?: string }).code === '23505') throw conflict('you have already reviewed this product');
          throw err;
        }
      });

      app.delete('/api/v1/reviews/:id', { preHandler: auth }, async (req, reply) => {
        const { id } = parse(z.object({ id: z.uuid() }), req.params);
        await withTx(db, async (tx) => {
          const { rows } = await tx.query('SELECT * FROM reviews WHERE id = $1 FOR UPDATE', [id]);
          if (!rows[0]) throw notFound('review');
          if (!isOwnerOrAdmin(req.user, rows[0].user_id)) throw forbidden('not your review');
          await tx.query('DELETE FROM reviews WHERE id = $1', [id]);
          await enqueueOutbox(tx, TOPICS.reviews, makeEvent(SOURCE, EventTypes.ReviewDeleted, { reviewId: id, productId: rows[0].product_id }, rows[0].product_id), rows[0].product_id);
        });
        return reply.code(204).send();
      });
    },
  }),
);
