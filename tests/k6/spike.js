// Spike: jump from baseline to a sudden burst and back. Checks recovery time and that errors stay bounded.
import { createUserPool } from './lib/api.js';
export { browse, cart, checkout } from './lib/flows.js';

const BASE = Number(__ENV.BASE_RPS || 10);
const SPIKE = Number(__ENV.SPIKE_RPS || 300);

const scenario = (exec, share) => ({
  executor: 'ramping-arrival-rate', exec, startRate: Math.max(1, Math.round(BASE * share)), timeUnit: '1s',
  preAllocatedVUs: Math.ceil(SPIKE * share), maxVUs: Math.ceil(SPIKE * share * 6),
  stages: [
    { target: Math.max(1, Math.round(BASE * share)), duration: '2m' },
    { target: Math.round(SPIKE * share), duration: '20s' },  // spike
    { target: Math.round(SPIKE * share), duration: '3m' },
    { target: Math.max(1, Math.round(BASE * share)), duration: '20s' },
    { target: Math.max(1, Math.round(BASE * share)), duration: '5m' },  // recovery window
  ],
  tags: { flow: exec },
});

export const options = {
  scenarios: { browse: scenario('browse', 0.7), cart: scenario('cart', 0.2), checkout: scenario('checkout', 0.1) },
  thresholds: { http_req_failed: ['rate<0.05'], http_req_duration: ['p(95)<1000'] },
};

export function setup() {
  return { users: createUserPool('spike') };
}
