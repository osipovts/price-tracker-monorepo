import { Text } from '@mantine/core';
import { useLocale } from 'frontend-shared';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { describePriceChecks, type PriceChecksInterface } from './price-checks.type.js';

/** The quiet line under a name: when the price was read, and when it is read again. */
export function PriceChecks({ checks }: { checks: PriceChecksInterface }): ReactElement | null {
  const { t } = useTranslation();
  const locale = useLocale();
  const text = describePriceChecks(checks, t, locale, new Date());

  if (text === null) return null;

  return (
    <Text size="xs" c="dimmed">
      {text}
    </Text>
  );
}
