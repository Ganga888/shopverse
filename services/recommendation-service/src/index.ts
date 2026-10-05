import { authenticate, counter, EventTypes, loadConfig, main, parse, runService, TOPICS, type OrderConfirmed } from '@shopverse/common';
import { z } from 'zod';
import { coPurchasePairs, keys, mergeRanked, parseScored } from './recs.js';

const config = loadConfig({ REC_TTL_SEC: z.coerce.number().int().positive().default(90 * 86_400) });
const ordersIngested = counter('recommendation_orders_ingested_total', 'Confirmed orders folded into co-purchase counts');
const limitSchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) });

main(() =>
  runService({
    config,
    redis: true,
    consumer: {
      topics: [TOPICS.orders],
      idempotency: 'redis',
      handler: async (evt, { redis }) => {
        if (evt.type !== EventTypes.OrderConfirmed) return;
        const o = evt.data as OrderConfirmed;
        const tx = redis!.multi();
        for (const [a, b] of coPurchasePairs(o.items.map((i) => i.productId))) {
          tx.zincrby(keys.co(a), 1, b).expire(keys.co(a), config.REC_TTL_SEC);
        }
        for (const i of o.items) {
          tx.zincrby(keys.popular, i.quantity, i.productId);
          tx.zincrby(keys.user(o.userId), i.quantity, i.productId);
        }
        tx.expire(keys.user(o.userId), config.REC_TTL_SEC);
        await tx.exec();
        ordersIngested.inc();
      },
    },
    routes: (app, { redis, verifyToken }) => {
      const kv = redis!;
      const popular = async (limit: number) => parseScored(await kv.zrevrange(keys.popular, 0, limit - 1, 'WITHSCORES'));

      app.get('/api/v1/recommendations/popular', async (req) => {
        const { limit } = parse(limitSchema, req.query);
        return { strategy: 'popular', items: await popular(limit) };
      });

      app.get('/api/v1/recommendations/products/:productId', async (req) => {
        const { productId } = parse(z.object({ productId: z.uuid() }), req.params);
        const { limit } = parse(limitSchema, req.query);
        const co = parseScored(await kv.zrevrange(keys.co(productId), 0, limit - 1, 'WITHSCORES'));
        const exclude = new Set([productId]);
        if (co.length >= limit) return { productId, strategy: 'co-purchase', items: co };
        // Cold start: top up with globally popular products (scaled below any co-purchase score).
        const fill = (await popular(limit + co.length + 1)).map((p) => ({ productId: p.productId, score: 0 }));
        const items = mergeRanked([co, fill], exclude, limit);
        return { productId, strategy: co.length ? 'co-purchase+popular' : 'popular', items };
      });

      app.get('/api/v1/recommendations/me', { preHandler: authenticate(verifyToken) }, async (req) => {
        const { limit } = parse(limitSchema, req.query);
        const bought = parseScored(await kv.zrevrange(keys.user(req.user!.sub), 0, 9, 'WITHSCORES'));
        if (!bought.length) return { strategy: 'popular', items: await popular(limit) };
        const pipeline = kv.pipeline();
        for (const b of bought) pipeline.zrevrange(keys.co(b.productId), 0, limit - 1, 'WITHSCORES');
        const results = (await pipeline.exec()) ?? [];
        const lists = results.map(([, r]) => parseScored((r as string[]) ?? []));
        return { strategy: 'co-purchase', items: mergeRanked(lists, new Set(bought.map((b) => b.productId)), limit) };
      });
    },
  }),
);
