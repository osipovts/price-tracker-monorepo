import type { GranularityType, PriceBucketInterface } from './price-series.type.js';

export interface ChartCellInterface {
  /** Where the bucket has prices: drawn solid. */
  solid: number | null;
  /** Where it has none, and the points beside it: the last known price, drawn dashed. */
  dashed: number | null;
  bucket: PriceBucketInterface;
}

export interface ChartRowInterface {
  /** Unique, since the axis takes equal keys for one place: the hours of two days have equal labels. */
  key: string;
  start: Date;
  /** What each line has at this place, by the id of the line. */
  cells: Record<string, ChartCellInterface>;
}

export function labelOf(start: Date, granularity: GranularityType, locale: string): string {
  return granularity === 'hour'
    ? start.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : start.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
}

export function titleOf(start: Date, granularity: GranularityType, locale: string): string {
  return granularity === 'hour'
    ? start.toLocaleString(locale, {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : start.toLocaleDateString(locale, { day: '2-digit', month: 'long', year: 'numeric' });
}

/** A gap is dashed together with the points on both of its sides, so that the line is not broken. */
function cellsOf(buckets: PriceBucketInterface[]): ChartCellInterface[] {
  return buckets.map((bucket, index): ChartCellInterface => {
    const beside = [buckets[index - 1], buckets[index + 1]];
    const nearGap =
      !bucket.observed || beside.some((other): boolean => other !== undefined && !other.observed);

    return {
      solid: bucket.observed ? bucket.value : null,
      dashed: nearGap ? bucket.value : null,
      bucket,
    };
  });
}

/** The lines of a chart share their places: the buckets of every line start at the same moments. */
export function toRows(
  lines: ReadonlyArray<{ id: string; buckets: PriceBucketInterface[] }>,
): ChartRowInterface[] {
  const cells = lines.map(({ id, buckets }) => ({ id, cells: cellsOf(buckets) }));
  const [first] = lines;

  return (first?.buckets ?? []).map((bucket, index): ChartRowInterface => {
    const row: ChartRowInterface = {
      key: bucket.start.toISOString(),
      start: bucket.start,
      cells: {},
    };
    for (const line of cells) {
      const cell = line.cells[index];
      if (cell !== undefined) row.cells[line.id] = cell;
    }

    return row;
  });
}

/** The lines keep off the edges of the chart: one would run along the axis at the lowest price. */
export function paddedDomain(
  lines: readonly PriceBucketInterface[][],
): [number, number] | ['auto', 'auto'] {
  const values = lines
    .flat()
    .flatMap((bucket): number[] => (bucket.value === null ? [] : [bucket.value]));
  if (values.length === 0) return ['auto', 'auto'];

  const [min, max] = [Math.min(...values), Math.max(...values)];
  const padding = Math.max((max - min) * 0.1, max * 0.02);

  return [Math.floor(min - padding), Math.ceil(max + padding)];
}

export function isRow(value: unknown): value is ChartRowInterface {
  return typeof value === 'object' && value !== null && 'cells' in value && 'key' in value;
}
