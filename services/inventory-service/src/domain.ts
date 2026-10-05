export interface StockRow {
  productId: string;
  available: number;
  reserved: number;
}
export interface Line {
  productId: string;
  quantity: number;
}

export type ReservationPlan =
  | { ok: true; lines: Line[] }
  | { ok: false; reason: string; productId: string };

/** Merge duplicates and sort by product id (the lock order used by SELECT ... FOR UPDATE). */
export function normalizeLines(lines: Line[]): Line[] {
  const m = new Map<string, number>();
  for (const l of lines) m.set(l.productId, (m.get(l.productId) ?? 0) + l.quantity);
  return [...m.entries()].map(([productId, quantity]) => ({ productId, quantity })).sort((a, b) => a.productId.localeCompare(b.productId));
}

/** All-or-nothing reservation decision over locked stock rows. */
export function planReservation(stock: StockRow[], lines: Line[]): ReservationPlan {
  const byId = new Map(stock.map((s) => [s.productId, s]));
  const normalized = normalizeLines(lines);
  for (const l of normalized) {
    if (l.quantity <= 0) return { ok: false, reason: 'invalid quantity', productId: l.productId };
    const s = byId.get(l.productId);
    if (!s) return { ok: false, reason: 'unknown product', productId: l.productId };
    if (s.available < l.quantity) return { ok: false, reason: `insufficient stock (available ${s.available}, requested ${l.quantity})`, productId: l.productId };
  }
  return { ok: true, lines: normalized };
}

export function applyReserve(s: StockRow, qty: number): StockRow {
  if (s.available < qty) throw new Error('insufficient stock');
  return { ...s, available: s.available - qty, reserved: s.reserved + qty };
}
export function applyRelease(s: StockRow, qty: number): StockRow {
  return { ...s, available: s.available + qty, reserved: Math.max(0, s.reserved - qty) };
}
export function applyCommit(s: StockRow, qty: number): StockRow {
  return { ...s, reserved: Math.max(0, s.reserved - qty) };
}
