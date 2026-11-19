import { priceOf } from './observation.type.js';
import type { ObservationType } from './use-products.hook.js';

/** A single-point jump above this multiple of both neighbours is treated as a transient spike. */
export const outlierHighRatio = 1.5;

/** A single-point drop below this fraction of both neighbours is treated as a transient dip. */
export const outlierLowRatio = 0.65;

interface PricedObservationInterface {
  id: string;
  observedAtMs: number;
  amountMinor: number;
}

/**
 * Ids of observations that are isolated price spikes or dips: a point that stands far above or below
 * both its chronological neighbours. Sustained shifts (even sharp ones) are kept because the next
 * observation confirms the new level.
 */
export function findPriceOutlierIds(
  observations: readonly ObservationType[],
): ReadonlySet<string> {
  const priced = observations
    .flatMap((observation): PricedObservationInterface[] => {
      const amountMinor = priceOf(observation);

      return amountMinor === null
        ? []
        : [
            {
              id: observation.id,
              observedAtMs: new Date(observation.observedAt).getTime(),
              amountMinor,
            },
          ];
    })
    .toSorted((a, b): number => a.observedAtMs - b.observedAtMs);

  if (priced.length < 3) return new Set();

  const outliers = new Set<string>();
  for (let index = 1; index < priced.length - 1; index += 1) {
    const previous = priced[index - 1];
    const current = priced[index];
    const next = priced[index + 1];
    if (previous === undefined || current === undefined || next === undefined) continue;
    if (previous.amountMinor <= 0 || current.amountMinor <= 0 || next.amountMinor <= 0) continue;

    const aboveBoth =
      current.amountMinor > Math.max(previous.amountMinor, next.amountMinor) * outlierHighRatio;
    const belowBoth =
      current.amountMinor < Math.min(previous.amountMinor, next.amountMinor) * outlierLowRatio;

    if (aboveBoth || belowBoth) outliers.add(current.id);
  }

  return outliers;
}
