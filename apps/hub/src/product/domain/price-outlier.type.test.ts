import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { findPriceOutlierIds, type PricedPointInterface } from './price-outlier.type.js';

function point(id: string, hour: number, rubles: number): PricedPointInterface {
  return {
    id,
    observedAt: new Date(Date.UTC(2026, 10, 19, hour)),
    amountMinor: rubles * 100,
  };
}

void describe('findPriceOutlierIds', (): void => {
  void it('flags an isolated upward spike between stable neighbours (ASUS Zenbook / Lenovo Xiaoxin)', (): void => {
    const asus = [
      point('a1', 17, 205_906),
      point('a2', 18, 408_501),
      point('a3', 19, 199_332),
    ];
    const lenovo = [
      point('l1', 17, 161_509),
      point('l2', 18, 308_054),
      point('l3', 19, 154_027),
    ];

    assert.deepEqual([...findPriceOutlierIds(asus)], ['a2']);
    assert.deepEqual([...findPriceOutlierIds(lenovo)], ['l2']);
  });

  void it('flags an isolated downward dip', (): void => {
    const points = [point('p1', 1, 100_000), point('p2', 2, 100), point('p3', 3, 100_000)];

    assert.deepEqual([...findPriceOutlierIds(points)], ['p2']);
  });

  void it('keeps sustained price swings and moderate single-point shifts (Honor MagicBook)', (): void => {
    const honor = [
      point('h1', 1, 83_886),
      point('h2', 2, 118_777),
      point('h3', 3, 118_777),
      point('h4', 4, 84_458),
      point('h5', 5, 79_395),
      point('h6', 6, 122_774),
      point('h7', 7, 92_350),
      point('h8', 8, 92_350),
    ];

    assert.deepEqual([...findPriceOutlierIds(honor)], []);
  });

  void it('handles unsorted input and ignores edge points or short series', (): void => {
    const unsorted = [point('p3', 3, 100_000), point('p1', 1, 100_000), point('p2', 2, 200_000)];

    assert.deepEqual([...findPriceOutlierIds(unsorted)], ['p2']);
    assert.deepEqual(
      [...findPriceOutlierIds([point('only1', 1, 100_000), point('only2', 2, 300_000)])],
      [],
    );
  });
});
