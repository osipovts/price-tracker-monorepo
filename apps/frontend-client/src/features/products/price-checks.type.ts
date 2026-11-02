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

/**
 * When the price was read and is read again, in one line: "Checked today, 09:00, ozon. Next check
 * 12:00". The next read is within hours: its time alone. The parts not known are left out; null when neither is.
 */
export function describePriceChecks(
  { checkedAt, marketplace, nextAt }: PriceChecksInterface,
  t: TFunction,
  locale: string,
  now: Date,
): string | null {
  const parts: string[] = [];
  if (checkedAt !== null) {
    const when = formatDayMoment(checkedAt, locale, now);
    parts.push(
      marketplace === null
        ? t('product.checked', { when })
        : t('product.checkedOn', { when, marketplace }),
    );
  }
  if (nextAt !== null) {
    parts.push(
      new Date(nextAt) <= now
        ? t('product.nextCheckSoon')
        : t('product.nextCheck', {
            when: new Date(nextAt).toLocaleTimeString(locale, {
              hour: '2-digit',
              minute: '2-digit',
            }),
          }),
    );
  }

  return parts.length === 0 ? null : parts.join('. ');
}
