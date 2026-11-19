import { describe, expect, it } from 'vitest';

import { findPriceOutlierIds } from './price-outlier.type.js';
import type { ObservationType } from './use-products.hook.js';

function observation(id: string, hour: number, rubles: number | null): ObservationType {
  return {
    id,
    observedAt: new Date(Date.UTC(2026, 10, 19, hour)).toISOString(),
    title: 'Test',
    availability: rubles === null ? 'out_of_stock' : 'in_stock',
    prices: rubles === null ? [] : [{ amountMinor: rubles * 100, currency: 'RUB' }],
    exitIp: null,
  };
}

describe('findPriceOutlierIds', (): void => {
  it('flags isolated spikes and dips while ignoring unpriced observations', (): void => {
    const observations = [
      observation('a1', 17, 205_906),
      observation('empty', 17.5, null),
      observation('a2', 18, 408_501),
      observation('a3', 19, 199_332),
      observation('a4', 20, 100),
      observation('a5', 21, 199_332),
    ];

    expect([...findPriceOutlierIds(observations)]).toEqual(['a2', 'a4']);
  });

  it('keeps sustained swings and moderate single-point changes', (): void => {
    const honor = [
      observation('h1', 1, 83_886),
      observation('h2', 2, 118_777),
      observation('h3', 3, 118_777),
      observation('h4', 4, 79_395),
      observation('h5', 5, 122_774),
      observation('h6', 6, 92_350),
    ];

    expect([...findPriceOutlierIds(honor)]).toEqual([]);
  });
});
