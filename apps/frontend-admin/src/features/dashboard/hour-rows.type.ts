const hourMs = 3_600_000;

/** How many hours the charts of the dashboard show: the last day. */
export const chartHours = 24;

/** The reads of an hour, by marketplace. */
export interface ReadRowInterface {
  /** The start of the hour. */
  hour: string;
  counts: Record<string, number>;
  total: number;
}

/** How the price jobs of an hour ended. */
export interface JobRowInterface {
  hour: string;
  completed: number;
  failed: number;
}

/** The starts of the last hours, the current one last. */
export function lastHours(now: number, count = chartHours): string[] {
  const current = Math.floor(now / hourMs) * hourMs;

  return Array.from({ length: count }, (_, index): string =>
    new Date(current - (count - 1 - index) * hourMs).toISOString(),
  );
}

/** A row for each of the last hours, with nothing read where the hub names no read. */
export function readRows(
  reads: ReadonlyArray<{ hour: string; marketplace: string; reads: number }>,
  now: number,
): ReadRowInterface[] {
  return lastHours(now).map((hour): ReadRowInterface => {
    const start = new Date(hour).getTime();
    const counts: Record<string, number> = {};
    for (const read of reads) {
      if (new Date(read.hour).getTime() === start) {
        counts[read.marketplace] = (counts[read.marketplace] ?? 0) + read.reads;
      }
    }

    return {
      hour,
      counts,
      total: Object.values(counts).reduce((sum, count): number => sum + count, 0),
    };
  });
}

/** A row for each of the last hours, with no job where the hub names none. */
export function jobRows(
  jobs: ReadonlyArray<{ hour: string; completed: number; failed: number }>,
  now: number,
): JobRowInterface[] {
  return lastHours(now).map((hour): JobRowInterface => {
    const start = new Date(hour).getTime();
    const found = jobs.find((job): boolean => new Date(job.hour).getTime() === start);

    return { hour, completed: found?.completed ?? 0, failed: found?.failed ?? 0 };
  });
}
