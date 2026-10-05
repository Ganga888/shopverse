-- W3C trace context captured when the event was enqueued, so the relay can continue the original trace.
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS headers jsonb NOT NULL DEFAULT '{}'::jsonb;
