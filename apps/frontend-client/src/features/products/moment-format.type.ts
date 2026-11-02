/** A date and a time as a person reads them in the list: short, without the seconds. */
export function formatMoment(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
}

const dayMs = 86_400_000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * A moment as a person reads it in a line: "today" or "yesterday" with the time, any other day as
 * dd.mm.yyyy with the time. The days are the ones of the browser, not of the hub.
 */
export function formatDayMoment(iso: string, locale: string, now: Date = new Date()): string {
  const moment = new Date(iso);
  const time = moment.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const daysAgo = Math.round((startOfDay(now) - startOfDay(moment)) / dayMs);

  if (daysAgo === 0 || daysAgo === 1) {
    return `${new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-daysAgo, 'day')}, ${time}`;
  }

  const day = String(moment.getDate()).padStart(2, '0');
  const month = String(moment.getMonth() + 1).padStart(2, '0');

  return `${day}.${month}.${String(moment.getFullYear())}, ${time}`;
}
