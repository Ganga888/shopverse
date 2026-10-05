import { createHash } from 'node:crypto';

export interface GatewayRequest {
  idempotencyKey: string;
  amountCents: number;
  currency: string;
  token: string;
}
export interface GatewayResult {
  approved: boolean;
  ref: string;
  reason?: string;
}

/**
 * Deterministic mock gateway rules so tests and e2e suites can exercise compensation:
 *  - card token "tok_fail" is always declined
 *  - amounts whose minor units end in .13 (e.g. 1013 paise = ₹10.13) are declined
 */
export function mockGatewayDecision(req: Pick<GatewayRequest, 'amountCents' | 'token'>): { approved: boolean; reason?: string } {
  if (req.token === 'tok_fail') return { approved: false, reason: 'card_declined' };
  if (req.amountCents % 100 === 13) return { approved: false, reason: 'insufficient_funds' };
  if (req.amountCents <= 0) return { approved: false, reason: 'invalid_amount' };
  return { approved: true };
}

/** Gateway reference derived from the idempotency key so retries map to the same charge. */
export function gatewayRef(idempotencyKey: string): string {
  return `gw_${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24)}`;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as object).sort().map((k) => [k, stable((value as Record<string, unknown>)[k])]));
  }
  return value;
}

export function hashRequest(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(stable(body))).digest('hex');
}

export interface StoredKey {
  requestHash: string;
  statusCode: number | null;
  response: unknown;
}
export type IdempotencyDecision =
  | { action: 'proceed' }
  | { action: 'replay'; statusCode: number; response: unknown }
  | { action: 'conflict'; message: string }
  | { action: 'in_progress' };

/** Decide what to do with a request given the stored record for its Idempotency-Key (if any). */
export function resolveIdempotency(existing: StoredKey | undefined, requestHash: string): IdempotencyDecision {
  if (!existing) return { action: 'proceed' };
  if (existing.requestHash !== requestHash) {
    return { action: 'conflict', message: 'Idempotency-Key was already used with a different request body' };
  }
  if (existing.statusCode === null) return { action: 'in_progress' };
  return { action: 'replay', statusCode: existing.statusCode, response: existing.response };
}
