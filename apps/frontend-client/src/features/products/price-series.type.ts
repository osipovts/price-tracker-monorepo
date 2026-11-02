/** Weeks start on Monday: the point of a week is the end of its Sunday. */
export const granularities = ['hour', 'day', 'week'] as const;

export type GranularityType = (typeof granularities)[number];

export interface PricePointInterface {
  observedAt: Date;
  /** In kopecks. */
  amountMinor: number;
}

export interface PriceBucketInterface {
  /** The start of the hour, the day or the week, in the time of the browser. */
  start: Date;
  /** What the chart draws at the end of the bucket: the last price read by then; null before the first price. */
  value: number | null;
  /** False when no price was read in the bucket and `value` is carried over from the point before. */
  observed: boolean;
}

/** The days of a week: the setters of Date take the days, not the weeks. */
const daysOfWeek = 7;

function startOfBucket(date: Date, granularity: GranularityType): Date {
  const start = new Date(date);
  if (granularity === 'hour') {
    start.setMinutes(0, 0, 0);

    return start;
  }

  start.setHours(0, 0, 0, 0);
  // getDay counts from Sunday: the days since Monday.
  if (granularity === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % daysOfWeek));

  return start;
}

/** The start of the bucket `steps` after this one, or before it when negative. */
function shiftBucket(start: Date, granularity: GranularityType, steps: number): Date {
  const shifted = new Date(start);
  if (granularity === 'hour') shifted.setHours(shifted.getHours() + steps);
  else shifted.setDate(shifted.getDate() + steps * (granularity === 'week' ? daysOfWeek : 1));

  return shifted;
}

function nextBucket(start: Date, granularity: GranularityType): Date {
  return shiftBucket(start, granularity, 1);
}

/** The moment the point of the bucket stands for: the end of the hour, the day itself, the Sunday of the week. */
export function pointDate(start: Date, granularity: GranularityType): Date {
  if (granularity === 'hour') return nextBucket(start, granularity);

  return granularity === 'week' ? shiftBucket(start, 'day', daysOfWeek - 1) : start;
}

/** The last of the sorted prices from `index` on that were read before `end`, and the index after them. */
function lastBefore(
  sorted: readonly PricePointInterface[],
  index: number,
  end: Date,
): { last: number | null; next: number } {
  let last: number | null = null;
  let next = index;
  for (
    let point = sorted[next];
    point !== undefined && point.observedAt < end;
    point = sorted[next]
  ) {
    last = point.amountMinor;
    next += 1;
  }

  return { last, next };
}

/**
 * The prices of the last `count` hours, days or weeks, a point at the end of each: the last price read by
 * then. A bucket with no price read takes the one of the point before, and says that it was not observed.
 */
export function buildPriceSeries(
  points: PricePointInterface[],
  granularity: GranularityType,
  count: number,
  now: Date,
): PriceBucketInterface[] {
  const sorted = points.toSorted((a, b): number => a.observedAt.getTime() - b.observedAt.getTime());

  const first = shiftBucket(startOfBucket(now, granularity), granularity, 1 - count);

  // The last price before the first bucket carries into it.
  const before = lastBefore(sorted, 0, first);
  let carried = before.last;
  let index = before.next;

  const buckets: PriceBucketInterface[] = [];
  let start = first;
  for (let step = 0; step < count; step += 1) {
    const end = nextBucket(start, granularity);
    const { last, next } = lastBefore(sorted, index, end);
    index = next;

    buckets.push({ start, value: last ?? carried, observed: last !== null });
    carried = last ?? carried;
    start = end;
  }

  return buckets;
}
