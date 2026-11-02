export const statsPeriods = ['24h', '7d', '30d'] as const;

export type StatsPeriodType = (typeof statsPeriods)[number];

export const defaultStatsPeriod: StatsPeriodType = '24h';

const hourMs = 3_600_000;

export const statsPeriodMs: Record<StatsPeriodType, number> = {
  '24h': 24 * hourMs,
  '7d': 7 * 24 * hourMs,
  '30d': 30 * 24 * hourMs,
};
