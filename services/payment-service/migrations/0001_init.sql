CREATE TABLE IF NOT EXISTS payments (
  id             uuid PRIMARY KEY,
  order_id       uuid UNIQUE,
  user_id        text        NOT NULL,
  amount_cents   bigint      NOT NULL CHECK (amount_cents >= 0),
  currency       text        NOT NULL DEFAULT 'INR',
  status         text        NOT NULL CHECK (status IN ('AUTHORIZED', 'FAILED', 'VOIDED')),
  gateway_ref    text,
  failure_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_user_idx ON payments (user_id, created_at DESC);

-- HTTP Idempotency-Key store: one row per (user, key); status_code NULL while the request is in flight.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id      text        NOT NULL,
  key          text        NOT NULL,
  request_hash text        NOT NULL,
  status_code  int,
  response     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
CREATE INDEX IF NOT EXISTS idempotency_keys_created_idx ON idempotency_keys (created_at);
