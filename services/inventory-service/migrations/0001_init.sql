CREATE TABLE IF NOT EXISTS stock (
  product_id uuid PRIMARY KEY,
  available  int         NOT NULL CHECK (available >= 0),
  reserved   int         NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reservations (
  order_id   uuid        NOT NULL,
  product_id uuid        NOT NULL REFERENCES stock (product_id),
  quantity   int         NOT NULL CHECK (quantity > 0),
  status     text        NOT NULL CHECK (status IN ('RESERVED', 'RELEASED', 'COMMITTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, product_id)
);
CREATE INDEX IF NOT EXISTS reservations_status_idx ON reservations (status, created_at);
