import {
  Anchor,
  Badge,
  Card,
  Grid,
  Group,
  Loader,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { ErrorAlert, MarketplaceName, useLocale } from 'frontend-shared';
import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { alarmColor } from '../../shared/alarm-color.type.js';
import { formatMoment } from '../../shared/format.type.js';
import { JobSubject } from '../jobs/job-status.component.js';
import { jobKindLabel } from '../jobs/job-status-label.type.js';
import { useJobRecords } from '../jobs/use-job-records.hook.js';
import { JobsChart, ReadsChart } from './hour-charts.component.js';
import { jobRows, readRows } from './hour-rows.type.js';
import { type DashboardType, useDashboard } from './use-dashboard.hook.js';

/** A figure that is the point by itself: its name, the number, and what stands behind it. */
function Stat({
  title,
  value,
  note,
  extra,
}: {
  title: string;
  value: string;
  note: string;
  extra?: ReactNode;
}): ReactElement {
  return (
    <Card withBorder>
      <Text size="sm" c="dimmed">
        {title}
      </Text>
      <Group gap="xs" align="baseline">
        <Title order={2} style={{ fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </Title>
        {extra}
      </Group>
      <Text size="xs" c="dimmed">
        {note}
      </Text>
    </Card>
  );
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value): number => total + value, 0);
}

/** The figures that tell at once whether the prices are read: the reads, the stale prices, the queue, the proxies, the users. */
function Stats({ data }: { data: DashboardType }): ReactElement {
  const { t } = useTranslation();
  const { products, proxies, jobs, users } = data;
  const reads = sum(products.marketplaces.map(({ readsLastDay }) => readsLastDay));
  const priceJobs = jobs.lastDay.find(({ kind }): boolean => kind === 'price_fetch');
  const ended = (priceJobs?.completed ?? 0) + (priceJobs?.failed ?? 0);
  const { unfinished } = jobs;

  return (
    <SimpleGrid cols={{ base: 1, xs: 2, lg: 5 }}>
      <Stat
        title={t('dashboard.reads')}
        value={String(reads)}
        note={
          ended === 0
            ? t('dashboard.readsNoteNone')
            : t('dashboard.readsNote', {
                percent: Math.round(((priceJobs?.completed ?? 0) / ended) * 100),
              })
        }
      />
      <Stat
        title={t('dashboard.stale')}
        value={String(sum(products.marketplaces.map(({ stale }) => stale)))}
        note={t('dashboard.staleNote', {
          hours: Math.round(products.staleAfterMs / 3_600_000),
          unread: sum(products.marketplaces.map(({ unread }) => unread)),
        })}
      />
      <Stat
        title={t('dashboard.queue')}
        value={String(unfinished.running + unfinished.queued + unfinished.retrying)}
        note={t('dashboard.queueNote', unfinished)}
        extra={
          unfinished.lost > 0 && (
            <Tooltip multiline w={280} label={t('dashboard.lostHint')}>
              <Badge color="orange" variant="light">
                {t('dashboard.lost', { count: unfinished.lost })}
              </Badge>
            </Tooltip>
          )
        }
      />
      <Stat
        title={t('dashboard.proxies')}
        value={`${String(proxies.alive)} / ${String(proxies.total)}`}
        note={t('dashboard.proxiesNote', { disabled: proxies.disabled })}
      />
      <Stat
        title={t('dashboard.users')}
        value={String(users.total)}
        note={t('dashboard.usersNote', {
          verified: users.verified,
          joined: users.joinedLastDay,
          groups: products.groups,
        })}
      />
    </SimpleGrid>
  );
}

function ChartCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}): ReactElement {
  return (
    <Card withBorder>
      <Stack gap="xs">
        <Stack gap={0}>
          <Title order={4}>{title}</Title>
          <Text size="xs" c="dimmed">
            {hint}
          </Text>
        </Stack>
        {children}
      </Stack>
    </Card>
  );
}

