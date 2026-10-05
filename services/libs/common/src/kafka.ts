import { randomUUID } from 'node:crypto';
import kafkajs from 'kafkajs';
import type { Admin, Consumer, IHeaders, Kafka as KafkaT, Producer, SASLOptions } from 'kafkajs';
import { z } from 'zod';
import type { BaseConfig } from './config.js';
import type { Logger } from './logger.js';
import type { Pool, PoolClient } from './db.js';
import { withTx } from './db.js';
import type { Redis } from './redis.js';
import { kafkaMessagesConsumed, kafkaMessagesProduced } from './metrics.js';
import { sleep } from './util.js';

const { Kafka, logLevel, Partitioners } = kafkajs;
export type { KafkaT as Kafka };

export const TOPICS = {
  users: 'users.events',
  catalog: 'catalog.events',
  orders: 'orders.events',
  inventoryCommands: 'inventory.commands',
  inventory: 'inventory.events',
  paymentsCommands: 'payments.commands',
  payments: 'payments.events',
  shipping: 'shipping.events',
  reviews: 'reviews.events',
} as const;

export const ALL_EVENT_TOPICS = [
  TOPICS.users,
  TOPICS.catalog,
  TOPICS.orders,
  TOPICS.inventory,
  TOPICS.payments,
  TOPICS.shipping,
  TOPICS.reviews,
];

/** CloudEvents-style envelope. correlationId = sagaId = orderId for saga traffic. */
export interface EventEnvelope<T = unknown> {
  id: string;
  type: string;
  source: string;
  time: string;
  correlationId: string;
  data: T;
}

const envelopeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  source: z.string().min(1),
  time: z.string().min(1),
  correlationId: z.string().min(1),
  data: z.unknown(),
});

export function makeEvent<T>(source: string, type: string, data: T, correlationId?: string): EventEnvelope<T> {
  const id = randomUUID();
  return { id, type, source, time: new Date().toISOString(), correlationId: correlationId ?? id, data };
}

export function parseEnvelope(raw: string): EventEnvelope {
  return envelopeSchema.parse(JSON.parse(raw)) as EventEnvelope;
}

const levelMap: Record<number, 'error' | 'warn' | 'info' | 'debug'> = {
  [logLevel.ERROR]: 'error',
  [logLevel.WARN]: 'warn',
  [logLevel.INFO]: 'info',
  [logLevel.DEBUG]: 'debug',
};

export function createKafka(cfg: BaseConfig, log: Logger): KafkaT {
  let sasl: SASLOptions | undefined;
  if (cfg.KAFKA_SASL_MECHANISM) {
    sasl = {
      mechanism: cfg.KAFKA_SASL_MECHANISM,
      username: cfg.KAFKA_SASL_USERNAME ?? '',
      password: cfg.KAFKA_SASL_PASSWORD ?? '',
    } as SASLOptions;
  }
  return new Kafka({
    clientId: cfg.SERVICE_NAME,
    brokers: cfg.kafkaBrokers,
    ssl: cfg.KAFKA_SSL ?? false,
    sasl,
    connectionTimeout: 5000,
    retry: { initialRetryTime: 300, retries: 10 },
    logLevel: logLevel.WARN,
    logCreator:
      () =>
      ({ level, log: entry }) => {
        const { message, ...extra } = entry;
        log[levelMap[level] ?? 'info']({ kafka: extra }, message);
      },
  });
}

export interface OutgoingMessage {
  topic: string;
  key: string | null;
  value: string;
  headers?: IHeaders;
}

export class EventProducer {
  private constructor(private readonly producer: Producer) {}

  static async connect(kafka: KafkaT): Promise<EventProducer> {
    const producer = kafka.producer({
      idempotent: true,
      maxInFlightRequests: 1,
      allowAutoTopicCreation: false,
      createPartitioner: Partitioners.DefaultPartitioner,
      // Idempotent producers must retry "forever" for exactly-once per partition; bounded by maxRetryTime.
      retry: { retries: Number.MAX_SAFE_INTEGER, maxRetryTime: 30_000 },
    });
    await producer.connect();
    return new EventProducer(producer);
  }

  async publish(topic: string, evt: EventEnvelope, key: string = evt.correlationId): Promise<void> {
    await this.sendBatch([{ topic, key, value: JSON.stringify(evt), headers: { 'ce-type': evt.type, 'ce-id': evt.id } }]);
  }

  async sendBatch(messages: OutgoingMessage[]): Promise<void> {
    if (!messages.length) return;
    const byTopic = new Map<string, OutgoingMessage[]>();
    for (const m of messages) byTopic.set(m.topic, [...(byTopic.get(m.topic) ?? []), m]);
    await this.producer.sendBatch({
      acks: -1,
      topicMessages: [...byTopic.entries()].map(([topic, msgs]) => ({
        topic,
        messages: msgs.map((m) => ({ key: m.key, value: m.value, headers: m.headers })),
      })),
    });
    for (const [topic, msgs] of byTopic) kafkaMessagesProduced.inc({ topic }, msgs.length);
  }

