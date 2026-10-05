CREATE TABLE IF NOT EXISTS audit_events (
  id             text PRIMARY KEY,
  type           text        NOT NULL,
  source         text        NOT NULL,
  topic          text        NOT NULL,
  correlation_id text        NOT NULL,
  event_time     timestamptz NOT NULL,
  data           jsonb       NOT NULL,
  received_at    timestamptz NOT NULL DEFAULT now(),
  archived_at    timestamptz,
  archive_key    text
);
CREATE INDEX IF NOT EXISTS audit_events_correlation_idx ON audit_events (correlation_id, event_time);
CREATE INDEX IF NOT EXISTS audit_events_type_time_idx ON audit_events (type, event_time DESC);
CREATE INDEX IF NOT EXISTS audit_events_unarchived_idx ON audit_events (received_at) WHERE archived_at IS NULL;
