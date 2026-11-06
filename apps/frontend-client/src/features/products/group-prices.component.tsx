import { Text, type TextProps } from '@mantine/core';
import { useLocale } from 'frontend-shared';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { formatDayMoment } from './moment-format.type.js';
import { formatPrice } from './price-format.type.js';
import type { ProductGroupType } from './use-product-groups.hook.js';

/** The best price of the group: the cheapest of the newest reads of its products that are in stock; when it was read, in the hint. */
export function BestPrice({
  group,
  ...props
}: { group: ProductGroupType } & TextProps): ReactElement {
  const { t } = useTranslation();
  const locale = useLocale();

  if (group.current === null) {
    return (
      <Text c="dimmed" {...props} fw={400}>
        {t('products.noPrice')}
      </Text>
    );
  }

  return (
    <Text
      fw={700}
      title={t('groups.priceReceived', {
        when: formatDayMoment(group.current.observedAt, t, locale),
      })}
      style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
      {...props}
    >
      {formatPrice(group.current.amountMinor)}
    </Text>
  );
}
