import { Box, Text } from '@mantine/core';
import { useLocale } from 'frontend-shared';
import { Fragment, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { describePriceChecks, type PriceChecksInterface } from './price-checks.type.js';

/** The quiet line under a name: when the price was read, and when it is read again; on a phone, a line each. */
export function PriceChecks({ checks }: { checks: PriceChecksInterface }): ReactElement | null {
  const { t } = useTranslation();
  const locale = useLocale();
  const parts = describePriceChecks(checks, t, locale, new Date());

  if (parts.length === 0) return null;

  return (
    <Text size="xs" c="dimmed">
      {parts.map((part, index): ReactElement => (
        <Fragment key={part}>
          {index > 0 && (
            <>
              <Box component="span" visibleFrom="sm">
                .{' '}
              </Box>
              <Box component="br" hiddenFrom="sm" />
            </>
          )}
          {part}
        </Fragment>
      ))}
    </Text>
  );
}
