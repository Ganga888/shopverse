import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import { generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { authenticate, createTokenVerifier, requireRole } from '../src/auth.js';
import { createHttpClient } from '../src/breaker.js';
import { loadConfig } from '../src/config.js';
import { AppError, registerErrorHandler, UpstreamError } from '../src/errors.js';
import { registerHealthRoutes } from '../src/health.js';

let server: Server;
let base: string;
beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/ok') return res.writeHead(200, { 'content-type': 'application/json' }).end('{"a":1}');
    if (req.url === '/missing') return res.writeHead(404).end('{"error":"nope"}');
    return res.writeHead(500).end('boom');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('http client with circuit breaker', () => {
  it('returns parsed JSON', async () => {
    expect(await createHttpClient('t1', base).request('/ok')).toEqual({ a: 1 });
  });
  it('maps non-2xx to UpstreamError without tripping on 4xx', async () => {
    const c = createHttpClient('t2', base);
    for (let i = 0; i < 6; i++) await expect(c.request('/missing')).rejects.toBeInstanceOf(UpstreamError);
    expect(c.breaker.opened).toBe(false);
  });
  it('opens after repeated 5xx and then fails fast', async () => {
    const c = createHttpClient('t3', base);
    for (let i = 0; i < 6; i++) await c.request('/fail').catch(() => undefined);
    expect(c.breaker.opened).toBe(true);
    await expect(c.request('/ok')).rejects.toMatchObject({ code: 'EOPENBREAKER' });
  });
});

describe('config', () => {
  it('parses base and extra variables', () => {
    const cfg = loadConfig({ EXTRA: z.string().default('x') }, { SERVICE_NAME: 's', NODE_ENV: 'production', KAFKA_BROKERS: 'a:1, b:2', KAFKA_SSL: 'true' });
    expect(cfg.PORT).toBe(8080);
    expect(cfg.kafkaBrokers).toEqual(['a:1', 'b:2']);
    expect(cfg.KAFKA_SSL).toBe(true);
    expect(cfg.dbSsl).toBe(true);
    expect(cfg.EXTRA).toBe('x');
    expect(loadConfig({}, { SERVICE_NAME: 's', DB_SSL: 'false', NODE_ENV: 'production' }).dbSsl).toBe(false);
  });
});

describe('auth + error handling + health (fastify inject)', () => {
  const issuer = 'https://api.test/api/v1/auth';
  it('verifies RS256 tokens, enforces roles and maps errors', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const sign = (claims: Record<string, unknown>, iss = issuer) =>
      new SignJWT(claims).setProtectedHeader({ alg: 'RS256' }).setSubject('u1').setIssuer(iss).setExpirationTime('5m').sign(privateKey);
    const verifier = createTokenVerifier({ issuer, publicKey });
    const app = Fastify();
    registerErrorHandler(app);
    const state = { started: true, shuttingDown: false };
    registerHealthRoutes(app, [{ name: 'dep', check: async () => 'ok' }], state);
    app.get('/me', { preHandler: authenticate(verifier) }, async (req) => req.user);
    app.get('/admin', { preHandler: [authenticate(verifier), requireRole('admin')] }, async () => ({ ok: true }));
    app.get('/teapot', async () => {
      throw new AppError(418, 'TEAPOT', 'short and stout');
    });
    app.get('/crash', async () => {
      throw new Error('secret detail');
    });

    const user = await sign({ email: 'a@b.c', roles: ['customer'] });
    const me = await app.inject({ url: '/me', headers: { authorization: `Bearer ${user}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ sub: 'u1', email: 'a@b.c', roles: ['customer'] });
    expect((await app.inject({ url: '/me' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/me', headers: { authorization: `Bearer ${await sign({}, 'https://evil')}` } })).statusCode).toBe(401);
    expect((await app.inject({ url: '/admin', headers: { authorization: `Bearer ${user}` } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/admin', headers: { authorization: `Bearer ${await sign({ roles: ['admin'] })}` } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/teapot' })).json()).toEqual({ error: { code: 'TEAPOT', message: 'short and stout' } });
    const crash = await app.inject({ url: '/crash' });
    expect(crash.statusCode).toBe(500);
    expect(crash.body).not.toContain('secret detail');
    expect((await app.inject({ url: '/nope' })).statusCode).toBe(404);

    expect((await app.inject({ url: '/healthz/live' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/healthz/ready' })).json()).toEqual({ status: 'ok', checks: { dep: 'ok' } });
    state.shuttingDown = true;
    expect((await app.inject({ url: '/healthz/ready' })).statusCode).toBe(503);
    const metrics = await app.inject({ url: '/metrics' });
    expect(metrics.body).toContain('circuit_breaker_state');
    await app.close();
  });
});

describe('buildApp', () => {
  it('accepts empty JSON bodies, rejects prototype poisoning and records metrics', async () => {
    const { buildApp } = await import('../src/server.js');
    const { createLogger } = await import('../src/logger.js');
    const app = buildApp(createLogger('t', 'silent'));
    app.post('/x', async (req) => ({ body: req.body ?? null }));
    const empty = await app.inject({ method: 'POST', url: '/x', headers: { 'content-type': 'application/json' } });
    expect(empty.json()).toEqual({ body: null });
    const ok = await app.inject({ method: 'POST', url: '/x', headers: { 'content-type': 'application/json' }, payload: '{"a":1}' });
    expect(ok.json()).toEqual({ body: { a: 1 } });
    const evil = await app.inject({ method: 'POST', url: '/x', headers: { 'content-type': 'application/json' }, payload: '{"__proto__":{"x":1}}' });
    expect(evil.statusCode).toBe(400);
    const { registry } = await import('../src/metrics.js');
    expect(await registry.getSingleMetricAsString('http_request_duration_seconds')).toContain('route="/x"');
    await app.close();
  });
});
