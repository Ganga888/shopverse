// Load: realistic mix with open-model arrival rates — browse 70% / cart 20% / checkout 10%.
// TARGET_RPS is total iterations per second at plateau (default 50).
import { createUserPool } from './lib/api.js';
import { defaultThresholds } from './lib/config.js';
export { browse, cart, checkout } from './lib/flows.js';

const TARGET = Number(__ENV.TARGET_RPS || 50);
const RAMP = __ENV.RAMP || '5m';
const HOLD = __ENV.HOLD || '15m';

const scenario = (exec, share) => ({
  executor: 'ramping-arrival-rate',
  exec,
  startRate: Math.max(1, Math.round(TARGET * share * 0.1)),
  timeUnit: '1s',
  preAllocatedVUs: Math.ceil(TARGET * share * 2),
  maxVUs: Math.ceil(TARGET * share * 10),
  stages: [
    { target: Math.max(1, Math.round(TARGET * share)), duration: RAMP },
    { target: Math.max(1, Math.round(TARGET * share)), duration: HOLD },
    { target: 0, duration: '2m' },
  ],
  tags: { flow: exec },
});

export const options = {
  scenarios: {
    browse: scenario('browse', 0.7),
    cart: scenario('cart', 0.2),
    checkout: scenario('checkout', 0.1),
  },
  thresholds: defaultThresholds,
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  return { users: createUserPool('load') };
}
