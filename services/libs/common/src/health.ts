import type { FastifyInstance } from 'fastify';
import { registry } from './metrics.js';
import { withTimeout } from './util.js';

export interface HealthCheck {
  name: string;
  check: () => Promise<unknown>;
}

export interface LifecycleState {
  shuttingDown: boolean;
  started: boolean;
}

/** Liveness = process is up and the event loop answers. Readiness = dependencies reachable and not draining. */
export function registerHealthRoutes(app: FastifyInstance, checks: HealthCheck[], state: LifecycleState): void {
  app.get('/healthz/live', async () => ({ status: 'ok' }));
  app.get('/healthz/ready', async (_req, reply) => {
    if (state.shuttingDown || !state.started) {
      return reply.code(503).send({ status: state.shuttingDown ? 'shutting_down' : 'starting' });
    }
    const results = await Promise.all(
      checks.map(async (c) => {
        try {
          await withTimeout(Promise.resolve(c.check()), 2000, c.name);
          return [c.name, 'ok'] as const;
        } catch (err) {
          return [c.name, (err as Error).message ?? 'failed'] as const;
        }
      }),
    );
    const ok = results.every(([, r]) => r === 'ok');
    return reply.code(ok ? 200 : 503).send({ status: ok ? 'ok' : 'unavailable', checks: Object.fromEntries(results) });
  });
  app.get('/metrics', async (_req, reply) => {
    return reply.type(registry.contentType).send(await registry.metrics());
  });
}
