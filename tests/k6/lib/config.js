// Shared configuration. Override with: k6 run -e BASE_URL=https://api.staging.ganga888.in -e USERS=50 load.js
export const BASE_URL = (__ENV.BASE_URL || 'https://api.dev.ganga888.in').replace(/\/$/, '');
export const API = `${BASE_URL}/api/v1`;
export const USERS = Number(__ENV.USERS || 20);
export const PAYMENT_TOKEN = __ENV.PAYMENT_TOKEN || 'tok_visa';

export const defaultThresholds = {
  http_req_failed: ['rate<0.01'],
  http_req_duration: ['p(95)<500'],
  'http_req_duration{flow:browse}': ['p(95)<400'],
  'http_req_duration{flow:cart}': ['p(95)<500'],
  'http_req_duration{flow:checkout}': ['p(95)<800'],
  checks: ['rate>0.99'],
};

export const shippingAddress = {
  name: 'k6 Load Test',
  line1: '1 MG Road',
  city: 'Bengaluru',
  state: 'KA',
  postalCode: '560001',
  country: 'IN',
};
