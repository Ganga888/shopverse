/** Shared event/command payload contracts (envelope `type` -> `data`). */

export interface OrderLine {
  productId: string;
  quantity: number;
  unitPriceCents?: number;
  name?: string;
}

export interface Address {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone?: string;
}

export interface UserRegistered { userId: string; email: string; name: string }
export interface ProductChanged {
  productId: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  priceCents: number;
  currency: string;
  imageUrl: string | null;
  active: boolean;
  version: number;
}
export interface OrderCreated { orderId: string; userId: string; items: OrderLine[]; totalCents: number; currency: string }
export interface OrderConfirmed extends OrderCreated { userEmail?: string; shippingAddress: Address; paymentId: string }
export interface OrderCancelled { orderId: string; userId: string; userEmail?: string; reason: string }
export interface ReserveStock { orderId: string; items: OrderLine[] }
export interface ReleaseStock { orderId: string; reason: string }
export interface StockReserved { orderId: string }
export interface StockReservationFailed { orderId: string; reason: string; productId?: string }
export interface AuthorizePayment { orderId: string; userId: string; amountCents: number; currency: string; paymentToken: string }
export interface VoidPayment { orderId: string; reason: string }
export interface PaymentAuthorized { orderId: string; paymentId: string; amountCents: number }
export interface PaymentFailed { orderId: string; reason: string }
export interface ShipmentCreated { shipmentId: string; orderId: string; userId: string; carrier: string; trackingNumber: string }
export interface ShipmentStatusChanged { shipmentId: string; orderId: string; userId: string; status: string }
export interface ReviewCreated { reviewId: string; productId: string; userId: string; rating: number }

export const EventTypes = {
  UserRegistered: 'UserRegistered',
  ProductCreated: 'ProductCreated',
  ProductUpdated: 'ProductUpdated',
  ProductDeleted: 'ProductDeleted',
  OrderCreated: 'OrderCreated',
  OrderConfirmed: 'OrderConfirmed',
  OrderCancelled: 'OrderCancelled',
  ReserveStock: 'ReserveStock',
  ReleaseStock: 'ReleaseStock',
  StockReserved: 'StockReserved',
  StockReservationFailed: 'StockReservationFailed',
  StockReleased: 'StockReleased',
  StockCommitted: 'StockCommitted',
  AuthorizePayment: 'AuthorizePayment',
  VoidPayment: 'VoidPayment',
  PaymentAuthorized: 'PaymentAuthorized',
  PaymentFailed: 'PaymentFailed',
  PaymentVoided: 'PaymentVoided',
  ShipmentCreated: 'ShipmentCreated',
  ShipmentStatusChanged: 'ShipmentStatusChanged',
  ReviewCreated: 'ReviewCreated',
  ReviewDeleted: 'ReviewDeleted',
} as const;

/** Fixed IDs of the demo catalogue (seeded by catalog + inventory when SEED_SAMPLE_DATA=true). */
export const SAMPLE_PRODUCTS = [
  { id: '6f1c2a10-0000-4000-8000-000000000001', sku: 'SV-TSHIRT-001', name: 'Organic Cotton T-Shirt', description: 'Soft breathable everyday tee made from organic cotton', category: 'apparel', priceCents: 79900, imageUrl: null },
  { id: '6f1c2a10-0000-4000-8000-000000000002', sku: 'SV-SNEAKER-002', name: 'Running Sneakers', description: 'Lightweight running shoes with cushioned sole', category: 'footwear', priceCents: 349900, imageUrl: null },
  { id: '6f1c2a10-0000-4000-8000-000000000003', sku: 'SV-MUG-003', name: 'Ceramic Coffee Mug', description: 'Stoneware mug for coffee and tea, 350ml', category: 'kitchen', priceCents: 39900, imageUrl: null },
  { id: '6f1c2a10-0000-4000-8000-000000000004', sku: 'SV-HEADPHONES-004', name: 'Wireless Headphones', description: 'Noise cancelling bluetooth over-ear headphones', category: 'electronics', priceCents: 899900, imageUrl: null },
  { id: '6f1c2a10-0000-4000-8000-000000000005', sku: 'SV-BACKPACK-005', name: 'Travel Backpack', description: 'Water resistant 30L backpack with laptop sleeve', category: 'bags', priceCents: 249900, imageUrl: null },
  { id: '6f1c2a10-0000-4000-8000-000000000006', sku: 'SV-BOTTLE-006', name: 'Insulated Water Bottle', description: 'Steel bottle keeps drinks cold for 24 hours', category: 'kitchen', priceCents: 101300, imageUrl: null },
] as const;
