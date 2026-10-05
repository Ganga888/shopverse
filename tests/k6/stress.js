// Stress: step the arrival rate well past expected peak to find the breaking point and watch HPA/Karpenter react.
// Thresholds are informational (abortOnFail only on a total collapse).
import { createUserPool } from './lib/api.js';
export { browse, cart, checkout } from './lib/flows.js';

const PEAK = Number(__ENV.PEAK_RPS || 400);
const step = (share) => [0.25, 0.5, 0.75, 1, 1.25].flatMap((f) => [
  { target: Math.max(1, Math.round(PEAK * f * share)), duration: '3m' },
  { target: Math.max(1, Math.round(PEAK * f * share)), duration: '5m' },
]).concat([{ target: 0, duration: '3m' }]);

const scenario = (exec, share) => ({
  executor: 'ramping-arrival-rate', exec, startRate: 1, timeUnit: '1s',
  preAllocatedVUs: Math.ceil(PEAK * share), maxVUs: Math.ceil(PEAK * share * 8), stages: step(share), tags: { flow: exec },
});

export const options = {
  scenarios: { browse: scenario('browse', 0.7), cart: scenario('cart', 0.2), checkout: scenario('checkout', 0.1) },
  thresholds: {
    http_req_failed: [{ threshold: 'rate<0.25', abortOnFail: true, delayAbortEval: '2m' }],
    http_req_duration: ['p(95)<1500'],
  },
};

export function setup() {
  return { users: createUserPool('stress') };
}
