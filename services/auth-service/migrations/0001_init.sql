CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY,
  email         text        NOT NULL,
  password_hash text        NOT NULL,
  name          text        NOT NULL,
  roles         text[]      NOT NULL DEFAULT ARRAY['customer'],
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));
