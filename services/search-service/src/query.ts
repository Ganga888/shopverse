export interface SearchParams {
  q?: string;
  category?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
  limit: number;
  offset: number;
}

/** Build a parameterised full-text query (websearch syntax, ranked by ts_rank_cd, name-prefix fallback). */
export function buildSearchQuery(p: SearchParams): { sql: string; values: unknown[] } {
  const values: unknown[] = [];
  const where = ['active'];
  let rank = '0';
  const q = p.q?.trim();
  if (q) {
    values.push(q);
    const qi = values.length;
    values.push(`${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    const pi = values.length;
    where.push(`(doc @@ websearch_to_tsquery('english', $${qi}) OR name ILIKE $${pi})`);
    rank = `ts_rank_cd(doc, websearch_to_tsquery('english', $${qi}))`;
  }
  if (p.category) {
    values.push(p.category.toLowerCase());
    where.push(`category = $${values.length}`);
  }
  if (p.minPriceCents !== undefined) {
    values.push(p.minPriceCents);
    where.push(`price_cents >= $${values.length}`);
  }
  if (p.maxPriceCents !== undefined) {
    values.push(p.maxPriceCents);
    where.push(`price_cents <= $${values.length}`);
  }
  values.push(p.limit, p.offset);
  const sql =
    `SELECT product_id, sku, name, description, category, price_cents, currency, image_url, ${rank} AS rank, count(*) OVER () AS total ` +
    `FROM search_documents WHERE ${where.join(' AND ')} ORDER BY rank DESC, name ASC ` +
    `LIMIT $${values.length - 1} OFFSET $${values.length}`;
  return { sql, values };
}
