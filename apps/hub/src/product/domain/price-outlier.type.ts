/** A single-point jump above this multiple of both neighbours is treated as a transient spike. */
export const outlierHighRatio = 1.5;

/** A single-point drop below this fraction of both neighbours is treated as a transient dip. */
export const outlierLowRatio = 0.65;

export interface PricedPointInterface {
  id: string;
  observedAt: Date;
  /** In kopecks. */
  amountMinor: number;
}

/**
 * Ids of observations that are isolated price spikes or dips: a point that stands far above or below
 * both its chronological neighbours. Sustained shifts (even sharp ones) are kept because the next
 * observation confirms the new level.
 */
export function findPriceOutlierIds(points: readonly PricedPointInterface[]): ReadonlySet<string> {
  if (points.length < 3) return new Set();

  const sorted = points.toSorted((a, b): number => a.observedAt.getTime() - b.observedAt.getTime());
  const outliers = new Set<string>();

  for (let index = 1; index < sorted.length - 1; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    const next = sorted[index + 1];
    if (previous === undefined || current === undefined || next === undefined) continue;
    if (previous.amountMinor <= 0 || current.amountMinor <= 0 || next.amountMinor <= 0) continue;

    const aboveBoth = current.amountMinor > Math.max(previous.amountMinor, next.amountMinor) * outlierHighRatio;
    const belowBoth = current.amountMinor < Math.min(previous.amountMinor, next.amountMinor) * outlierLowRatio;

    if (aboveBoth || belowBoth) outliers.add(current.id);
  }

  return outliers;
}
