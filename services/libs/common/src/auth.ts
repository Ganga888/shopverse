import type { FastifyReply, FastifyRequest } from 'fastify';
import { createRemoteJWKSet, errors, jwtVerify, type CryptoKey, type JWTPayload } from 'jose';
import type { KeyObject } from 'node:crypto';
import { createBreaker } from './breaker.js';
import { forbidden, unauthorized } from './errors.js';

export interface AuthUser {
  sub: string;
  email?: string;
  name?: string;
  roles: string[];
  token: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export type TokenVerifier = (token: string) => Promise<AuthUser>;

/** A JOSE validation error caused by the token itself (should not trip the JWKS circuit breaker). */
function isTokenError(err: unknown): boolean {
  return err instanceof errors.JOSEError && !(err instanceof errors.JWKSTimeout) && !(err instanceof errors.JWKSInvalid);
}

/**
 * Verify RS256 access tokens issued by auth-service. Remote JWKS (cached by jose) is fetched through a
 * circuit breaker; auth-service itself passes its local public key instead.
 */
export function createTokenVerifier(opts: { issuer: string; jwksUrl?: string; publicKey?: CryptoKey | KeyObject }): TokenVerifier {
  const options = { issuer: opts.issuer, algorithms: ['RS256'] };
  let verify: (token: string) => Promise<JWTPayload>;
  if (opts.publicKey) {
    const key = opts.publicKey;
    verify = async (token) => (await jwtVerify(token, key, options)).payload;
  } else {
    if (!opts.jwksUrl) throw new Error('jwksUrl or publicKey required');
    const jwks = createRemoteJWKSet(new URL(opts.jwksUrl), { cacheMaxAge: 10 * 60_000, cooldownDuration: 30_000, timeoutDuration: 3_000 });
    verify = async (token) => (await jwtVerify(token, jwks, options)).payload;
  }
  const breaker = createBreaker('jwks', verify, { timeout: 4000, errorFilter: isTokenError });
  return async (token) => {
    let payload: JWTPayload;
    try {
      payload = await breaker.fire(token);
    } catch (err) {
      if (isTokenError(err)) throw unauthorized('invalid or expired token');
      throw err;
    }
    if (!payload.sub) throw unauthorized('token has no subject');
    return {
      sub: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      name: typeof payload.name === 'string' ? payload.name : undefined,
      roles: Array.isArray(payload.roles) ? (payload.roles as string[]) : [],
      token,
    };
  };
}

/** Fastify preHandler that requires a valid bearer token (or `?access_token=` when allowQuery, for SSE). */
export function authenticate(verifier: TokenVerifier, opts: { allowQuery?: boolean } = {}) {
  return async (req: FastifyRequest): Promise<void> => {
    const header = req.headers.authorization;
    let token: string | undefined;
    if (header?.startsWith('Bearer ')) token = header.slice(7).trim();
    else if (opts.allowQuery) token = (req.query as Record<string, string | undefined>)?.access_token;
    if (!token) throw unauthorized();
    req.user = await verifier(token);
  };
}

export function requireRole(role: string) {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!req.user) throw unauthorized();
    if (!req.user.roles.includes(role)) throw forbidden(`role '${role}' required`);
  };
}

export function isOwnerOrAdmin(user: AuthUser | undefined, ownerId: string): boolean {
  return !!user && (user.sub === ownerId || user.roles.includes('admin'));
}
