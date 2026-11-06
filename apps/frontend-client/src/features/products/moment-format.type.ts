import type { TFunction } from 'i18next';

/** A date and a time as a person reads them in the list: short, without the seconds. */
export function formatMoment(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
}

const dayMs = 86_400_000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "Today" or "yesterday" in the language of the user, any other day as dd.mm.yyyy. */
function dayOf(moment: Date, locale: string, now: Date): string {
  const daysAgo = Math.round((startOfDay(now) - startOfDay(moment)) / dayMs);

  if (daysAgo === 0 || daysAgo === 1) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-daysAgo, 'day');
  }

  const day = String(moment.getDate()).padStart(2, '0');
  const month = String(moment.getMonth() + 1).padStart(2, '0');

  return `${day}.${month}.${String(moment.getFullYear())}`;
}

/**
 * A moment as a person reads it in a line: "today at 09:00", "yesterday at 09:00", any other day as
 * "dd.mm.yyyy at 09:00". The days are the ones of the browser, not of the hub.
 */
export function formatDayMoment(
  iso: string,
  t: TFunction,
  locale: string,
  now: Date = new Date(),
): string {
  const moment = new Date(iso);

  return t('common.dayAt', {
    day: dayOf(moment, locale, now),
    time: moment.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
  });
}
