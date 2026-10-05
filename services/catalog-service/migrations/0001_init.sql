CREATE TABLE IF NOT EXISTS products (
  id          uuid PRIMARY KEY,
  sku         text        NOT NULL UNIQUE,
  name        text        NOT NULL,
  description text        NOT NULL DEFAULT '',
  category    text        NOT NULL,
  price_cents bigint      NOT NULL CHECK (price_cents >= 0),
  currency    char(3)     NOT NULL DEFAULT 'INR',
  image_url   text,
  active      boolean     NOT NULL DEFAULT true,
  version     int         NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_category_idx ON products (category, created_at DESC) WHERE active;
CREATE INDEX IF NOT EXISTS products_active_created_idx ON products (created_at DESC) WHERE active;
