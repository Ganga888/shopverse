/**
 * OpenTelemetry bootstrap. Loaded before the app with `node --import @shopverse/common/tracing dist/index.js`
 * so auto-instrumentations (http/undici, fastify, pg, ioredis, kafkajs, aws-sdk) patch modules before use.
 */
import { register } from 'node:module';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';

// ESM loader hook so ESM-imported modules are instrumented too.
register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);

const SHUTDOWN_KEY = Symbol.for('shopverse.otel.shutdown');

if (process.env.OTEL_SDK_DISABLED !== 'true') {
  const endpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://otel-collector.tracing:4318').replace(/\/$/, '');
  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? process.env.SERVICE_NAME ?? 'unknown-service',
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
        // Only record DB/cache calls that belong to a request or message; background polling
        // (outbox relay, sweepers, readiness checks) would otherwise create a root trace per query.
        '@opentelemetry/instrumentation-pg': { requireParentSpan: true },
        '@opentelemetry/instrumentation-ioredis': { requireParentSpan: true },
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (req) => !!req.url && (req.url.startsWith('/healthz') || req.url.startsWith('/metrics')),
        },
      }),
    ],
  });
  sdk.start();
  (globalThis as Record<symbol, unknown>)[SHUTDOWN_KEY] = () => sdk.shutdown();
}

export async function shutdownTracing(): Promise<void> {
  const fn = (globalThis as Record<symbol, unknown>)[SHUTDOWN_KEY] as (() => Promise<void>) | undefined;
  if (fn) await fn();
}
