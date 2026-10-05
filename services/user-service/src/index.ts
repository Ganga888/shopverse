import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  authenticate,
  EventTypes,
  loadConfig,
  main,
  notFound,
  parse,
  requireRole,
  runService,
  TOPICS,
  withTx,
  type AuthUser,
  type Pool,
  type UserRegistered,
} from '@shopverse/common';
import { z } from 'zod';
import { addressSchema, profilePatchSchema } from './schemas.js';

const config = loadConfig();

const profileDto = (r: Record<string, unknown>) => ({ userId: r.id, email: r.email, name: r.name, phone: r.phone, createdAt: r.created_at, updatedAt: r.updated_at });
const addressDto = (r: Record<string, unknown>) => ({
  addressId: r.id, label: r.label, name: r.name, line1: r.line1, line2: r.line2, city: r.city, state: r.state,
  postalCode: r.postal_code, country: r.country, phone: r.phone, isDefault: r.is_default,
});

/** Profiles are normally provisioned from UserRegistered; lazily create one if the event is still in flight. */
async function ensureProfile(db: Pool, user: AuthUser) {
  const { rows } = await db.query(
    `INSERT INTO profiles (id, email, name) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET id = profiles.id RETURNING *`,
    [user.sub, user.email ?? '', user.name ?? ''],
  );
  return rows[0];
}

main(() =>
  runService({
    config,
    migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
    consumer: {
      topics: [TOPICS.users],
      idempotency: 'db',
      handler: async (evt, { db }) => {
        if (evt.type !== EventTypes.UserRegistered) return;
        const u = evt.data as UserRegistered;
        await db!.query(
          'INSERT INTO profiles (id, email, name) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, updated_at = now()',
          [u.userId, u.email, u.name],
        );
      },
    },
    routes: (app, { pool, verifyToken }) => {
      const db = pool!;
      const auth = authenticate(verifyToken);

      app.get('/api/v1/users/me', { preHandler: auth }, async (req) => profileDto(await ensureProfile(db, req.user!)));

      app.patch('/api/v1/users/me', { preHandler: auth }, async (req) => {
        const body = parse(profilePatchSchema, req.body);
        await ensureProfile(db, req.user!);
        const { rows } = await db.query(
          `UPDATE profiles SET name = COALESCE($2, name), phone = CASE WHEN $3 THEN $4 ELSE phone END, updated_at = now()
           WHERE id = $1 RETURNING *`,
          [req.user!.sub, body.name ?? null, body.phone !== undefined, body.phone ?? null],
        );
        return profileDto(rows[0]);
      });

      app.get('/api/v1/users/me/addresses', { preHandler: auth }, async (req) => {
        const { rows } = await db.query('SELECT * FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at', [req.user!.sub]);
        return { items: rows.map(addressDto) };
      });

      app.post('/api/v1/users/me/addresses', { preHandler: auth }, async (req, reply) => {
        const a = parse(addressSchema, req.body);
        await ensureProfile(db, req.user!);
        const row = await withTx(db, async (tx) => {
          if (a.isDefault) await tx.query('UPDATE addresses SET is_default = false WHERE user_id = $1 AND is_default', [req.user!.sub]);
          const { rows } = await tx.query(
            `INSERT INTO addresses (id, user_id, label, name, line1, line2, city, state, postal_code, country, phone, is_default)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
            [randomUUID(), req.user!.sub, a.label, a.name, a.line1, a.line2 ?? null, a.city, a.state, a.postalCode, a.country, a.phone ?? null, a.isDefault],
          );
          return rows[0];
        });
        return reply.code(201).send(addressDto(row));
      });

      app.delete('/api/v1/users/me/addresses/:id', { preHandler: auth }, async (req, reply) => {
        const { id } = parse(z.object({ id: z.uuid() }), req.params);
        const r = await db.query('DELETE FROM addresses WHERE id = $1 AND user_id = $2', [id, req.user!.sub]);
        if (!r.rowCount) throw notFound('address');
        return reply.code(204).send();
      });

      app.get('/api/v1/users/:id', { preHandler: [auth, requireRole('admin')] }, async (req) => {
        const { id } = parse(z.object({ id: z.uuid() }), req.params);
        const { rows } = await db.query('SELECT * FROM profiles WHERE id = $1', [id]);
        if (!rows[0]) throw notFound('user');
        return profileDto(rows[0]);
      });
    },
  }),
);
