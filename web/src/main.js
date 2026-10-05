import { api, money, session } from './api.js';

const app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const toast = (msg) => {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.style.display = 'none'), 3000);
};
// crypto.randomUUID() only exists in secure contexts (HTTPS or localhost), so plain http://<ip> needs the fallback.
const uuid = () => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const requireLogin = () => {
  if (session.get()) return true;
  location.hash = '#/login';
  return false;
};

async function updateHeader() {
  const s = session.get();
  const link = document.getElementById('auth-link');
  link.textContent = s ? `Sign out (${s.user?.name ?? ''})` : 'Sign in';
  link.href = s ? '#/logout' : '#/login';
  if (s) {
    try { document.getElementById('cart-count').textContent = (await api('/cart')).itemCount; } catch { /* ignore */ }
  } else {
    document.getElementById('cart-count').textContent = '0';
  }
}

function productCard(p) {
  return `<div class="card">
    <strong>${esc(p.name)}</strong>
    <span class="muted">${esc(p.category)}</span>
    <span>${esc(p.description)}</span>
    <span class="price">${money(p.priceCents, p.currency)}</span>
    <button data-add="${esc(p.id ?? p.productId)}">Add to cart</button>
  </div>`;
}

async function renderProducts(query) {
  app.innerHTML = '<p class="muted">Loading…</p>';
  const data = query ? await api(`/search?q=${encodeURIComponent(query)}`) : await api('/products?limit=24');
  app.innerHTML = `<h2>${query ? `Results for “${esc(query)}”` : 'Products'}</h2>
    <div class="grid">${data.items.map(productCard).join('') || '<p class="muted">Nothing found.</p>'}</div>`;
}

async function renderCart() {
  if (!requireLogin()) return;
  const cart = await api('/cart');
  app.innerHTML = `<h2>Your cart</h2>
    ${cart.items.length ? `<table><thead><tr><th>Product</th><th>Qty</th><th>Price</th><th></th></tr></thead><tbody>
      ${cart.items.map((i) => `<tr><td>${esc(i.name)}</td>
        <td><input type="number" min="0" max="100" value="${i.quantity}" data-qty="${esc(i.productId)}" style="width:72px"></td>
        <td class="price">${money(i.unitPriceCents * i.quantity, i.currency)}</td>
        <td><button class="secondary" data-remove="${esc(i.productId)}">Remove</button></td></tr>`).join('')}
      </tbody></table>
      <p>Subtotal <span class="price">${money(cart.subtotalCents)}</span>
        ${cart.discountCents ? ` · Discount −${money(cart.discountCents)} (${esc(cart.coupon?.code)})` : ''}
        · <strong>Total ${money(cart.totalCents)}</strong></p>
      <form id="coupon-form" class="stack" style="grid-template-columns:1fr auto"><input name="code" placeholder="Coupon code" value="${esc(cart.coupon?.code ?? '')}"><button>Apply</button></form>
      <h3>Checkout</h3>
      <form id="checkout-form" class="stack">
        <input name="name" placeholder="Full name" required>
        <input name="line1" placeholder="Address" required>
        <input name="city" placeholder="City" required>
        <input name="state" placeholder="State" required>
        <input name="postalCode" placeholder="PIN code" required>
        <select name="paymentToken"><option value="tok_visa">Test card (approves)</option><option value="tok_fail">Test card (declines)</option></select>
        <button>Place order</button>
      </form>` : '<p class="muted">Your cart is empty.</p>'}`;
}

async function renderOrders() {
  if (!requireLogin()) return;
  const { items } = await api('/orders');
  app.innerHTML = `<h2>Your orders</h2>${items.length ? `<table><thead><tr><th>Order</th><th>Status</th><th>Total</th><th>Placed</th></tr></thead><tbody>
    ${items.map((o) => `<tr><td><a href="#/orders/${esc(o.orderId)}">${esc(o.orderId.slice(0, 8))}</a></td><td class="status-${esc(o.status)}">${esc(o.status)}</td>
      <td class="price">${money(o.totalCents, o.currency)}</td><td class="muted">${new Date(o.createdAt).toLocaleString()}</td></tr>`).join('')}
    </tbody></table>` : '<p class="muted">No orders yet.</p>'}`;
}

