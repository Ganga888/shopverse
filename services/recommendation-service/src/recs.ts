export const keys = {
  co: (productId: string) => `rec:co:${productId}`,
  popular: 'rec:popular',
  user: (userId: string) => `rec:user:${userId}`,
};

/** Ordered pairs (a,b) for every distinct pair of products bought together. */
export function coPurchasePairs(productIds: string[]): [string, string][] {
  const ids = [...new Set(productIds)];
  const pairs: [string, string][] = [];
  for (const a of ids) for (const b of ids) if (a !== b) pairs.push([a, b]);
  return pairs;
}

/** Parse ZREVRANGE ... WITHSCORES output. */
export function parseScored(raw: string[]): { productId: string; score: number }[] {
  const out: { productId: string; score: number }[] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) out.push({ productId: raw[i], score: Number(raw[i + 1]) });
  return out;
}

/** Merge ranked lists (summing scores), dropping excluded ids, highest score first. */
export function mergeRanked(lists: { productId: string; score: number }[][], exclude: Set<string>, limit: number) {
  const scores = new Map<string, number>();
  for (const list of lists) for (const { productId, score } of list) if (!exclude.has(productId)) scores.set(productId, (scores.get(productId) ?? 0) + score);
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([productId, score]) => ({ productId, score }));
}
