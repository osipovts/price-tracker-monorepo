import { Card, Group, Text } from '@mantine/core';
import { useLocale } from 'frontend-shared';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { type ChartRowInterface, titleOf } from './chart-rows.type.js';
import { formatPrice } from './price-format.type.js';
import type { GranularityType } from './price-series.type.js';
import type { SeriesStyleInterface } from './series-style.type.js';

/** What each line of the chart has at the place under the pointer. */
export function PriceTooltip({
  row,
  granularity,
  series,
}: {
  row: ChartRowInterface;
  granularity: GranularityType;
  series: SeriesStyleInterface[];
}): ReactElement {
  const { t } = useTranslation();
  const locale = useLocale();

  return (
    <Card withBorder padding="xs" shadow="sm">
      <Text size="sm" fw={600}>
        {titleOf(row.start, granularity, locale)}
      </Text>
      {series.map(({ id, label, color }): ReactElement | null => {
        const bucket = row.cells[id]?.bucket;
        if (bucket === undefined) return null;

        return (
          <Group key={id} gap={6} wrap="nowrap" align="flex-start">
            <span
              style={{
                width: 10,
                height: 10,
                marginTop: 5,
                borderRadius: '50%',
                flexShrink: 0,
                background: `var(--mantine-color-${color}-6)`,
              }}
            />
            <Text size="sm">
              {label}: {bucket.value === null && t('chart.noPriceYet')}
              {bucket.value !== null &&
                !bucket.observed &&
                t('chart.lastKnown', { price: formatPrice(bucket.value) })}
              {bucket.observed &&
                bucket.average !== null &&
                bucket.min !== null &&
                bucket.max !== null &&
                t('chart.observed', {
                  average: formatPrice(bucket.average),
                  min: formatPrice(bucket.min),
                  max: formatPrice(bucket.max),
                })}
            </Text>
          </Group>
        );
      })}
    </Card>
  );
}