async function renderOrder(id) {
  if (!requireLogin()) return;
  const o = await api(`/orders/${id}`);
  app.innerHTML = `<h2>Order ${esc(o.orderId.slice(0, 8))}</h2>
    <p>Status: <strong class="status-${esc(o.status)}">${esc(o.status)}</strong> ${o.failureReason ? `<span class="muted">(${esc(o.failureReason)})</span>` : ''}</p>
    <table><tbody>${o.items.map((i) => `<tr><td>${esc(i.name)}</td><td>× ${i.quantity}</td><td class="price">${money(i.unitPriceCents * i.quantity, o.currency)}</td></tr>`).join('')}</tbody></table>
    <p>Total <strong>${money(o.totalCents, o.currency)}</strong></p>
    <p class="muted">Saga step: ${esc(o.saga.step)}</p>`;
  if (o.status === 'PENDING' || o.status === 'STOCK_RESERVED') setTimeout(() => location.hash === `#/orders/${id}` && renderOrder(id), 1500);
}

function renderLogin() {
  app.innerHTML = `<h2>Sign in</h2>
    <form id="login-form" class="stack"><input name="email" type="email" placeholder="Email" required><input name="password" type="password" placeholder="Password" required><button>Sign in</button></form>
    <h3>New here?</h3>
    <form id="register-form" class="stack"><input name="name" placeholder="Name" required><input name="email" type="email" placeholder="Email" required>
      <input name="password" type="password" placeholder="Password (8+ chars, letters and digits)" required><button>Create account</button></form>`;
}

async function login(email, password) {
  session.set(await api('/auth/login', { method: 'POST', body: { email, password } }));
  await updateHeader();
  location.hash = '#/';
}

async function route() {
  const [, page, id] = location.hash.split('/');
  try {
    if (page === 'cart') await renderCart();
    else if (page === 'orders' && id) await renderOrder(id);
    else if (page === 'orders') await renderOrders();
    else if (page === 'login') renderLogin();
    else if (page === 'logout') {
      const s = session.get();
      if (s?.refreshToken) await api('/auth/logout', { method: 'POST', body: { refreshToken: s.refreshToken } }).catch(() => {});
      session.clear();
      await updateHeader();
      location.hash = '#/';
    } else if (page === 'search') await renderProducts(decodeURIComponent(id ?? ''));
    else await renderProducts();
  } catch (err) {
    app.innerHTML = `<p class="status-CANCELLED">${esc(err.message)}</p>`;
  }
}

document.addEventListener('click', async (e) => {
  const add = e.target.closest('[data-add]');
  const remove = e.target.closest('[data-remove]');
  try {
    if (add && requireLogin()) {
      await api('/cart/items', { method: 'POST', body: { productId: add.dataset.add, quantity: 1 } });
      toast('Added to cart');
      await updateHeader();
    } else if (remove) {
      await api(`/cart/items/${remove.dataset.remove}`, { method: 'DELETE' });
      await renderCart();
      await updateHeader();
    }
  } catch (err) { toast(err.message); }
});

document.addEventListener('change', async (e) => {
  const qty = e.target.closest('[data-qty]');
  if (!qty) return;
  try {
    await api(`/cart/items/${qty.dataset.qty}`, { method: 'PUT', body: { quantity: Number(qty.value) } });
    await renderCart();
    await updateHeader();
  } catch (err) { toast(err.message); }
});

document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  try {
    if (e.target.id === 'search-form') location.hash = `#/search/${encodeURIComponent(document.getElementById('search-input').value)}`;
    if (e.target.id === 'login-form') await login(f.email, f.password);
    if (e.target.id === 'register-form') {
      await api('/auth/register', { method: 'POST', body: f });
      await login(f.email, f.password);
    }
    if (e.target.id === 'coupon-form') {
      await api('/cart/coupon', { method: 'POST', body: { code: f.code } });
      await renderCart();
    }
    if (e.target.id === 'checkout-form') {
      const cart = await api('/cart');
      const order = await api('/orders', {
        method: 'POST',
        headers: { 'idempotency-key': uuid() },
        body: {
          items: cart.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
          couponCode: cart.coupon?.valid ? cart.coupon.code : undefined,
          paymentToken: f.paymentToken,
          shippingAddress: { name: f.name, line1: f.line1, city: f.city, state: f.state, postalCode: f.postalCode, country: 'IN' },
        },
      });
      location.hash = `#/orders/${order.orderId}`;
    }
  } catch (err) { toast(err.message); }
});

window.addEventListener('hashchange', route);
updateHeader();
route();
