CREATE TABLE IF NOT EXISTS reviews (
  id         uuid PRIMARY KEY,
  product_id uuid        NOT NULL,
  user_id    text        NOT NULL,
  user_name  text        NOT NULL DEFAULT '',
  rating     smallint    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title      text        NOT NULL,
  body       text        NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, user_id)
);
CREATE INDEX IF NOT EXISTS reviews_product_created_idx ON reviews (product_id, created_at DESC);
