import CircuitBreaker from 'opossum';
import { UpstreamError } from './errors.js';
import { circuitBreakerEvents, circuitBreakerState } from './metrics.js';

export type Breaker<TI extends unknown[], TR> = CircuitBreaker<TI, TR>;

/** Wrap any outbound call (HTTP, payment gateway, AWS SDK) in an opossum circuit breaker with metrics. */
export function createBreaker<TI extends unknown[], TR>(
  name: string,
  fn: (...args: TI) => Promise<TR>,
  opts: CircuitBreaker.Options = {},
): CircuitBreaker<TI, TR> {
  const breaker = new CircuitBreaker<TI, TR>(fn, {
    name,
    timeout: 5000,
    errorThresholdPercentage: 50,
    resetTimeout: 10000,
    volumeThreshold: 5,
    rollingCountTimeout: 10000,
    ...opts,
  });
  circuitBreakerState.set({ name }, 0);
  breaker.on('open', () => circuitBreakerState.set({ name }, 1));
  breaker.on('halfOpen', () => circuitBreakerState.set({ name }, 0.5));
  breaker.on('close', () => circuitBreakerState.set({ name }, 0));
  breaker.on('failure', () => circuitBreakerEvents.inc({ name, event: 'failure' }));
  breaker.on('timeout', () => circuitBreakerEvents.inc({ name, event: 'timeout' }));
  breaker.on('reject', () => circuitBreakerEvents.inc({ name, event: 'reject' }));
  return breaker;
}

export interface HttpClient {
  request<T>(path: string, init?: RequestInit): Promise<T>;
  breaker: CircuitBreaker<[string, RequestInit?], unknown>;
}

/** JSON HTTP client for service-to-service calls; 4xx responses do not trip the breaker. */
export function createHttpClient(name: string, baseUrl: string, timeoutMs = 3000): HttpClient {
  const call = async (path: string, init?: RequestInit): Promise<unknown> => {
    const res = await fetch(new URL(path, baseUrl), {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
    });
    const text = await res.text();
    let body: unknown = undefined;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (!res.ok) throw new UpstreamError(name, res.status, body);
    return body;
  };
  const breaker = createBreaker(name, call, {
    timeout: timeoutMs + 500,
    errorFilter: (err: unknown) => err instanceof UpstreamError && err.status < 500,
  });
  return { request: <T>(path: string, init?: RequestInit) => breaker.fire(path, init) as Promise<T>, breaker };
}
