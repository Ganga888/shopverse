CREATE TABLE IF NOT EXISTS search_documents (
  product_id  uuid PRIMARY KEY,
  sku         text        NOT NULL,
  name        text        NOT NULL,
  description text        NOT NULL DEFAULT '',
  category    text        NOT NULL,
  price_cents bigint      NOT NULL,
  currency    char(3)     NOT NULL DEFAULT 'INR',
  image_url   text,
  active      boolean     NOT NULL DEFAULT true,
  version     int         NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  doc tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(category, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'C')
  ) STORED
);
CREATE INDEX IF NOT EXISTS search_documents_doc_idx ON search_documents USING GIN (doc);
CREATE INDEX IF NOT EXISTS search_documents_category_idx ON search_documents (category) WHERE active;
