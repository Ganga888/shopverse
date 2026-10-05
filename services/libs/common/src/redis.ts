import { Redis } from 'ioredis';
import type { Logger } from './logger.js';

export { Redis };

export function createRedis(url: string, log: Logger, name = 'main'): Redis {
  const redis = new Redis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    connectionName: name,
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });
  redis.on('error', (err) => log.warn({ err: err.message, redis: name }, 'redis error'));
  return redis;
}
