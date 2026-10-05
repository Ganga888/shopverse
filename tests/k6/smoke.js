// Smoke: 1 VU, ~1 minute. Verifies health endpoints and one full purchase. Run after every deploy.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { API, BASE_URL } from './lib/config.js';
import { createUserPool } from './lib/api.js';
import { browse, cart, checkout } from './lib/flows.js';

export const options = {
  vus: 1,
  iterations: 5,
  thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<800'], checks: ['rate==1.0'] },
};

export function setup() {
  const live = http.get(`${API}/products?limit=1`);
  check(live, { 'api reachable': (r) => r.status === 200 });
  return { users: createUserPool('smoke') };
}

export default function (data) {
  browse();
  cart(data);
  checkout(data);
  sleep(1);
}

export function handleSummary(data) {
  return { stdout: `\nsmoke against ${BASE_URL}: ${data.metrics.checks.values.passes} checks passed, ${data.metrics.checks.values.fails} failed\n` };
}
