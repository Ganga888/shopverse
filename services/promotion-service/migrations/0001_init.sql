CREATE TABLE IF NOT EXISTS coupons (
  code               text PRIMARY KEY CHECK (code = upper(code)),
  type               text        NOT NULL CHECK (type IN ('PERCENT', 'FIXED')),
  value              int         NOT NULL CHECK (value > 0),
  min_subtotal_cents bigint      NOT NULL DEFAULT 0,
  max_discount_cents bigint,
  starts_at          timestamptz NOT NULL DEFAULT now(),
  ends_at            timestamptz,
  usage_limit        int,
  used_count         int         NOT NULL DEFAULT 0,
  active             boolean     NOT NULL DEFAULT true,
  description        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (type <> 'PERCENT' OR value <= 100)
);

CREATE TABLE IF NOT EXISTS redemptions (
  id             bigserial PRIMARY KEY,
  code           text        NOT NULL REFERENCES coupons (code),
  user_id        text        NOT NULL,
  discount_cents bigint      NOT NULL,
  redeemed_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS redemptions_code_idx ON redemptions (code, redeemed_at DESC);
