import type { ServerResponse } from 'node:http';
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { authenticate, counter, createBreaker, createRedis, gauge, loadConfig, main, parse, runService, TOPICS, type Redis } from '@shopverse/common';
import { z } from 'zod';
import { keys, renderNotification, sseFrame, type Notification } from './templates.js';

const config = loadConfig({
  SES_ENABLED: z.string().default('false').transform((v) => v === 'true'),
  /** GitOps aliases: EMAIL_PROVIDER=ses enables SES, EMAIL_FROM overrides SES_FROM_ADDRESS. */
  EMAIL_PROVIDER: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  SES_FROM_ADDRESS: z.string().default('no-reply@ganga888.in'),
  SES_CONFIGURATION_SET: z.string().optional(),
  NOTIFICATION_HISTORY: z.coerce.number().int().positive().default(50),
});
const sesEnabled = config.SES_ENABLED || config.EMAIL_PROVIDER?.toLowerCase() === 'ses';
const fromAddress = config.EMAIL_FROM ?? config.SES_FROM_ADDRESS;
const sent = counter('notifications_sent_total', 'Notifications delivered', ['channel', 'kind']);
const sseClients = gauge('notification_sse_clients', 'Connected SSE clients');

const ses = new SESv2Client({ region: config.AWS_REGION });
const sendEmail = createBreaker(
  'ses',
  async (to: string, subject: string, text: string) => {
    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: fromAddress,
        Destination: { ToAddresses: [to] },
        ConfigurationSetName: config.SES_CONFIGURATION_SET,
        Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: text } } } },
      }),
    );
  },
  { timeout: 5000 },
);

/** userId -> open SSE responses on this replica; fed by a Redis pattern subscription. */
const streams = new Map<string, Set<ServerResponse>>();
let subscriber: Redis | undefined;

main(() =>
  runService({
    config,
    redis: true,
    consumer: {
      topics: [TOPICS.orders, TOPICS.shipping, TOPICS.users],
      idempotency: 'redis',
      handler: async (evt, { redis, log }) => {
        const n = renderNotification(evt);
        if (!n) return;
        const kv = redis!;
        if (n.email) await kv.set(keys.email(n.userId), n.email, 'EX', 90 * 86_400);
        const payload = JSON.stringify(n);
        await kv
          .multi()
          .lpush(keys.list(n.userId), payload)
          .ltrim(keys.list(n.userId), 0, config.NOTIFICATION_HISTORY - 1)
          .expire(keys.list(n.userId), 30 * 86_400)
          .publish(keys.channel(n.userId), payload)
          .exec();
        sent.inc({ channel: 'in_app', kind: n.kind });
        if (sesEnabled) {
          const email = n.email ?? (await kv.get(keys.email(n.userId)));
          if (email) {
            await sendEmail.fire(email, n.title, n.body); // failure -> consumer retry -> DLQ
            sent.inc({ channel: 'email', kind: n.kind });
          } else {
            log.warn({ userId: n.userId }, 'no email address known, skipping email');
          }
        }
      },
    },
    routes: async (app, { redis, log, verifyToken }) => {
      const kv = redis!;
      subscriber = createRedis(config.REDIS_URL!, log, 'subscriber');
      await subscriber.psubscribe(keys.channelPattern);
      subscriber.on('pmessage', (_pattern, channel, message) => {
        const userId = channel.slice('notif:ch:'.length);
        const set = streams.get(userId);
        if (!set) return;
        const n = JSON.parse(message) as Notification;
        for (const res of set) res.write(sseFrame('notification', n, n.id));
      });

      app.addHook('preClose', async () => {
        for (const set of streams.values()) for (const res of set) res.end(sseFrame('shutdown', { reconnect: true }));
        streams.clear();
      });

      app.get('/api/v1/notifications', { preHandler: authenticate(verifyToken) }, async (req) => {
        const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }), req.query);
        const raw = await kv.lrange(keys.list(req.user!.sub), 0, limit - 1);
        return { items: raw.map((r) => JSON.parse(r) as Notification) };
      });

      // Server-Sent Events. EventSource cannot set headers, so ?access_token= is accepted here.
      app.get('/api/v1/notifications/stream', { preHandler: authenticate(verifyToken, { allowQuery: true }) }, async (req, reply) => {
        const userId = req.user!.sub;
        reply.hijack();
        const res = reply.raw;
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
        res.write('retry: 5000\n\n');
        res.write(sseFrame('ready', { userId }));
        const set = streams.get(userId) ?? new Set<ServerResponse>();
        set.add(res);
        streams.set(userId, set);
        sseClients.inc();
        const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
        req.raw.on('close', () => {
          clearInterval(heartbeat);
          set.delete(res);
          if (!set.size) streams.delete(userId);
          sseClients.dec();
        });
      });
    },
    onShutdown: async () => {
      await subscriber?.quit();
      ses.destroy();
    },
  }),
);
