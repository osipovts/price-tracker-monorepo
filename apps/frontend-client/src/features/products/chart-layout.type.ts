/** The room of the axis of prices at the left of the lines, in pixels. */
export const chartPriceAxisWidth = 72;
/** The room kept at the right of the lines, for the last point not to touch the edge, in pixels. */
export const chartRightMargin = 16;
/** The height of the chart on a wide screen; a phone has half of it. */
export const chartHeight = 560;

/** The points of a wide chart: two days of hours, a month and a half of days, most of a year of weeks. */
export const chartPointsMax = 48;
/** The least room between two points, in pixels: closer, their dots run together. */
const chartPointGap = 10;

/** How many hours, days or weeks a chart this wide shows: all of the most it shows, or as many as keep apart. */
export function chartPointsFitting(width: number): number {
  const linesWidth = Math.max(0, width - chartPriceAxisWidth - chartRightMargin);

  return Math.min(chartPointsMax, Math.floor(linesWidth / chartPointGap));
}
