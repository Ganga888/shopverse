import { pino, type Logger } from 'pino';
import { context, trace } from '@opentelemetry/api';

export type { Logger };

export function createLogger(service: string, level = 'info'): Logger {
  return pino({
    level,
    base: { service },
    messageKey: 'message',
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    mixin() {
      const span = trace.getSpan(context.active());
      if (!span) return {};
      const { traceId, spanId } = span.spanContext();
      return { trace_id: traceId, span_id: spanId };
    },
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'password', '*.password', 'paymentToken', '*.paymentToken'],
      censor: '[REDACTED]',
    },
  });
}
