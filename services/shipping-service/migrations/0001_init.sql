CREATE TABLE IF NOT EXISTS shipments (
  id              uuid PRIMARY KEY,
  order_id        uuid        NOT NULL UNIQUE,
  user_id         text        NOT NULL,
  status          text        NOT NULL CHECK (status IN ('CREATED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED')),
  carrier         text        NOT NULL,
  tracking_number text        NOT NULL UNIQUE,
  address         jsonb       NOT NULL,
  items           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  eta             date,
  history         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shipments_user_idx ON shipments (user_id, created_at DESC);
