import { Group, Text } from '@mantine/core';
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

import {
  isRow,
  labelOf,
  paddedDomain,
  roundTicks,
  runKinds,
  runTurns,
  toRows,
} from './chart-rows.type.js';
import { formatPriceShort } from './price-format.type.js';
import type { GranularityType, PriceBucketInterface } from './price-series.type.js';
import { PriceTooltip } from './price-tooltip.component.js';
import type { SeriesStyleInterface } from './series-style.type.js';

export interface ChartLineInterface extends SeriesStyleInterface {
  buckets: PriceBucketInterface[];
}

/** The axis of prices: close around the lines with round marks inside, or the choice of the chart when there is no price. */
function priceAxis(
  lines: ChartLineInterface[],
): { domain: [number, number]; ticks: number[] } | { domain: ['auto', 'auto'] } {
  const domain = paddedDomain(lines.map(({ buckets }) => buckets));

  return domain[0] === 'auto'
    ? { domain: ['auto', 'auto'] }
    : { domain, ticks: roundTicks(domain, 8) };
}

/** The names of the lines in their colours, under the chart. */
function ChartLegend({ lines }: { lines: ChartLineInterface[] }): ReactElement {
  return (
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
  );
}

/**
 * The lines of a product: its solid and dashed runs, each kind on two lines that take turns, the dots of
 * the prices read, and the point under the pointer. Elements, not a component: the chart looks for its lines.
 */
function productLines({ id, color }: ChartLineInterface): ReactElement[] {
  const stroke = `var(--mantine-color-${color}-6)`;
  const runs = runKinds.flatMap((kind): ReactElement[] =>
    runTurns.map((turn): ReactElement => (
      <Line
        key={`${id}-${kind}-${String(turn)}`}
        dataKey={`values.${id}:${kind}:${String(turn)}`}
        stroke={stroke}
        strokeWidth={kind === 'solid' ? 2 : 1.5}
        {...(kind === 'dashed' ? { strokeDasharray: '6 4' } : {})}
        dot={false}
        activeDot={false}
        connectNulls={false}
        isAnimationActive={false}
        legendType="none"
      />
    )),
  );

  return [
    ...runs,
    // A dot is a price that was read in the bucket.
    <Line
      key={`${id}-read`}
      dataKey={`values.${id}:read`}
      stroke="none"
      dot={{ r: 2, fill: stroke, stroke }}
      activeDot={false}
      isAnimationActive={false}
      legendType="none"
    />,
    <Line
      key={`${id}-value`}
      dataKey={`values.${id}:value`}
      stroke="none"
      dot={false}
      activeDot={{ r: 4, fill: stroke, stroke }}
      isAnimationActive={false}
      legendType="none"
    />,
  ];
}

/** The prices of the products of a group, a line for each, on the same hours, days or weeks. */
export function PriceChart({
  granularity,
  lines,
}: {
  granularity: GranularityType;
  lines: ChartLineInterface[];
}): ReactElement {
  const locale = useLocale();
  const rows = toRows(lines);

  return (
    <ResponsiveContainer width="100%" height={560}>
      <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid
          stroke="var(--mantine-color-default-border)"
          strokeDasharray="3 3"
          vertical={false}
        />
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
          {...priceAxis(lines)}
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
        <Legend content={(): ReactElement => <ChartLegend lines={lines} />} />
        {lines.flatMap(productLines)}
      </LineChart>
    </ResponsiveContainer>
  );
}
