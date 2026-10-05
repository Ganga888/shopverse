export interface RatingSummary {
  count: number;
  average: number;
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
}

/** Aggregate `(rating, count)` rows into count / average (1 decimal) / full 1..5 distribution. */
export function summarize(rows: { rating: number; n: number }[]): RatingSummary {
  const distribution = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 } as RatingSummary['distribution'];
  let count = 0;
  let sum = 0;
  for (const r of rows) {
    const k = String(r.rating) as keyof RatingSummary['distribution'];
    if (!(k in distribution)) continue;
    distribution[k] += r.n;
    count += r.n;
    sum += r.rating * r.n;
  }
  return { count, average: count ? Math.round((sum / count) * 10) / 10 : 0, distribution };
}
