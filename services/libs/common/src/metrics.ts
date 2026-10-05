import client from 'prom-client';

export const registry = new client.Registry();
let defaultsCollected = false;

export function initMetrics(service: string): void {
  registry.setDefaultLabels({ service });
  if (!defaultsCollected) {
    client.collectDefaultMetrics({ register: registry });
    defaultsCollected = true;
  }
}

export function counter<L extends string>(name: string, help: string, labelNames: readonly L[] = []): client.Counter<L> {
  return new client.Counter({ name, help, labelNames, registers: [registry] });
}

export function gauge<L extends string>(name: string, help: string, labelNames: readonly L[] = []): client.Gauge<L> {
  return new client.Gauge({ name, help, labelNames, registers: [registry] });
}

export function histogram<L extends string>(
  name: string,
  help: string,
  labelNames: readonly L[] = [],
  buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
): client.Histogram<L> {
  return new client.Histogram({ name, help, labelNames, buckets, registers: [registry] });
}

export const httpRequestDuration = histogram('http_request_duration_seconds', 'HTTP request latency', ['route', 'method', 'status']);
export const kafkaMessagesConsumed = counter('kafka_messages_consumed_total', 'Kafka messages consumed', ['topic', 'result']);
export const kafkaMessagesProduced = counter('kafka_messages_produced_total', 'Kafka messages produced', ['topic']);
export const outboxPublished = counter('outbox_events_published_total', 'Outbox rows relayed to Kafka');
export const circuitBreakerState = gauge('circuit_breaker_state', 'Circuit breaker state (0=closed, 0.5=half-open, 1=open)', ['name']);
export const circuitBreakerEvents = counter('circuit_breaker_events_total', 'Circuit breaker events', ['name', 'event']);
