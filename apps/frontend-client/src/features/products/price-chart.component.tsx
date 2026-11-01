import { Card, Group, Text, Title } from '@mantine/core';
import { useLocale } from 'frontend-shared';
import type { ReactElement } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { isRow, labelOf, paddedDomain, toRows } from './chart-rows.type.js';
import { formatPriceShort } from './price-format.type.js';
import type { GranularityType, PriceBucketInterface } from './price-series.type.js';
import { PriceTooltip } from './price-tooltip.component.js';
import type { SeriesStyleInterface } from './series-style.type.js';

export interface ChartLineInterface extends SeriesStyleInterface {
  buckets: PriceBucketInterface[];
}

/** The prices of the products of a group, a line for each, on the same hours or days. */
export function PriceChart({
  title,
  granularity,
  lines,
}: {
  title: string;
  granularity: GranularityType;
  lines: ChartLineInterface[];
}): ReactElement {
  const locale = useLocale();
  const rows = toRows(lines);

  return (
    <Card withBorder>
      <Title order={4} mb="xs">
        {title}
      </Title>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--mantine-color-default-border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="key"
            tickFormatter={(key: string): string => labelOf(new Date(key), granularity, locale)}
            stroke="var(--mantine-color-dimmed)"
            tick={{ fontSize: 12 }}
            minTickGap={24}
          />
          <YAxis
            stroke="var(--mantine-color-dimmed)"
            tick={{ fontSize: 12 }}
            width={72}
            domain={paddedDomain(lines.map(({ buckets }) => buckets))}
            tickFormatter={(value: number): string => formatPriceShort(value)}
          />
          <Tooltip
            content={(props): ReactElement | null => {
              const row: unknown = props.payload[0]?.payload;

              return props.active && isRow(row) ? (
                <PriceTooltip row={row} granularity={granularity} series={lines} />
              ) : null;
            }}
          />
          <Legend
            content={(): ReactElement => (
              <Group justify="center" gap="md" mt={4}>
                {lines.map(({ id, label, color }) => (
                  <Group key={id} gap={6}>
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: `var(--mantine-color-${color}-6)`,
                      }}
                    />
                    <Text size="xs">{label}</Text>
                  </Group>
                ))}
              </Group>
            )}
          />
          {lines.flatMap(({ id, color }): ReactElement[] => [
            <Line
              key={`${id}-dashed`}
              dataKey={`values.${id}:dashed`}
              stroke={`var(--mantine-color-${color}-6)`}
              strokeDasharray="6 4"
              dot={false}
              activeDot={false}
              connectNulls={false}
              isAnimationActive={false}
              legendType="none"
            />,
            <Line
              key={`${id}-solid`}
              dataKey={`values.${id}:solid`}
              stroke={`var(--mantine-color-${color}-6)`}
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls={false}
              isAnimationActive={false}
              legendType="none"
            />,
          ])}
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}
