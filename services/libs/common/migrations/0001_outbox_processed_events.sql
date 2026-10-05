-- Shared tables applied to every Postgres-backed service before its own migrations.
CREATE TABLE IF NOT EXISTS outbox (
  seq          bigserial PRIMARY KEY,
  id           text        NOT NULL UNIQUE,
  topic        text        NOT NULL,
  key          text,
  payload      jsonb       NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_unpublished_idx ON outbox (seq) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS processed_events (
  id           text PRIMARY KEY,
  topic        text NOT NULL,
  type         text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);
