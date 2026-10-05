CREATE TABLE IF NOT EXISTS profiles (
  id         uuid PRIMARY KEY,
  email      text        NOT NULL,
  name       text        NOT NULL,
  phone      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS addresses (
  id          uuid PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  label       text        NOT NULL DEFAULT 'home',
  name        text        NOT NULL,
  line1       text        NOT NULL,
  line2       text,
  city        text        NOT NULL,
  state       text        NOT NULL,
  postal_code text        NOT NULL,
  country     char(2)     NOT NULL,
  phone       text,
  is_default  boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS addresses_user_idx ON addresses (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS addresses_one_default_idx ON addresses (user_id) WHERE is_default;
