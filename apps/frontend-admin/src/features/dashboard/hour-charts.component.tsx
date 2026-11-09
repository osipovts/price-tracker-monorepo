import { Box, Group, Paper, Stack, Text, useComputedColorScheme } from '@mantine/core';
import { marketplaceName, useLocale } from 'frontend-shared';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { chartColor, marketplaceChartColor } from '../../shared/chart-color.type.js';
import type { JobRowInterface, ReadRowInterface } from './hour-rows.type.js';

const chartHeight = 220;

/** A series of a chart: its name and its colour. */
interface SeriesInterface {
  key: string;
  label: string;
  color: string;
}

/** The mark of a series beside its name: the colour carries the identity, the text stays in the ink of text. */
function SeriesKey({ series }: { series: SeriesInterface }): ReactElement {
  return (
    <Group gap={6} wrap="nowrap">
      <Box w={10} h={10} bg={series.color} style={{ borderRadius: 2, flexShrink: 0 }} />
      <Text size="xs">{series.label}</Text>
    </Group>
  );
}

function ChartLegend({ series }: { series: SeriesInterface[] }): ReactElement {
  return (
    <Group gap="md" justify="center">
      {series.map((each): ReactElement => (
        <SeriesKey key={each.key} series={each} />
      ))}
    </Group>
  );
}

/** The hour under the pointer, with the value of each series in it. */
function HourTooltip({
  hour,
  series,
  values,
}: {
  hour: string;
  series: SeriesInterface[];
  values: Record<string, number>;
}): ReactElement {
  const locale = useLocale();
  const start = new Date(hour);
  const end = new Date(start.getTime() + 3_600_000);
  const time = (at: Date): string => at.toLocaleTimeString(locale, { timeStyle: 'short' });

  return (
    <Paper withBorder shadow="sm" p="xs">
      <Text size="xs" c="dimmed" mb={4}>
        {`${start.toLocaleDateString(locale, { day: 'numeric', month: 'short' })}, ${time(start)}-${time(end)}`}
      </Text>
      <Stack gap={2}>
        {series.map((each): ReactElement => (
          <Group key={each.key} justify="space-between" gap="lg" wrap="nowrap">
            <SeriesKey series={each} />
            <Text size="xs" fw={600} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {values[each.key] ?? 0}
            </Text>
          </Group>
        ))}
      </Stack>
    </Paper>
  );
}

/** The axes and the grid both charts share: recessive, the hours under the bars. */
function hourAxis(locale: string): ReactElement[] {
  return [
    <CartesianGrid
      key="grid"
      stroke="var(--mantine-color-default-border)"
      strokeDasharray="3 3"
      vertical={false}
    />,
    <XAxis
      key="x"
      dataKey="hour"
      tickFormatter={(hour: string): string =>
        new Date(hour).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
      }
      stroke="var(--mantine-color-dimmed)"
      tick={{ fontSize: 11 }}
      minTickGap={16}
    />,
    <YAxis
      key="y"
      allowDecimals={false}
      stroke="var(--mantine-color-dimmed)"
      tick={{ fontSize: 11 }}
      width={32}
    />,
  ];
}

/** The prices read in each hour of the last day, a segment for each marketplace. */
export function ReadsChart({
  rows,
  marketplaces,
}: {
  rows: ReadRowInterface[];
  marketplaces: readonly string[];
}): ReactElement {
  const locale = useLocale();
  const scheme = useComputedColorScheme('light');
  const series = marketplaces.map((marketplace): SeriesInterface => ({
    key: marketplace,
    label: marketplaceName(marketplace),
    color: marketplaceChartColor(marketplace, scheme),
  }));

  return (
    <Stack gap="xs">
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          {hourAxis(locale)}
          <Tooltip
            cursor={{ fill: 'var(--mantine-color-default-hover)' }}
            content={(props): ReactElement | null => {
              const row = rows.find(({ hour }): boolean => hour === props.label);

              return props.active && row !== undefined ? (
                <HourTooltip hour={row.hour} series={series} values={row.counts} />
              ) : null;
            }}
          />
          {series.map((each): ReactElement => (
            <Bar
              key={each.key}
              dataKey={(row: ReadRowInterface): number => row.counts[each.key] ?? 0}
              name={each.label}
              stackId="reads"
              fill={each.color}
              // The page shows between the segments: a gap of two pixels.
              stroke="var(--mantine-color-body)"
              strokeWidth={2}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <ChartLegend series={series} />
    </Stack>
  );
}

/** How the price jobs that ended in each hour of the last day ended: the failures in the colour of failure. */
export function JobsChart({ rows }: { rows: JobRowInterface[] }): ReactElement {
  const { t } = useTranslation();
  const locale = useLocale();
  const scheme = useComputedColorScheme('light');
  const series: SeriesInterface[] = [
    { key: 'completed', label: t('dashboard.completed'), color: chartColor('gray', scheme) },
    { key: 'failed', label: t('dashboard.failed'), color: chartColor('red', scheme) },
  ];

  return (
    <Stack gap="xs">
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          {hourAxis(locale)}
          <Tooltip
            cursor={{ fill: 'var(--mantine-color-default-hover)' }}
            content={(props): ReactElement | null => {
              const row = rows.find(({ hour }): boolean => hour === props.label);

              return props.active && row !== undefined ? (
                <HourTooltip
                  hour={row.hour}
                  series={series}
                  values={{ completed: row.completed, failed: row.failed }}
                />
              ) : null;
            }}
          />
          {series.map((each): ReactElement => (
            <Bar
              key={each.key}
              dataKey={each.key}
              name={each.label}
              stackId="jobs"
              fill={each.color}
              stroke="var(--mantine-color-body)"
              strokeWidth={2}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <ChartLegend series={series} />
    </Stack>
  );
}
