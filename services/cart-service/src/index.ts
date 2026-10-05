import {
  authenticate,
  counter,
  createHttpClient,
  EventTypes,
  loadConfig,
  main,
  notFound,
  parse,
  runService,
  TOPICS,
  unprocessable,
  UpstreamError,
  type OrderConfirmed,
} from '@shopverse/common';
import { z } from 'zod';
import { addQuantity, cartKey, computeTotals, couponKey, MAX_DISTINCT_ITEMS, MAX_QTY_PER_ITEM, parseItems, type CartItem } from './cart.js';

const config = loadConfig({
  CATALOG_URL: z.string().default('http://catalog-service.shop:8080'),
  PROMOTION_URL: z.string().default('http://promotion-service.shop:8080'),
  CART_TTL_SEC: z.coerce.number().int().positive().default(7 * 86_400),
});
const cartOps = counter('cart_operations_total', 'Cart mutations', ['op']);

interface CatalogProduct {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
  active: boolean;
}

main(() =>
  runService({
    config,
    redis: true,
    consumer: {
      topics: [TOPICS.orders],
      idempotency: 'redis',
      handler: async (evt, { redis, log }) => {
        if (evt.type !== EventTypes.OrderConfirmed) return;
        const { userId } = evt.data as OrderConfirmed;
        await redis!.del(cartKey(userId), couponKey(userId));
        cartOps.inc({ op: 'clear_on_order' });
        log.info({ userId }, 'cart cleared after order confirmation');
      },
    },
    routes: (app, { redis, verifyToken }) => {
      const kv = redis!;
      const auth = authenticate(verifyToken);
      const catalog = createHttpClient('catalog-service', config.CATALOG_URL);
      const promotions = createHttpClient('promotion-service', config.PROMOTION_URL);

      const touch = (userId: string) => kv.multi().expire(cartKey(userId), config.CART_TTL_SEC).expire(couponKey(userId), config.CART_TTL_SEC).exec();

      const view = async (userId: string, token: string) => {
        const items = parseItems(await kv.hgetall(cartKey(userId)));
        const code = await kv.get(couponKey(userId));
        let coupon: { code: string; valid: boolean | null; reason?: string } | null = null;
        let discountCents = 0;
        if (code && items.length) {
          try {
            const r = await promotions.request<{ valid: boolean; discountCents: number; reason?: string }>('/api/v1/promotions/validate', {
              method: 'POST',
              headers: { authorization: `Bearer ${token}` },
              body: JSON.stringify({ code, subtotalCents: computeTotals(items).subtotalCents }),
            });
            coupon = { code, valid: r.valid, reason: r.reason };
            discountCents = r.valid ? r.discountCents : 0;
          } catch {
            coupon = { code, valid: null, reason: 'promotion service unavailable' }; // degrade gracefully
          }
        } else if (code) {
          coupon = { code, valid: null };
        }
        return { userId, items, coupon, ...computeTotals(items, discountCents) };
      };

      app.get('/api/v1/cart', { preHandler: auth }, async (req) => view(req.user!.sub, req.user!.token));

      app.post('/api/v1/cart/items', { preHandler: auth }, async (req, reply) => {
        const body = parse(z.object({ productId: z.uuid(), quantity: z.number().int().min(1).max(MAX_QTY_PER_ITEM).default(1) }), req.body);
        const userId = req.user!.sub;
        let product: CatalogProduct;
        try {
          product = await catalog.request<CatalogProduct>(`/api/v1/products/${body.productId}`);
        } catch (err) {
          if (err instanceof UpstreamError && err.status === 404) throw notFound('product');
          throw err;
        }
        if (!product.active) throw unprocessable('product is not available');
        const key = cartKey(userId);
        const existing = await kv.hget(key, body.productId);
        if (!existing && (await kv.hlen(key)) >= MAX_DISTINCT_ITEMS) throw unprocessable(`cart cannot hold more than ${MAX_DISTINCT_ITEMS} products`);
        let quantity: number;
        try {
          quantity = addQuantity(existing ? (JSON.parse(existing) as CartItem).quantity : 0, body.quantity);
        } catch (err) {
          throw unprocessable((err as Error).message);
        }
        const item: CartItem = { productId: product.id, name: product.name, unitPriceCents: product.priceCents, currency: product.currency, quantity };
        await kv.hset(key, product.id, JSON.stringify(item));
        await touch(userId);
        cartOps.inc({ op: 'add' });
        return reply.code(201).send(await view(userId, req.user!.token));
      });

      app.put('/api/v1/cart/items/:productId', { preHandler: auth }, async (req) => {
        const { productId } = parse(z.object({ productId: z.uuid() }), req.params);
        const { quantity } = parse(z.object({ quantity: z.number().int().min(0).max(MAX_QTY_PER_ITEM) }), req.body);
        const userId = req.user!.sub;
        const existing = await kv.hget(cartKey(userId), productId);
        if (!existing) throw notFound('cart item');
        if (quantity === 0) await kv.hdel(cartKey(userId), productId);
        else await kv.hset(cartKey(userId), productId, JSON.stringify({ ...(JSON.parse(existing) as CartItem), quantity }));
        await touch(userId);
        cartOps.inc({ op: 'update' });
        return view(userId, req.user!.token);
      });

      app.delete('/api/v1/cart/items/:productId', { preHandler: auth }, async (req) => {
        const { productId } = parse(z.object({ productId: z.uuid() }), req.params);
        const removed = await kv.hdel(cartKey(req.user!.sub), productId);
        if (!removed) throw notFound('cart item');
        cartOps.inc({ op: 'remove' });
        return view(req.user!.sub, req.user!.token);
      });

      app.delete('/api/v1/cart', { preHandler: auth }, async (req, reply) => {
        await kv.del(cartKey(req.user!.sub), couponKey(req.user!.sub));
        cartOps.inc({ op: 'clear' });
        return reply.code(204).send();
      });

      app.post('/api/v1/cart/coupon', { preHandler: auth }, async (req) => {
        const { code } = parse(z.object({ code: z.string().min(1).max(40) }), req.body);
        const userId = req.user!.sub;
        const items = parseItems(await kv.hgetall(cartKey(userId)));
        if (!items.length) throw unprocessable('cart is empty');
        const r = await promotions.request<{ code: string; valid: boolean; discountCents: number; reason?: string }>('/api/v1/promotions/validate', {
          method: 'POST',
          headers: { authorization: `Bearer ${req.user!.token}` },
          body: JSON.stringify({ code, subtotalCents: computeTotals(items).subtotalCents }),
        });
        if (!r.valid) throw unprocessable(`coupon not applicable: ${r.reason}`, { reason: r.reason });
        await kv.set(couponKey(userId), r.code, 'EX', config.CART_TTL_SEC);
        cartOps.inc({ op: 'coupon' });
        return view(userId, req.user!.token);
      });

      app.delete('/api/v1/cart/coupon', { preHandler: auth }, async (req) => {
        await kv.del(couponKey(req.user!.sub));
        return view(req.user!.sub, req.user!.token);
      });
    },
  }),
);
