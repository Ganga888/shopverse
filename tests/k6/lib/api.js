import http from 'k6/http';
import { check, fail } from 'k6';
import { API, PAYMENT_TOKEN, shippingAddress, USERS } from './config.js';

const json = { 'Content-Type': 'application/json' };
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const auth = (token) => ({ ...json, ...bearer(token) });

export function uuid() {
  // RFC4122 v4 from Math.random (sufficient for idempotency keys in tests)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function register(email, password, name) {
  return http.post(`${API}/auth/register`, JSON.stringify({ email, password, name }), { headers: json, tags: { name: 'POST /auth/register', flow: 'setup' } });
}

export function login(email, password) {
  const res = http.post(`${API}/auth/login`, JSON.stringify({ email, password }), { headers: json, tags: { name: 'POST /auth/login', flow: 'setup' } });
  if (!check(res, { 'login 200': (r) => r.status === 200 })) fail(`login failed for ${email}: ${res.status} ${res.body}`);
  return res.json('accessToken');
}

/** Create (or reuse) a pool of test users; returns [{ email, password, token }]. Call from setup(). */
export function createUserPool(prefix = 'k6') {
  const runId = __ENV.RUN_ID || `${Date.now()}`;
  const users = [];
  for (let i = 0; i < USERS; i++) {
    const email = `${prefix}-${runId}-${i}@loadtest.ganga888.in`;
    const password = 'LoadTest123';
    const r = register(email, password, `k6 user ${i}`);
    if (r.status !== 201 && r.status !== 409) fail(`register failed: ${r.status} ${r.body}`);
    users.push({ email, password, token: login(email, password) });
  }
  return users;
}

/** Pick this VU's user; transparently re-login when the 15-minute access token expires (soak tests). */
const tokenCache = {};
export function userFor(users) {
  const u = users[(__VU - 1) % users.length];
  const cached = tokenCache[u.email];
  if (cached && cached.exp > Date.now()) return cached.token;
  const token = cached ? login(u.email, u.password) : u.token;
  tokenCache[u.email] = { token, exp: Date.now() + 12 * 60 * 1000 };
  return token;
}

export function listProducts(page = 1) {
  const res = http.get(`${API}/products?page=${page}&limit=20`, { tags: { name: 'GET /products', flow: 'browse' } });
  check(res, { 'products 200': (r) => r.status === 200 });
  return res.status === 200 ? res.json('items') : [];
}

export function getProduct(id) {
  const res = http.get(`${API}/products/${id}`, { tags: { name: 'GET /products/:id', flow: 'browse' } });
  check(res, { 'product 200': (r) => r.status === 200 });
  return res;
}

export function search(q) {
  const res = http.get(`${API}/search?q=${encodeURIComponent(q)}`, { tags: { name: 'GET /search', flow: 'browse' } });
  check(res, { 'search 200': (r) => r.status === 200 });
  return res;
}

export function reviews(productId) {
  const res = http.get(`${API}/reviews?productId=${productId}`, { tags: { name: 'GET /reviews', flow: 'browse' } });
  check(res, { 'reviews 200': (r) => r.status === 200 });
}

export function recommendations(productId) {
  const res = http.get(`${API}/recommendations/products/${productId}`, { tags: { name: 'GET /recommendations', flow: 'browse' } });
  check(res, { 'recommendations 200': (r) => r.status === 200 });
}

export function addToCart(token, productId, quantity = 1, flow = 'cart') {
  const res = http.post(`${API}/cart/items`, JSON.stringify({ productId, quantity }), { headers: auth(token), tags: { name: 'POST /cart/items', flow } });
  check(res, { 'add to cart 201': (r) => r.status === 201 });
  return res;
}

export function getCart(token, flow = 'cart') {
  const res = http.get(`${API}/cart`, { headers: bearer(token), tags: { name: 'GET /cart', flow } });
  check(res, { 'cart 200': (r) => r.status === 200 });
  return res;
}

export function clearCart(token, flow = 'cart') {
  const res = http.del(`${API}/cart`, null, { headers: bearer(token), tags: { name: 'DELETE /cart', flow } });
  check(res, { 'clear cart 204': (r) => r.status === 204 });
}

export function createOrder(token, items, paymentToken = PAYMENT_TOKEN) {
  const res = http.post(`${API}/orders`, JSON.stringify({ items, paymentToken, shippingAddress }), {
    headers: { ...auth(token), 'Idempotency-Key': uuid() },
    tags: { name: 'POST /orders', flow: 'checkout' },
  });
  check(res, { 'order accepted 202': (r) => r.status === 202 });
  return res;
}

export function getOrder(token, orderId) {
  return http.get(`${API}/orders/${orderId}`, { headers: bearer(token), tags: { name: 'GET /orders/:id', flow: 'checkout' } });
}
