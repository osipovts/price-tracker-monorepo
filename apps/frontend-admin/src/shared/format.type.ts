import type { TFunction } from 'i18next';

/** A moment as the panel shows it: the date and the time to the minute; a dash for none. */
export function formatMoment(at: string | null, locale: string): string {
  return at === null
    ? '-'
    : new Date(at).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
}

/** A price in roubles, kept in kopecks, to the rouble. */
export function formatPrice(amountMinor: number, locale: string): string {
  return (amountMinor / 100).toLocaleString(locale, {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  });
}

/** How long it took from the start to the end, or until now while there is no end; null with no start. */
export function durationOf(start: string | null, end: string | null, now: number): number | null {
  return start === null
    ? null
    : Math.max(0, (end === null ? now : new Date(end).getTime()) - new Date(start).getTime());
}

/** A duration in seconds, minutes and seconds, or hours and minutes. */
export function formatDuration(ms: number, t: TFunction): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return t('jobs.seconds', { value: seconds });

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('jobs.minutes', { minutes, seconds: seconds % 60 });

  return t('jobs.hours', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}
