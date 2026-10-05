import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  AppError,
  authenticate,
  badRequest,
  conflict,
  counter,
  enqueueOutbox,
  EventTypes,
  loadConfig,
  main,
  makeEvent,
  notFound,
  parse,
  runService,
  TOPICS,
  unauthorized,
  withTx,
  type UserRegistered,
} from '@shopverse/common';
import { SignJWT } from 'jose';
import { z } from 'zod';
import { loadSigningKeys, type SigningKeys } from './keys.js';
import { hashPassword, newRefreshToken, passwordPolicyError, sha256, verifyPassword } from './password.js';

const SOURCE = 'auth-service';
const config = loadConfig({
  JWT_PRIVATE_KEY: z.string().optional(),
  JWT_PUBLIC_KEY: z.string().optional(),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(7 * 86_400),
  ADMIN_EMAILS: z.string().default(''),
  LOGIN_MAX_FAILURES: z.coerce.number().int().positive().default(10),
});
const adminEmails = new Set(config.ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean));
const registrations = counter('user_registrations_total', 'Users registered');
const logins = counter('auth_logins_total', 'Login attempts', ['result']);

let keys: SigningKeys;

const credentials = z.object({ email: z.email().max(254), password: z.string().min(1).max(128) });
const registerSchema = credentials.extend({ name: z.string().min(1).max(120) });

interface UserRow {
  id: string;
  email: string;
  name: string;
  roles: string[];
  password_hash: string;
}

async function issueAccessToken(u: Pick<UserRow, 'id' | 'email' | 'name' | 'roles'>): Promise<string> {
  return new SignJWT({ email: u.email, name: u.name, roles: u.roles })
    .setProtectedHeader({ alg: 'RS256', kid: keys.kid, typ: 'JWT' })
    .setSubject(u.id)
    .setIssuer(config.JWT_ISSUER)
    .setIssuedAt()
    .setJti(randomUUID())
    .setExpirationTime(`${config.ACCESS_TOKEN_TTL_SEC}s`)
    .sign(keys.privateKey);
}

main(() =>
  runService({
    config,
    migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
    redis: true,
    kafka: true,
    outbox: true,
    publicKey: async () => {
      keys = await loadSigningKeys(config.JWT_PRIVATE_KEY, config.JWT_PUBLIC_KEY, !config.isProd);
      return keys.publicKey;
    },
    routes: (app, { pool, redis, verifyToken }) => {
      const db = pool!;
      const kv = redis!;
      const refreshKey = (token: string) => `auth:rt:${sha256(token)}`;

      const issueTokens = async (u: Pick<UserRow, 'id' | 'email' | 'name' | 'roles'>) => {
        const refreshToken = newRefreshToken();
        await kv.set(refreshKey(refreshToken), JSON.stringify({ userId: u.id }), 'EX', config.REFRESH_TOKEN_TTL_SEC);
        return { accessToken: await issueAccessToken(u), refreshToken, tokenType: 'Bearer', expiresIn: config.ACCESS_TOKEN_TTL_SEC };
      };

      app.get('/api/v1/auth/.well-known/jwks.json', async (_req, reply) => {
        return reply.header('cache-control', 'public, max-age=300').send({ keys: [keys.jwk] });
      });

      app.post('/api/v1/auth/register', async (req, reply) => {
        const body = parse(registerSchema, req.body);
        const policy = passwordPolicyError(body.password);
        if (policy) throw badRequest(policy);
        const email = body.email.toLowerCase();
        const id = randomUUID();
        const roles = adminEmails.has(email) ? ['customer', 'admin'] : ['customer'];
        const passwordHash = await hashPassword(body.password);
        try {
          await withTx(db, async (tx) => {
            await tx.query('INSERT INTO users (id, email, password_hash, name, roles) VALUES ($1, $2, $3, $4, $5)', [id, email, passwordHash, body.name, roles]);
            const data: UserRegistered = { userId: id, email, name: body.name };
            await enqueueOutbox(tx, TOPICS.users, makeEvent(SOURCE, EventTypes.UserRegistered, data, id), id);
          });
        } catch (err) {
          if ((err as { code?: string }).code === '23505') throw conflict('email already registered');
          throw err;
        }
        registrations.inc();
        return reply.code(201).send({ userId: id, email, name: body.name, roles });
      });

      app.post('/api/v1/auth/login', async (req) => {
        const body = parse(credentials, req.body);
        const email = body.email.toLowerCase();
        const failKey = `auth:fail:${sha256(email)}`;
        const failures = Number((await kv.get(failKey)) ?? 0);
        if (failures >= config.LOGIN_MAX_FAILURES) {
          logins.inc({ result: 'locked' });
          throw new AppError(429, 'TOO_MANY_ATTEMPTS', 'too many failed logins, try again later');
        }
        const { rows } = await db.query<UserRow>('SELECT id, email, name, roles, password_hash FROM users WHERE lower(email) = $1', [email]);
        const user = rows[0];
        if (!user || !(await verifyPassword(body.password, user.password_hash))) {
          await kv.multi().incr(failKey).expire(failKey, 900).exec();
          logins.inc({ result: 'failure' });
          throw unauthorized('invalid email or password');
        }
        await kv.del(failKey);
        await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
        logins.inc({ result: 'success' });
        return { ...(await issueTokens(user)), user: { userId: user.id, email: user.email, name: user.name, roles: user.roles } };
      });

      app.post('/api/v1/auth/refresh', async (req) => {
        const { refreshToken } = parse(z.object({ refreshToken: z.string().min(20).max(200) }), req.body);
        // GETDEL makes rotation atomic: a refresh token can be used exactly once.
        const stored = await kv.getdel(refreshKey(refreshToken));
        if (!stored) throw unauthorized('invalid refresh token');
        const { userId } = JSON.parse(stored) as { userId: string };
        const { rows } = await db.query<UserRow>('SELECT id, email, name, roles, password_hash FROM users WHERE id = $1', [userId]);
        if (!rows[0]) throw unauthorized('user no longer exists');
        return issueTokens(rows[0]);
      });

      app.post('/api/v1/auth/logout', async (req, reply) => {
        const { refreshToken } = parse(z.object({ refreshToken: z.string().min(1).max(200) }), req.body);
        await kv.del(refreshKey(refreshToken));
        return reply.code(204).send();
      });

      app.get('/api/v1/auth/me', { preHandler: authenticate(verifyToken) }, async (req) => {
        const { rows } = await db.query('SELECT id, email, name, roles, created_at, last_login_at FROM users WHERE id = $1', [req.user!.sub]);
        if (!rows[0]) throw notFound('user');
        const u = rows[0];
        return { userId: u.id, email: u.email, name: u.name, roles: u.roles, createdAt: u.created_at, lastLoginAt: u.last_login_at };
      });
    },
  }),
);