  async disconnect(): Promise<void> {
    await this.producer.disconnect();
  }
}

export interface HandlerContext {
  topic: string;
  /** Transaction client (Postgres-backed services). The processed_events insert is in the same transaction. */
  db?: PoolClient;
  redis?: Redis;
  log: Logger;
}
export type EventHandler = (evt: EventEnvelope, ctx: HandlerContext) => Promise<void>;

export interface ConsumerOptions {
  kafka: KafkaT;
  groupId: string;
  topics: string[];
  handler: EventHandler;
  producer: EventProducer;
  log: Logger;
  maxRetries: number;
  /** Idempotency store: Postgres processed_events table (preferred) or Redis SET NX. */
  idempotency: 'db' | 'redis';
  pool?: Pool;
  redis?: Redis;
}

export interface RunningConsumer {
  consumer: Consumer;
  stop(): Promise<void>;
}

/**
 * Subscribe and process messages with: envelope validation, idempotency (processed_events),
 * in-process retries with exponential backoff, and DLQ (`<topic>.dlq`) after maxRetries attempts.
 */
export async function startConsumer(opts: ConsumerOptions): Promise<RunningConsumer> {
  const { kafka, groupId, topics, handler, producer, log, maxRetries, pool, redis, idempotency } = opts;
  const consumer = kafka.consumer({ groupId, sessionTimeout: 30_000, heartbeatInterval: 3_000, allowAutoTopicCreation: false });
  await consumer.connect();
  await consumer.subscribe({ topics, fromBeginning: true });

  const processOnce = async (evt: EventEnvelope, topic: string, elog: Logger): Promise<boolean> => {
    if (idempotency === 'db') {
      if (!pool) throw new Error('db idempotency requires a pool');
      return withTx(pool, async (db) => {
        const r = await db.query(
          'INSERT INTO processed_events (id, topic, type) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
          [evt.id, topic, evt.type],
        );
        if (r.rowCount === 0) return false;
        await handler(evt, { topic, db, redis, log: elog });
        return true;
      });
    }
    if (!redis) throw new Error('redis idempotency requires a redis client');
    const key = `processed:${groupId}:${evt.id}`;
    const ok = await redis.set(key, '1', 'EX', 7 * 86_400, 'NX');
    if (ok !== 'OK') return false;
    try {
      await handler(evt, { topic, redis, log: elog });
    } catch (err) {
      await redis.del(key).catch(() => undefined);
      throw err;
    }
    return true;
  };

  const toDlq = async (topic: string, key: Buffer | null, value: Buffer, reason: string, attempts: number) => {
    await producer.sendBatch([
      {
        topic: `${topic}.dlq`,
        key: key ? key.toString() : null,
        value: value.toString(),
        headers: { 'dlq-reason': reason.slice(0, 1000), 'dlq-attempts': String(attempts), 'dlq-source-group': groupId },
      },
    ]);
  };

  await consumer.run({
    autoCommit: true,
    eachMessage: async ({ topic, message, heartbeat }) => {
      if (!message.value) return;
      let evt: EventEnvelope;
      try {
        evt = parseEnvelope(message.value.toString());
      } catch (err) {
        log.error({ topic, err: (err as Error).message }, 'invalid envelope, sending to DLQ');
        await toDlq(topic, message.key, message.value, `invalid envelope: ${(err as Error).message}`, 0);
        kafkaMessagesConsumed.inc({ topic, result: 'dlq' });
        return;
      }
      const elog = log.child({ eventId: evt.id, eventType: evt.type, correlationId: evt.correlationId, topic });
      for (let attempt = 1; ; attempt++) {
        try {
          const processed = await processOnce(evt, topic, elog);
          kafkaMessagesConsumed.inc({ topic, result: processed ? 'processed' : 'duplicate' });
          return;
        } catch (err) {
          if (attempt >= maxRetries) {
            elog.error({ err, attempt }, 'event failed permanently, sending to DLQ');
            await toDlq(topic, message.key, message.value, (err as Error).message ?? String(err), attempt);
            kafkaMessagesConsumed.inc({ topic, result: 'dlq' });
            return;
          }
          elog.warn({ err: (err as Error).message, attempt }, 'event handling failed, retrying');
          await sleep(Math.min(200 * 2 ** attempt, 5000));
          await heartbeat();
        }
      }
    },
  });

  return {
    consumer,
    async stop() {
      // disconnect() waits for the in-flight eachMessage to finish and commits offsets.
      await consumer.disconnect();
    },
  };
}

export async function connectAdmin(kafka: KafkaT): Promise<Admin> {
  const admin = kafka.admin();
  await admin.connect();
  return admin;
}
