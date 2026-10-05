import { sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { addToCart, clearCart, createOrder, getCart, getOrder, getProduct, listProducts, recommendations, reviews, search, userFor } from './api.js';

const TERMS = ['shirt', 'shoes', 'mug', 'headphones', 'backpack', 'bottle', 'wireless', 'cotton'];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export const sagaDuration = new Trend('saga_completion_ms', true);
export const sagaOutcome = new Counter('saga_outcome');

/** 70%: anonymous browsing (catalog list, product detail, search, reviews, recommendations). */
export function browse() {
  const products = listProducts(1 + Math.floor(Math.random() * 2));
  if (Math.random() < 0.5) search(pick(TERMS));
  if (products.length) {
    const p = pick(products);
    getProduct(p.id);
    reviews(p.id);
    recommendations(p.id);
  }
  sleep(Math.random());
}

/** 20%: authenticated cart manipulation. */
export function cart(data) {
  const token = userFor(data.users);
  const products = listProducts();
  if (!products.length) return;
  addToCart(token, pick(products).id, 1);
  getCart(token);
  if (Math.random() < 0.3) clearCart(token);
  sleep(Math.random());
}

/** 10%: checkout — add to cart, place order, poll the saga until a terminal state (max 30 s). */
export function checkout(data) {
  const token = userFor(data.users);
  const products = listProducts();
  if (!products.length) return;
  const p = pick(products);
  addToCart(token, p.id, 1, 'checkout');
  const res = createOrder(token, [{ productId: p.id, quantity: 1 }]);
  if (res.status !== 202) return;
  const orderId = res.json('orderId');
  const started = Date.now();
  for (let i = 0; i < 30; i++) {
    sleep(1);
    const o = getOrder(token, orderId);
    const status = o.status === 200 ? o.json('status') : null;
    if (status === 'CONFIRMED' || status === 'CANCELLED') {
      sagaDuration.add(Date.now() - started);
      sagaOutcome.add(1, { status });
      clearCart(token, 'checkout');
      return;
    }
  }
  sagaOutcome.add(1, { status: 'TIMEOUT' });
}
