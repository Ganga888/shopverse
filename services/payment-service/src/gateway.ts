import { createBreaker, sleep } from '@shopverse/common';
import { gatewayRef, mockGatewayDecision, type GatewayRequest, type GatewayResult } from './domain.js';

export interface PaymentGateway {
  authorize(req: GatewayRequest): Promise<GatewayResult>;
  void(ref: string): Promise<void>;
}

/**
 * Mock card gateway (stand-in for a real PSP SDK authenticated with the `api_key` from
 * shopverse/<env>/payment/gateway). Every call goes through an opossum circuit breaker.
 */
export function createGateway(apiKey: string | undefined, latencyMs = 30): PaymentGateway {
  const authorizeCall = async (req: GatewayRequest): Promise<GatewayResult> => {
    if (!apiKey) throw new Error('payment gateway api key not configured');
    await sleep(latencyMs);
    const d = mockGatewayDecision(req);
    return { approved: d.approved, reason: d.reason, ref: gatewayRef(req.idempotencyKey) };
  };
  const voidCall = async (ref: string): Promise<void> => {
    if (!apiKey) throw new Error('payment gateway api key not configured');
    await sleep(latencyMs);
    if (!ref.startsWith('gw_')) throw new Error(`unknown gateway reference ${ref}`);
  };
  const authorizeBreaker = createBreaker('payment-gateway-authorize', authorizeCall, { timeout: 3000 });
  const voidBreaker = createBreaker('payment-gateway-void', voidCall, { timeout: 3000 });
  return {
    authorize: (req) => authorizeBreaker.fire(req),
    void: (ref) => voidBreaker.fire(ref),
  };
}
