CREATE TABLE IF NOT EXISTS orders (
  id               uuid PRIMARY KEY,
  user_id          text        NOT NULL,
  user_email       text,
  status           text        NOT NULL CHECK (status IN ('PENDING', 'STOCK_RESERVED', 'CONFIRMED', 'CANCELLED')),
  subtotal_cents   bigint      NOT NULL CHECK (subtotal_cents >= 0),
  discount_cents   bigint      NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  total_cents      bigint      NOT NULL CHECK (total_cents >= 0),
  currency         text        NOT NULL DEFAULT 'INR',
  coupon_code      text,
  shipping_address jsonb       NOT NULL,
  payment_id       text,
  failure_reason   text,
  idempotency_key  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS orders_user_created_idx ON orders (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  order_id         uuid   NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id       uuid   NOT NULL,
  name             text   NOT NULL,
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
  quantity         int    NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (order_id, product_id)
);

CREATE TABLE IF NOT EXISTS saga_state (
  order_id    uuid PRIMARY KEY REFERENCES orders (id) ON DELETE CASCADE,
  step        text        NOT NULL,
  status      text        NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'COMPENSATED')),
  context     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  history     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  started_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deadline_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS saga_state_running_deadline_idx ON saga_state (deadline_at) WHERE status = 'RUNNING';
