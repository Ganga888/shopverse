// Soak: steady moderate load for hours to surface leaks (memory, connections, Kafka lag, outbox growth).
import { createUserPool } from './lib/api.js';
import { defaultThresholds } from './lib/config.js';
export { browse, cart, checkout } from './lib/flows.js';

const RATE = Number(__ENV.RATE || 30);
const DURATION = __ENV.DURATION || '4h';

const scenario = (exec, share) => ({
  executor: 'constant-arrival-rate', exec, rate: Math.max(1, Math.round(RATE * share)), timeUnit: '1s', duration: DURATION,
  preAllocatedVUs: Math.ceil(RATE * share * 2), maxVUs: Math.ceil(RATE * share * 6), tags: { flow: exec },
});

export const options = {
  scenarios: { browse: scenario('browse', 0.7), cart: scenario('cart', 0.2), checkout: scenario('checkout', 0.1) },
  thresholds: { ...defaultThresholds, saga_completion_ms: ['p(95)<10000'] },
};

export function setup() {
  return { users: createUserPool('soak') };
}
