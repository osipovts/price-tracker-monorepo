import type { TFunction } from 'i18next';

import { formatDayMoment } from './moment-format.type.js';

export interface PriceChecksInterface {
  /** When the price was read last; null while it never was. */
  checkedAt: string | null;
  /** The marketplace of that read, told where there are several to tell it from; null otherwise. */
  marketplace: string | null;
  /** When it is read again; a time that has passed means soon. Null when there is none to come. */
  nextAt: string | null;
}

export interface PriceCheckTimesInterface {
  /** When the price was read: "today at 09:00", with the marketplace when it is told; null when it never was. */
  checked: string | null;
  /** When it is read next: within hours, its time alone, or soon; null when there is none to come. */
  next: string | null;
}

/** When the price was read and when it is read again, the words of each without what it is: the icons tell that. */
export function describePriceChecks(
  { checkedAt, marketplace, nextAt }: PriceChecksInterface,
  t: TFunction,
  locale: string,
  now: Date,
): PriceCheckTimesInterface {
  const when = checkedAt === null ? null : formatDayMoment(checkedAt, t, locale, now);
  const checked =
    when === null || marketplace === null ? when : t('product.checkedOn', { when, marketplace });

  if (nextAt === null) return { checked, next: null };

  const next = new Date(nextAt);

  return {
    checked,
    next:
      next <= now
        ? t('product.nextCheckSoon')
        : next.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
  };
}
