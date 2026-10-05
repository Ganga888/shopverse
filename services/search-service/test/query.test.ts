import { describe, expect, it } from 'vitest';
import { buildSearchQuery } from '../src/query.js';

describe('search query builder', () => {
  it('lists active documents without a query', () => {
    const { sql, values } = buildSearchQuery({ limit: 10, offset: 0 });
    expect(sql).toContain('WHERE active ORDER BY');
    expect(values).toEqual([10, 0]);
  });
  it('uses websearch_to_tsquery with a name-prefix fallback and escapes LIKE wildcards', () => {
    const { sql, values } = buildSearchQuery({ q: '50%_off', limit: 5, offset: 10 });
    expect(sql).toContain("websearch_to_tsquery('english', $1)");
    expect(sql).toContain('name ILIKE $2');
    expect(values).toEqual(['50%_off', '50\\%\\_off%', 5, 10]);
    expect(sql).toMatch(/LIMIT \$3 OFFSET \$4$/);
  });
  it('adds category and price filters with correct placeholders', () => {
    const { sql, values } = buildSearchQuery({ category: 'Kitchen', minPriceCents: 100, maxPriceCents: 900, limit: 20, offset: 0 });
    expect(sql).toContain('category = $1 AND price_cents >= $2 AND price_cents <= $3');
    expect(values).toEqual(['kitchen', 100, 900, 20, 0]);
  });
});
