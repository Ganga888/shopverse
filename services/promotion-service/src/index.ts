import { fileURLToPath } from 'node:url';
import {
  authenticate,
  conflict,
  counter,
  loadConfig,
  main,
  notFound,
  parse,
  requireRole,
  runService,
  unprocessable,
  withTx,
} from '@shopverse/common';
import { z } from 'zod';
import { evaluateCoupon, normalizeCode, type Coupon } from './rules.js';

const config = loadConfig();
const redemptionsTotal = counter('coupon_redemptions_total', 'Coupon redemptions', ['result']);

interface CouponRow {
  code: string;
  type: 'PERCENT' | 'FIXED';
  value: number;
  min_subtotal_cents: string;
  max_discount_cents: string | null;
  starts_at: Date;
  ends_at: Date | null;
  usage_limit: number | null;
  used_count: number;
  active: boolean;
  description: string | null;
}

const toCoupon = (r: CouponRow): Coupon => ({
  code: r.code,
  type: r.type,
  value: r.value,
  minSubtotalCents: Number(r.min_subtotal_cents),
  maxDiscountCents: r.max_discount_cents === null ? null : Number(r.max_discount_cents),
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  usageLimit: r.usage_limit,
  usedCount: r.used_count,
  active: r.active,
});
const toDto = (r: CouponRow) => ({ ...toCoupon(r), description: r.description });

const checkSchema = z.object({ code: z.string().min(1).max(40), subtotalCents: z.number().int().positive() });
const createSchema = z.object({
  code: z.string().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/),
  type: z.enum(['PERCENT', 'FIXED']),
  value: z.number().int().positive(),
  minSubtotalCents: z.number().int().min(0).default(0),
  maxDiscountCents: z.number().int().positive().nullable().default(null),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().nullable().default(null),
  usageLimit: z.number().int().positive().nullable().default(null),
  description: z.string().max(200).optional(),
}).refine((c) => c.type !== 'PERCENT' || c.value <= 100, { message: 'percent value must be <= 100', path: ['value'] });

main(() =>
  runService({
    config,
    migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
    onStart: async ({ pool, config: cfg }) => {
      if (!cfg.SEED_SAMPLE_DATA) return;
      await pool!.query(
        `INSERT INTO coupons (code, type, value, min_subtotal_cents, max_discount_cents, description) VALUES
           ('WELCOME10', 'PERCENT', 10, 0, 50000, '10% off, up to ₹500'),
           ('FLAT500', 'FIXED', 50000, 200000, NULL, '₹500 off orders above ₹2000')
         ON CONFLICT DO NOTHING`,
      );
    },
    routes: (app, { pool, verifyToken }) => {
      const db = pool!;
      const auth = authenticate(verifyToken);
      const admin = [auth, requireRole('admin')];

      app.post('/api/v1/promotions/validate', { preHandler: auth }, async (req) => {
        const body = parse(checkSchema, req.body);
        const code = normalizeCode(body.code);
        const { rows } = await db.query<CouponRow>('SELECT * FROM coupons WHERE code = $1', [code]);
        if (!rows[0]) return { code, valid: false, reason: 'not_found', discountCents: 0 };
        const r = evaluateCoupon(toCoupon(rows[0]), body.subtotalCents);
        return r.valid ? { code, valid: true, discountCents: r.discountCents } : { code, valid: false, reason: r.reason, discountCents: 0 };
      });

      // Called by order-service when an order is placed: validates and consumes one use atomically.
      app.post('/api/v1/promotions/redeem', { preHandler: auth }, async (req) => {
        const body = parse(checkSchema, req.body);
        const code = normalizeCode(body.code);
        return withTx(db, async (tx) => {
          const { rows } = await tx.query<CouponRow>('SELECT * FROM coupons WHERE code = $1 FOR UPDATE', [code]);
          if (!rows[0]) {
            redemptionsTotal.inc({ result: 'not_found' });
            throw notFound('coupon');
          }
          const r = evaluateCoupon(toCoupon(rows[0]), body.subtotalCents);
          if (!r.valid) {
            redemptionsTotal.inc({ result: r.reason });
            throw unprocessable(`coupon not applicable: ${r.reason}`, { reason: r.reason });
          }
          await tx.query('UPDATE coupons SET used_count = used_count + 1 WHERE code = $1', [code]);
          await tx.query('INSERT INTO redemptions (code, user_id, discount_cents) VALUES ($1, $2, $3)', [code, req.user!.sub, r.discountCents]);
          redemptionsTotal.inc({ result: 'redeemed' });
          return { code, discountCents: r.discountCents };
        });
      });

      app.get('/api/v1/promotions', { preHandler: admin }, async () => {
        const { rows } = await db.query<CouponRow>('SELECT * FROM coupons ORDER BY created_at DESC LIMIT 500');
        return { items: rows.map(toDto) };
      });

      app.get('/api/v1/promotions/:code', { preHandler: admin }, async (req) => {
        const { code } = parse(z.object({ code: z.string().min(1).max(40) }), req.params);
        const { rows } = await db.query<CouponRow>('SELECT * FROM coupons WHERE code = $1', [normalizeCode(code)]);
        if (!rows[0]) throw notFound('coupon');
        return toDto(rows[0]);
      });

      app.post('/api/v1/promotions', { preHandler: admin }, async (req, reply) => {
        const c = parse(createSchema, req.body);
        try {
          const { rows } = await db.query<CouponRow>(
            `INSERT INTO coupons (code, type, value, min_subtotal_cents, max_discount_cents, starts_at, ends_at, usage_limit, description)
             VALUES ($1, $2, $3, $4, $5, COALESCE($6, now()), $7, $8, $9) RETURNING *`,
            [normalizeCode(c.code), c.type, c.value, c.minSubtotalCents, c.maxDiscountCents, c.startsAt ?? null, c.endsAt, c.usageLimit, c.description ?? null],
          );
          return reply.code(201).send(toDto(rows[0]));
        } catch (err) {
          if ((err as { code?: string }).code === '23505') throw conflict('coupon code already exists');
          throw err;
        }
      });

      app.patch('/api/v1/promotions/:code', { preHandler: admin }, async (req) => {
        const { code } = parse(z.object({ code: z.string().min(1).max(40) }), req.params);
        const body = parse(z.object({ active: z.boolean().optional(), endsAt: z.coerce.date().nullable().optional(), usageLimit: z.number().int().positive().nullable().optional() }), req.body);
        const { rows } = await db.query<CouponRow>(
          `UPDATE coupons SET active = COALESCE($2, active),
                              ends_at = CASE WHEN $3 THEN $4 ELSE ends_at END,
                              usage_limit = CASE WHEN $5 THEN $6 ELSE usage_limit END
            WHERE code = $1 RETURNING *`,
          [normalizeCode(code), body.active ?? null, body.endsAt !== undefined, body.endsAt ?? null, body.usageLimit !== undefined, body.usageLimit ?? null],
        );
        if (!rows[0]) throw notFound('coupon');
        return toDto(rows[0]);
      });
    },
  }),
);
