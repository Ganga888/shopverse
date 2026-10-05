import { describe, expect, it } from 'vitest';
import { summarize } from '../src/summary.js';

describe('rating summary', () => {
  it('aggregates counts, average and distribution', () => {
    expect(summarize([{ rating: 5, n: 3 }, { rating: 4, n: 1 }, { rating: 2, n: 1 }])).toEqual({
      count: 5,
      average: 4.2,
      distribution: { '1': 0, '2': 1, '3': 0, '4': 1, '5': 3 },
    });
  });
  it('handles no reviews', () => {
    expect(summarize([])).toMatchObject({ count: 0, average: 0 });
  });
});
