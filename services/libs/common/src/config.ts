import { z } from 'zod';

const boolStr = z
  .string()
  .optional()
  .transform((v) => (v === undefined ? undefined : ['true', '1', 'yes'].includes(v.toLowerCase())));

export const baseSchema = z.object({
  SERVICE_NAME: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(8080),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  DB_HOST: z.string().optional(),
  DB_PORT: z.coerce.number().int().default(5432),
  DB_NAME: z.string().optional(),
  DB_USER: z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  /** Overrides the default (SSL on when NODE_ENV=production). In-cluster dev Postgres sets DB_SSL=false. */
  DB_SSL: boolStr,
  DB_SSL_CA_PATH: z.string().default('/etc/ssl/certs/rds-global-bundle.pem'),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  REDIS_URL: z.string().optional(),
  KAFKA_BROKERS: z.string().optional(),
  KAFKA_SSL: boolStr,
  KAFKA_SASL_MECHANISM: z.enum(['plain', 'scram-sha-256', 'scram-sha-512']).optional(),
  KAFKA_SASL_USERNAME: z.string().optional(),
  KAFKA_SASL_PASSWORD: z.string().optional(),
  KAFKA_MAX_RETRIES: z.coerce.number().int().positive().default(5),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(250),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default('http://otel-collector.tracing:4318'),
  JWT_ISSUER: z.string().default('https://api.ganga888.in/api/v1/auth'),
  JWKS_URL: z.string().default('http://auth-service.shop:8080/api/v1/auth/.well-known/jwks.json'),
  AWS_REGION: z.string().default('ap-south-1'),
  S3_BUCKET: z.string().optional(),
  SEED_SAMPLE_DATA: boolStr,
  SHUTDOWN_DELAY_MS: z.coerce.number().int().nonnegative().default(5000),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(25000),
});

export type BaseConfig = z.output<typeof baseSchema> & {
  dbSsl: boolean;
  kafkaBrokers: string[];
  isProd: boolean;
};

export function loadConfig<T extends z.ZodRawShape = Record<never, never>>(
  extra?: T,
  env: NodeJS.ProcessEnv = process.env,
): BaseConfig & z.output<z.ZodObject<T>> {
  const schema = baseSchema.extend(extra ?? ({} as T));
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    console.error(`Invalid configuration: ${JSON.stringify(parsed.error.issues)}`);
    process.exit(1);
  }
  const data = parsed.data as z.output<typeof baseSchema> & z.output<z.ZodObject<T>>;
  return {
    ...data,
    dbSsl: data.DB_SSL ?? data.NODE_ENV === 'production',
    kafkaBrokers: (data.KAFKA_BROKERS ?? '').split(',').map((b) => b.trim()).filter(Boolean),
    isProd: data.NODE_ENV === 'production',
  };
}
