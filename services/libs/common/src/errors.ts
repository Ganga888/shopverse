import type { FastifyError, FastifyInstance } from 'fastify';
import { z } from 'zod';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = 'authentication required') => new AppError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'forbidden') => new AppError(403, 'FORBIDDEN', msg);
export const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (msg: string) => new AppError(409, 'CONFLICT', msg);
export const unprocessable = (msg: string, details?: unknown) => new AppError(422, 'UNPROCESSABLE', msg, details);

/** Raised by the HTTP client when an upstream service answers with a non-2xx status. */
export class UpstreamError extends Error {
  constructor(
    public readonly upstream: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`${upstream} responded ${status}`);
    this.name = 'UpstreamError';
  }
}

/** Validate input with zod; throws a 400 AppError listing issues. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw badRequest('validation failed', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return r.data;
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((req, reply) => {
    void reply.code(404).send({ error: { code: 'NOT_FOUND', message: `route ${req.method} ${req.url} not found` } });
  });
  app.setErrorHandler((err: FastifyError | AppError | UpstreamError | Error, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof UpstreamError) {
      req.log.warn({ upstream: err.upstream, status: err.status }, 'upstream error');
      return reply.code(502).send({ error: { code: 'UPSTREAM_ERROR', message: err.message } });
    }
    const code = (err as { code?: string }).code;
    if (code === 'EOPENBREAKER' || code === 'ETIMEDOUT') {
      return reply.code(503).send({ error: { code: 'DEPENDENCY_UNAVAILABLE', message: err.message } });
    }
    const status = (err as FastifyError).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: { code: (err as FastifyError).code ?? 'BAD_REQUEST', message: err.message } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'internal server error' } });
  });
}
