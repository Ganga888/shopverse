import { fileURLToPath } from 'node:url';
import { counter, loadConfig, main, parse, runService, TOPICS, type ProductChanged } from '@shopverse/common';
import { z } from 'zod';
import { buildSearchQuery } from './query.js';

const config = loadConfig();
const indexed = counter('search_documents_indexed_total', 'Catalog events applied to the search index', ['result']);

const searchSchema = z.object({
  q: z.string().max(200).optional(),
  category: z.string().max(64).optional(),
  minPriceCents: z.coerce.number().int().min(0).optional(),
  maxPriceCents: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

main(() =>
  runService({
    config,
    migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
    consumer: {
      topics: [TOPICS.catalog],
      idempotency: 'db',
      handler: async (evt, { db }) => {
        const p = evt.data as ProductChanged;
        if (!p?.productId) return;
        // Version guard: an older event never overwrites a newer document (out-of-order delivery).
        const r = await db!.query(
          `INSERT INTO search_documents (product_id, sku, name, description, category, price_cents, currency, image_url, active, version, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
           ON CONFLICT (product_id) DO UPDATE SET
             sku = EXCLUDED.sku, name = EXCLUDED.name, description = EXCLUDED.description, category = EXCLUDED.category,
             price_cents = EXCLUDED.price_cents, currency = EXCLUDED.currency, image_url = EXCLUDED.image_url,
             active = EXCLUDED.active, version = EXCLUDED.version, updated_at = now()
           WHERE search_documents.version <= EXCLUDED.version`,
          [p.productId, p.sku, p.name, p.description, p.category, p.priceCents, p.currency, p.imageUrl, evt.type === 'ProductDeleted' ? false : p.active, p.version],
        );
        indexed.inc({ result: r.rowCount ? 'applied' : 'stale' });
      },
    },
    routes: (app, { pool }) => {
      app.get('/api/v1/search', async (req) => {
        const params = parse(searchSchema, req.query);
        const { sql, values } = buildSearchQuery(params);
        const { rows } = await pool!.query(sql, values);
        return {
          query: params.q ?? '',
          total: rows[0] ? Number(rows[0].total) : 0,
          items: rows.map((r) => ({
            productId: r.product_id,
            sku: r.sku,
            name: r.name,
            description: r.description,
            category: r.category,
            priceCents: Number(r.price_cents),
            currency: r.currency,
            imageUrl: r.image_url,
            score: Number(r.rank),
          })),
        };
      });
    },
  }),
);