/** How the prices of each marketplace are read, with the proxies its reads may take now: the table of the chart. */
function Marketplaces({ data }: { data: DashboardType }): ReactElement {
  const { t } = useTranslation();
  const locale = useLocale();

  return (
    <Card withBorder>
      <Title order={4} mb="xs">
        {t('dashboard.marketplaces')}
      </Title>
      <Table.ScrollContainer minWidth={640}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('dashboard.marketplace')}</Table.Th>
              <Table.Th>{t('dashboard.products')}</Table.Th>
              <Table.Th>{t('dashboard.readsLastDay')}</Table.Th>
              <Table.Th>{t('dashboard.lastRead')}</Table.Th>
              <Table.Th>{t('dashboard.staleCount')}</Table.Th>
              <Table.Th>{t('dashboard.unread')}</Table.Th>
              <Table.Th>
                <Tooltip multiline w={280} label={t('dashboard.usableHint')}>
                  <span>{t('dashboard.usable')}</span>
                </Tooltip>
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {data.products.marketplaces.map((reads): ReactElement => {
              const usable = data.proxies.usable.find(
                ({ marketplace }): boolean => marketplace === reads.marketplace,
              );

              return (
                <Table.Tr key={reads.marketplace}>
                  <Table.Td>
                    <MarketplaceName marketplace={reads.marketplace} size="sm" />
                  </Table.Td>
                  <Table.Td>{reads.products}</Table.Td>
                  <Table.Td>{reads.readsLastDay}</Table.Td>
                  <Table.Td>{formatMoment(reads.lastReadAt, locale)}</Table.Td>
                  <Table.Td {...alarmColor(reads.stale > 0, 'orange')}>{reads.stale}</Table.Td>
                  <Table.Td>{reads.unread}</Table.Td>
                  <Table.Td {...alarmColor(usable?.count === 0, 'red')}>
                    {usable?.count ?? '-'}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Card>
  );
}

/** The jobs of the last day of each kind, by how far they are. */
function JobKinds({ data }: { data: DashboardType }): ReactElement {
  const { t } = useTranslation();

  return (
    <Card withBorder>
      <Title order={4} mb="xs">
        {t('dashboard.jobKinds')}
      </Title>
      <Table.ScrollContainer minWidth={480}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('dashboard.kind')}</Table.Th>
              <Table.Th>{t('jobs.status.queued')}</Table.Th>
              <Table.Th>{t('jobs.status.running')}</Table.Th>
              <Table.Th>{t('jobs.status.retrying')}</Table.Th>
              <Table.Th>{t('jobs.status.completed')}</Table.Th>
              <Table.Th>{t('jobs.status.failed')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {data.jobs.lastDay.map((counts): ReactElement => (
              <Table.Tr key={counts.kind}>
                <Table.Td>{jobKindLabel(counts.kind, t)}</Table.Td>
                <Table.Td>{counts.queued}</Table.Td>
                <Table.Td>{counts.running}</Table.Td>
                <Table.Td>{counts.retrying}</Table.Td>
                <Table.Td>{counts.completed}</Table.Td>
                <Table.Td {...alarmColor(counts.failed > 0, 'red')}>{counts.failed}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Card>
  );
}

/** The latest jobs that failed for good, with what they were about and why; the jobs page has all of them. */
function RecentFailures(): ReactElement {
  const { t } = useTranslation();
  const locale = useLocale();
  const failures = useJobRecords({ state: 'failed', page: 1, pageSize: 5 }, 30_000);
  const items = failures.data?.items;

  return (
    <Card withBorder>
      <Group justify="space-between" mb="xs">
        <Title order={4}>{t('dashboard.failuresTitle')}</Title>
        <Anchor component={Link} to="/jobs?state=failed" size="sm">
          {t('dashboard.allFailures')}
        </Anchor>
      </Group>
      {failures.isError && <ErrorAlert error={failures.error} />}
      {items === undefined ? (
        !failures.isError && <Loader size="sm" />
      ) : items.length === 0 ? (
        <Text c="dimmed">{t('dashboard.none')}</Text>
      ) : (
        <Table.ScrollContainer minWidth={560}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('dashboard.subject')}</Table.Th>
                <Table.Th>{t('dashboard.error')}</Table.Th>
                <Table.Th>{t('dashboard.finished')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((job): ReactElement => (
                <Table.Tr key={job.id}>
                  <Table.Td maw={260}>
                    <Stack gap={0}>
                      <Text size="xs" c="dimmed">
                        {jobKindLabel(job.kind, t)}
                      </Text>
                      <JobSubject job={job} />
                    </Stack>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="red" lineClamp={2} title={job.error ?? ''}>
                      {job.error ?? '-'}
                    </Text>
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>
                    {formatMoment(job.finishedAt, locale)}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Card>
  );
}

export function DashboardPage(): ReactElement {
  const { t } = useTranslation();
  const locale = useLocale();
  const dashboard = useDashboard();
  const data = dashboard.data;

  if (dashboard.isError) return <ErrorAlert error={dashboard.error} />;
  if (data === undefined) return <Loader />;

  const now = new Date(data.generatedAt).getTime();

  return (
    <Stack>
      <Group justify="space-between" align="baseline">
        <Title order={2}>{t('dashboard.title')}</Title>
        <Text size="xs" c="dimmed">
          {t('dashboard.updated', { when: formatMoment(data.generatedAt, locale) })}
        </Text>
      </Group>
      <Stats data={data} />
      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <ChartCard title={t('dashboard.readsByHour')} hint={t('dashboard.readsByHourHint')}>
          <ReadsChart
            rows={readRows(data.products.readsByHour, now)}
            marketplaces={data.products.marketplaces.map(({ marketplace }) => marketplace)}
          />
        </ChartCard>
        <ChartCard title={t('dashboard.jobsByHour')} hint={t('dashboard.jobsByHourHint')}>
          <JobsChart rows={jobRows(data.jobs.priceJobsByHour, now)} />
        </ChartCard>
      </SimpleGrid>
      <Marketplaces data={data} />
      <Grid>
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <JobKinds data={data} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <RecentFailures />
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
