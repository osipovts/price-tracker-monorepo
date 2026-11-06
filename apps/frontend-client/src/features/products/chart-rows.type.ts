import { type GranularityType, pointDate, type PriceBucketInterface } from './price-series.type.js';

/**
 * The price at a point on the lines of one kind, solid or dashed. The lines of a kind are two, and the runs
 * take turns on them: a line joins the points it has next to each other, and two runs of a kind must not join.
 */
export type RunValuesType = [number | null, number | null];

export interface ChartCellInterface {
  /** On a run of segments that end where a price was read since the point before. */
  solid: RunValuesType;
  /** On a run of segments that end where none was: the point keeps the price of the one before it. */
  dashed: RunValuesType;
  bucket: PriceBucketInterface;
}

export interface ChartRowInterface {
  /** Unique, since the axis takes equal keys for one place: the hours of two days have equal labels. */
  key: string;
  start: Date;
  /** What each line has at this place, by the id of the line. */
  cells: Record<string, ChartCellInterface>;
  /**
   * What the chart draws, by the id of the line: `<id>:solid:<0|1>` and `<id>:dashed:<0|1>` for the runs,
   * `<id>:read` for the dot of a price read in the bucket, `<id>:value` for the point under the pointer.
   */
  values: Record<string, number | null>;
}

export const runKinds = ['solid', 'dashed'] as const;
export const runTurns = [0, 1] as const;

type RunKindType = (typeof runKinds)[number];

/** The day and the month in the order of the language, the month in three letters: "01 янв", "Jan 01". */
function shortDayOf(point: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short' })
    .formatToParts(point)
    .map(({ type, value }): string =>
      type === 'month' ? value.replace('.', '').slice(0, 3) : value,
    )
    .join('');
}

export function labelOf(start: Date, granularity: GranularityType, locale: string): string {
  const point = pointDate(start, granularity);

  return granularity === 'hour'
    ? point.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : shortDayOf(point, locale);
}

export function titleOf(start: Date, granularity: GranularityType, locale: string): string {
  const point = pointDate(start, granularity);

  return granularity === 'hour'
    ? point.toLocaleString(locale, {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : point.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** How the line comes to a point from the one before: solid when a price was read between them. */
function segmentKind(
  bucket: PriceBucketInterface,
  previous: PriceBucketInterface | undefined,
): RunKindType | null {
  if (previous?.value === null || previous === undefined || bucket.value === null) return null;

  return bucket.observed ? 'solid' : 'dashed';
}

/** Each segment goes on the line of its kind; a new run of a kind goes on the other of its two lines. */
function cellsOf(buckets: PriceBucketInterface[]): ChartCellInterface[] {
  const cells = buckets.map((bucket): ChartCellInterface => ({
    solid: [null, null],
    dashed: [null, null],
    bucket,
  }));
  const runs: Record<RunKindType, number> = { solid: -1, dashed: -1 };
  let kindBefore: RunKindType | null = null;

  buckets.forEach((bucket, index): void => {
    const kind = segmentKind(bucket, buckets[index - 1]);
    const [from, to] = [cells[index - 1], cells[index]];
    if (kind !== null && kind !== kindBefore) runs[kind] += 1;
    kindBefore = kind;
    if (kind === null || from === undefined || to === undefined) return;

    const turn = runs[kind] % 2;
    from[kind][turn] = from.bucket.value;
    to[kind][turn] = bucket.value;
  });

  return cells;
}

/** What the chart draws of a line at a point, by the keys of `ChartRowInterface.values`. */
function valuesOf(id: string, cell: ChartCellInterface): Record<string, number | null> {
  const values: Record<string, number | null> = {};
  for (const kind of runKinds) {
    for (const turn of runTurns) values[`${id}:${kind}:${String(turn)}`] = cell[kind][turn];
  }
  values[`${id}:read`] = cell.bucket.observed ? cell.bucket.value : null;
  values[`${id}:value`] = cell.bucket.value;

  return values;
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
      values: {},
    };
    for (const line of cells) {
      const cell = line.cells[index];
      if (cell === undefined) continue;

      row.cells[line.id] = cell;
      Object.assign(row.values, valuesOf(line.id, cell));
    }

    return row;
  });
}

/**
 * The lines take most of the height of the chart and keep off its edges: a twentieth of the spread of the
 * prices on each side. A flat price or a small change spans at least 4% of the price, not to look like a cliff.
 */
export function paddedDomain(
  lines: readonly PriceBucketInterface[][],
): [number, number] | ['auto', 'auto'] {
  const values = lines
    .flat()
    .flatMap((bucket): number[] => (bucket.value === null ? [] : [bucket.value]));
  if (values.length === 0) return ['auto', 'auto'];

  const [min, max] = [Math.min(...values), Math.max(...values)];
  const padding = Math.max((max - min) * 0.05, (max * 0.04 - (max - min)) / 2);

  return [Math.floor(min - padding), Math.ceil(max + padding)];
}

export function isRow(value: unknown): value is ChartRowInterface {
  return typeof value === 'object' && value !== null && 'cells' in value && 'key' in value;
}

/** The steps of the axis of prices: 1, 2, 2.5 or 5 times a power of ten, never below a ruble. */
const stepFactors = [1, 2, 2.5, 5, 10];
const minStep = 100;

/**
 * Round marks of the axis of prices within the domain, about `count` of them: "110 000 ₽" reads
 * at a glance, "112 516 ₽" does not. None when the domain is not known yet.
 */
export function roundTicks(domain: [number, number] | ['auto', 'auto'], count: number): number[] {
  const [min, max] = domain;
  if (min === 'auto') return [];

  const rough = Math.max(minStep, (max - min) / Math.max(1, count - 1));
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(
    minStep,
    (stepFactors.find((factor): boolean => factor * power >= rough) ?? 10) * power,
  );
  const ticks: number[] = [];
  for (let tick = Math.ceil(min / step) * step; tick <= max; tick += step) ticks.push(tick);

  return ticks;
}
