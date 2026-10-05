// Same-origin API: CloudFront routes /api/* to the ALB, so no CORS is needed in any environment.
const BASE = '/api/v1';
const store = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

export const session = {
  get: () => store.get('shopverse.session'),
  set: (s) => store.set('shopverse.session', s),
  clear: () => store.set('shopverse.session', null),
};

async function refresh() {
  const s = session.get();
  if (!s?.refreshToken) return false;
  const res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: s.refreshToken }) });
  if (!res.ok) { session.clear(); return false; }
  session.set({ ...s, ...(await res.json()) });
  return true;
}

export async function api(path, { method = 'GET', body, headers = {}, retry = true } = {}) {
  const s = session.get();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(s?.accessToken ? { authorization: `Bearer ${s.accessToken}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && retry && (await refresh())) return api(path, { method, body, headers, retry: false });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error?.message ?? `${res.status} ${res.statusText}`);
  return data;
}

export const money = (cents, currency = 'INR') => new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(cents / 100);
