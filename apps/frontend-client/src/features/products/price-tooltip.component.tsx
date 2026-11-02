import { Card, Group, Text } from '@mantine/core';
import { useLocale } from 'frontend-shared';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { type ChartRowInterface, titleOf } from './chart-rows.type.js';
import { formatPrice } from './price-format.type.js';
import type { GranularityType } from './price-series.type.js';
import type { SeriesStyleInterface } from './series-style.type.js';

/** The price each line has at the point under the pointer: read in its bucket, or carried from before. */
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
  const title = titleOf(row.start, granularity, locale);

  return (
    <Card withBorder padding="xs" shadow="sm">
      <Text size="sm" fw={600}>
        {granularity === 'week' ? t('chart.weekTo', { date: title }) : title}
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
              {label}:{' '}
              {bucket.value === null
                ? t('chart.noPriceYet')
                : bucket.observed
                  ? formatPrice(bucket.value)
                  : t('chart.lastKnown', { price: formatPrice(bucket.value) })}
            </Text>
          </Group>
        );
      })}
    </Card>
  );
}
