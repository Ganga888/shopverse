import { describe, expect, it } from 'vitest';
import { coPurchasePairs, mergeRanked, parseScored } from '../src/recs.js';

describe('recommendations', () => {
  it('generates directed co-purchase pairs without self pairs or duplicates', () => {
    expect(coPurchasePairs(['a', 'b', 'a'])).toEqual([['a', 'b'], ['b', 'a']]);
    expect(coPurchasePairs(['a'])).toEqual([]);
    expect(coPurchasePairs(['a', 'b', 'c'])).toHaveLength(6);
  });
  it('parses WITHSCORES output', () => {
    expect(parseScored(['a', '3', 'b', '1'])).toEqual([{ productId: 'a', score: 3 }, { productId: 'b', score: 1 }]);
  });
  it('merges ranked lists, excluding ids and limiting', () => {
    const merged = mergeRanked([[{ productId: 'a', score: 2 }, { productId: 'b', score: 1 }], [{ productId: 'b', score: 5 }, { productId: 'x', score: 9 }]], new Set(['x']), 5);
    expect(merged).toEqual([{ productId: 'b', score: 6 }, { productId: 'a', score: 2 }]);
  });
});
