/**
 * Order saga state machine (pure). The orchestrator persists the resulting state and turns
 * actions into outbox events/commands inside the same transaction.
 *
 *   PENDING --StockReserved--> STOCK_RESERVED --PaymentAuthorized--> CONFIRMED
 *      |                            |
 *      | StockReservationFailed     | PaymentFailed / Timeout  (ReleaseStock)
 *      | Timeout (ReleaseStock)     v
 *      +------------------------> CANCELLED
 *
 * Late events after cancellation are compensated: StockReserved -> ReleaseStock,
 * PaymentAuthorized -> VoidPayment.
 */
export type OrderStatus = 'PENDING' | 'STOCK_RESERVED' | 'CONFIRMED' | 'CANCELLED';
export type SagaStep = 'RESERVING_STOCK' | 'AUTHORIZING_PAYMENT' | 'DONE' | 'COMPENSATED';
export type SagaStatus = 'RUNNING' | 'COMPLETED' | 'COMPENSATED';

export type SagaEvent =
  | { type: 'StockReserved' }
  | { type: 'StockReservationFailed'; reason: string }
  | { type: 'PaymentAuthorized'; paymentId: string }
  | { type: 'PaymentFailed'; reason: string }
  | { type: 'Timeout' };

export type SagaAction =
  | { kind: 'AuthorizePayment' }
  | { kind: 'ReleaseStock'; reason: string }
  | { kind: 'VoidPayment'; reason: string }
  | { kind: 'OrderConfirmed'; paymentId: string }
  | { kind: 'OrderCancelled'; reason: string };

export interface Transition {
  from: OrderStatus;
  to: OrderStatus;
  step: SagaStep;
  sagaStatus: SagaStatus;
  actions: SagaAction[];
  /** True when the event changes nothing (duplicate / out of order) and no actions are emitted. */
  ignored: boolean;
  failureReason?: string;
  paymentId?: string;
}

export const SAGA_TIMEOUT_REASON = 'saga timeout';

const stepFor: Record<OrderStatus, SagaStep> = {
  PENDING: 'RESERVING_STOCK',
  STOCK_RESERVED: 'AUTHORIZING_PAYMENT',
  CONFIRMED: 'DONE',
  CANCELLED: 'COMPENSATED',
};
const sagaStatusFor: Record<OrderStatus, SagaStatus> = {
  PENDING: 'RUNNING',
  STOCK_RESERVED: 'RUNNING',
  CONFIRMED: 'COMPLETED',
  CANCELLED: 'COMPENSATED',
};

function move(from: OrderStatus, to: OrderStatus, actions: SagaAction[], extra: Partial<Transition> = {}): Transition {
  return { from, to, step: stepFor[to], sagaStatus: sagaStatusFor[to], actions, ignored: false, ...extra };
}
function ignore(status: OrderStatus): Transition {
  return { from: status, to: status, step: stepFor[status], sagaStatus: sagaStatusFor[status], actions: [], ignored: true };
}

export function transition(status: OrderStatus, event: SagaEvent): Transition {
  switch (status) {
    case 'PENDING':
      switch (event.type) {
        case 'StockReserved':
          return move(status, 'STOCK_RESERVED', [{ kind: 'AuthorizePayment' }]);
        case 'StockReservationFailed':
          return move(status, 'CANCELLED', [{ kind: 'OrderCancelled', reason: event.reason }], { failureReason: event.reason });
        case 'Timeout':
          return move(
            status,
            'CANCELLED',
            [
              { kind: 'ReleaseStock', reason: SAGA_TIMEOUT_REASON },
              { kind: 'OrderCancelled', reason: SAGA_TIMEOUT_REASON },
            ],
            { failureReason: SAGA_TIMEOUT_REASON },
          );
        default:
          return ignore(status);
      }
    case 'STOCK_RESERVED':
      switch (event.type) {
        case 'PaymentAuthorized':
          return move(status, 'CONFIRMED', [{ kind: 'OrderConfirmed', paymentId: event.paymentId }], { paymentId: event.paymentId });
        case 'PaymentFailed':
          return move(
            status,
            'CANCELLED',
            [
              { kind: 'ReleaseStock', reason: event.reason },
              { kind: 'OrderCancelled', reason: event.reason },
            ],
            { failureReason: event.reason },
          );
        case 'Timeout':
          return move(
            status,
            'CANCELLED',
            [
              { kind: 'ReleaseStock', reason: SAGA_TIMEOUT_REASON },
              { kind: 'VoidPayment', reason: SAGA_TIMEOUT_REASON },
              { kind: 'OrderCancelled', reason: SAGA_TIMEOUT_REASON },
            ],
            { failureReason: SAGA_TIMEOUT_REASON },
          );
        default:
          return ignore(status);
      }
    case 'CANCELLED':
      if (event.type === 'StockReserved') {
        return { ...ignore(status), ignored: false, actions: [{ kind: 'ReleaseStock', reason: 'order already cancelled' }] };
      }
      if (event.type === 'PaymentAuthorized') {
        return { ...ignore(status), ignored: false, actions: [{ kind: 'VoidPayment', reason: 'order already cancelled' }] };
      }
      return ignore(status);
    case 'CONFIRMED':
      return ignore(status);
  }
}

export function isTerminal(status: OrderStatus): boolean {
  return status === 'CONFIRMED' || status === 'CANCELLED';
}

/** Map an incoming Kafka event (inventory.events / payments.events) to a saga event. */
export function toSagaEvent(type: string, data: Record<string, unknown>): SagaEvent | null {
  switch (type) {
    case 'StockReserved':
      return { type };
    case 'StockReservationFailed':
      return { type, reason: String(data.reason ?? 'stock reservation failed') };
    case 'PaymentAuthorized':
      return { type, paymentId: String(data.paymentId) };
    case 'PaymentFailed':
      return { type, reason: String(data.reason ?? 'payment failed') };
    default:
      return null;
  }
}
