import {
  Badge,
  Button,
  Card,
  Code,
  Group,
  Loader,
  Modal,
  Pagination,
  Progress,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  ErrorAlert,
  marketplaceColor,
  MarketplaceName,
  marketplaceName,
  useLocale,
} from 'frontend-shared';
import { type ReactElement, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { alarmColor } from '../../shared/alarm-color.type.js';
import { formatMoment } from '../../shared/format.type.js';
import { JobStatusBadge } from '../jobs/job-status.component.js';
import { isActive, type JobRecordType } from '../jobs/use-job-records.hook.js';
import {
  manualSource,
  type ProxyListSourceType,
  proxyPageSize,
  type ProxyPageType,
  proxySources,
  type ProxySourceType,
  type ProxyStatsType,
  proxyStatuses,
  type ProxyStatusType,
  useAddProxy,
  useProxies,
  useProxyStats,
  useSetProxyDisabled,
  useSourceRefreshes,
} from './use-proxies.hook.js';

type ProxyItemType = ProxyPageType['items'][number];

type ProxyReputationType = ProxyItemType['reputations'][number];

function isProxyStatus(value: string): value is ProxyStatusType {
  return proxyStatuses.some((status): boolean => status === value);
}

function isRefreshable(source: string): source is ProxySourceType {
  return proxySources.some((each): boolean => each === source);
}

function isListSource(source: string | null): source is ProxyListSourceType {
  return source === manualSource || (source !== null && isRefreshable(source));
}

/** The time until which the proxy is not given for the marketplace; null when it does not rest. */
function restingUntil(reputation: ProxyReputationType, now: number): Date | null {
  const until = reputation.cooldownUntil === null ? null : new Date(reputation.cooldownUntil);

  return until !== null && until.getTime() > now ? until : null;
}

/** How the proxy has done reading each marketplace, with what the workers last found in the hint. */
function ProxyReputations({
  reputations,
}: {
  reputations: ProxyItemType['reputations'];
}): ReactElement {
  const { t } = useTranslation();
  const locale = useLocale();
  if (reputations.length === 0) return <>-</>;

  const now = Date.now();
  const amount = (value: number): string =>
    value.toLocaleString(locale, { maximumFractionDigits: 1 });

  return (
    <Group gap={4}>
      {reputations.map((reputation): ReactElement => {
        const counts = {
          successes: amount(reputation.successes),
          failures: amount(reputation.failures),
        };
        const hint = t('proxies.reputationHint', {
          ...counts,
          streak: reputation.failureStreak,
          outcome: t(`proxies.outcome.${reputation.lastOutcome}`),
          when: new Date(reputation.lastAttemptAt).toLocaleString(locale),
        });
        const until = restingUntil(reputation, now);
        const resting =
          until === null
            ? ''
            : ` ${t('proxies.reputationRest', { until: until.toLocaleString(locale) })}`;

        return (
          <Tooltip key={reputation.marketplace} multiline w={300} label={`${hint}${resting}`}>
            <Badge
              color={marketplaceColor(reputation.marketplace)}
              variant={until === null ? 'light' : 'outline'}
            >
              {t('proxies.reputationOf', {
                marketplace: marketplaceName(reputation.marketplace),
                ...counts,
              })}
            </Badge>
          </Tooltip>
        );
      })}
    </Group>
  );
}

/** How many proxies there are, and how many a read of each marketplace may be given now. */
function ProxyFigures({ stats }: { stats: ProxyStatsType }): ReactElement {
  const { t } = useTranslation();

  return (
    <SimpleGrid cols={{ base: 1, sm: 2 }}>
      <Card withBorder>
        <Text size="sm" c="dimmed">
          {t('proxies.total')}
        </Text>
        <Title order={2}>{stats.total}</Title>
        <Text size="xs" c="dimmed">
          {t('proxies.totalNote', { alive: stats.alive, disabled: stats.disabled })}
        </Text>
      </Card>
      <Card withBorder>
        <Tooltip multiline w={300} label={t('proxies.usableHint')}>
          <Text size="sm" c="dimmed" w="fit-content">
            {t('proxies.usable')}
          </Text>
        </Tooltip>
        <Group gap="lg" mt={6}>
          {stats.usable.map(({ marketplace, count }): ReactElement => (
            <Stack key={marketplace} gap={0}>
              <Title order={3} {...alarmColor(count === 0, 'red')}>
                {count}
              </Title>
              <MarketplaceName marketplace={marketplace} />
            </Stack>
          ))}
        </Group>
      </Card>
    </SimpleGrid>
  );
}

/** The last refresh of a source: how far it is while it runs, else how it ended and what it found. */
function RefreshState({ job }: { job: JobRecordType | undefined }): ReactElement {
  const { t } = useTranslation();
  const locale = useLocale();
  if (job === undefined) {
    return (
      <Text size="sm" c="dimmed">
        {t('proxies.neverRefreshed')}
      </Text>
    );
  }

  const found = t('proxies.found', { succeeded: job.succeeded, processed: job.processed });

  return (
    <Stack gap={4} miw={200}>
      <Group gap="xs">
        <JobStatusBadge job={job} />
        <Text size="xs" c="dimmed">
          {formatMoment(job.finishedAt ?? job.startedAt ?? job.createdAt, locale)}
        </Text>
      </Group>
      {isActive(job) && (
        <Progress
          value={job.percent}
          size="sm"
          animated
          aria-label={t('proxies.refreshProgress', { source: job.subject })}
        />
      )}
      <Text size="xs" c={job.status === 'failed' ? 'red' : 'dimmed'} lineClamp={2}>
        {job.status === 'failed' && job.error !== null ? job.error : found}
      </Text>
    </Stack>
  );
}

/** The sources: what each gave, and its last refresh, which the button runs again. */
function ProxySources({ stats }: { stats: ProxyStatsType | undefined }): ReactElement {
  const { t } = useTranslation();
  const refreshes = useSourceRefreshes();
  const known = stats?.bySource ?? [];
  const sources = [
    ...proxySources,
    ...known
      .map(({ source }): string => source)
      .filter((source): boolean => !isRefreshable(source)),
  ];
  const running = (source: ProxySourceType): boolean => {
    const job = refreshes.latest.get(source);

    return refreshes.starting.includes(source) || (job !== undefined && isActive(job));
  };
  const idle = proxySources.filter((source): boolean => !running(source));

  return (
    <Card withBorder>
      <Group justify="space-between" mb="sm">
        <Title order={4}>{t('proxies.sources')}</Title>
        <Button
          size="xs"
          disabled={idle.length === 0}
          onClick={(): void => {
            refreshes.start(idle);
          }}
        >
          {t('proxies.refreshAll')}
        </Button>
      </Group>
      {refreshes.error !== null && <ErrorAlert error={refreshes.error} />}
      <Table.ScrollContainer minWidth={700}>
        <Table verticalSpacing="sm" aria-label={t('proxies.sources')}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('proxies.source')}</Table.Th>
              <Table.Th>{t('proxies.total')}</Table.Th>
              <Table.Th>{t('proxies.alive')}</Table.Th>
              <Table.Th>{t('proxies.disabled')}</Table.Th>
              <Table.Th>{t('proxies.lastRefresh')}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {sources.map((source): ReactElement => {
              const counts = known.find((each): boolean => each.source === source);

              return (
                <Table.Tr key={source}>
                  <Table.Td>
                    <Text size="sm" fw={500}>
                      {source === manualSource ? t('proxies.manual') : source}
                    </Text>
                  </Table.Td>
                  <Table.Td>{counts?.total ?? 0}</Table.Td>
                  <Table.Td>{counts?.alive ?? 0}</Table.Td>
                  <Table.Td>{counts?.disabled ?? 0}</Table.Td>
                  <Table.Td>
                    {isRefreshable(source) ? (
                      <RefreshState job={refreshes.latest.get(source)} />
                    ) : (
                      '-'
                    )}
                  </Table.Td>
                  <Table.Td>
                    {isRefreshable(source) && (
                      <Button
                        size="xs"
                        variant="light"
                        aria-label={`${t('proxies.refresh')} ${source}`}
                        loading={running(source)}
                        onClick={(): void => {
                          refreshes.start([source]);
                        }}
                      >
                        {t('proxies.refresh')}
                      </Button>
                    )}
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

/** One proxy of the list, with the switch that turns it off. */
function ProxyRow({
  proxy,
  switching,
  onSwitch,
}: {
  proxy: ProxyItemType;
  switching: boolean;
  onSwitch: (disabled: boolean) => void;
}): ReactElement {
  const { t } = useTranslation();
  const locale = useLocale();

  return (
    <Table.Tr>
      <Table.Td>
        <Code>{proxy.server}</Code>
      </Table.Td>
      <Table.Td>{proxy.source === manualSource ? t('proxies.manual') : proxy.source}</Table.Td>
      <Table.Td>{proxy.country ?? '-'}</Table.Td>
      <Table.Td>
        <Tooltip
          multiline
          w={260}
          label={proxy.alive ? t('proxies.aliveHint') : t('proxies.deadHint')}
        >
          <Badge color={proxy.alive ? 'green' : 'red'} variant="light">
            {proxy.alive ? t('proxies.aliveBadge') : t('proxies.dead')}
          </Badge>
        </Tooltip>
      </Table.Td>
      <Table.Td style={{ whiteSpace: 'nowrap' }}>
        {proxy.latencyMs === null ? '-' : t('proxies.milliseconds', { value: proxy.latencyMs })}
      </Table.Td>
      <Table.Td style={{ whiteSpace: 'nowrap' }}>
        {t('proxies.successOf', {
          percent: Math.round(proxy.successRate * 100),
          checks: proxy.checksTotal,
        })}
      </Table.Td>
      <Table.Td>
        <ProxyReputations reputations={proxy.reputations} />
      </Table.Td>
      <Table.Td style={{ whiteSpace: 'nowrap' }}>
        {formatMoment(proxy.lastCheckedAt, locale)}
      </Table.Td>
      <Table.Td>
        <Switch
          aria-label={t('proxies.enabledOf', { server: proxy.server })}
          checked={!proxy.disabled}
          disabled={switching}
          onChange={(event): void => {
            onSwitch(!event.currentTarget.checked);
          }}
        />
      </Table.Td>
    </Table.Tr>
  );
}

/** The dialog that takes the address of a proxy by hand. */
function AddProxyDialog({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const [address, setAddress] = useState('');
  const addProxy = useAddProxy();

  const close = (): void => {
    setAddress('');
    addProxy.reset();
    onClose();
  };

  return (
    <Modal opened={opened} title={t('proxies.addTitle')} onClose={close}>
      <form
        onSubmit={(event): void => {
          event.preventDefault();
          addProxy.mutate(address.trim(), { onSuccess: close });
        }}
      >
        <Stack>
          <TextInput
            label={t('proxies.addAddress')}
            description={t('proxies.addHint')}
            placeholder="http://user:password@203.0.113.10:3128"
            value={address}
            autoComplete="off"
            data-autofocus
            onChange={(event): void => {
              setAddress(event.currentTarget.value);
            }}
          />
          {addProxy.error !== null && <ErrorAlert error={addProxy.error} />}
          <Button type="submit" disabled={address.trim() === ''} loading={addProxy.isPending}>
            {t('proxies.add')}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}

/** The proxies themselves: the filters, the table and its pages. */
function ProxyList({ sources }: { sources: readonly string[] }): ReactElement {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ProxyStatusType>('all');
  const [source, setSource] = useState<ProxyListSourceType | null>(null);
  const [page, setPage] = useState(1);
  const proxies = useProxies({ status, source, page });
  const setProxyDisabled = useSetProxyDisabled();
  const data = proxies.data;
  const lastPage = Math.max(1, Math.ceil((data?.total ?? 0) / proxyPageSize));

  // A proxy turned off leaves the list of the working ones, and the last page may go with it.
  useEffect((): void => {
    if (data !== undefined && page > lastPage) setPage(lastPage);
  }, [data, page, lastPage]);

  return (
    <Card withBorder>
      <Stack>
        <Group align="flex-end">
          <SegmentedControl
            aria-label={t('proxies.filterStatus')}
            value={status}
            data={proxyStatuses.map((each): { value: string; label: string } => ({
              value: each,
              label: t(`proxies.status.${each}`),
            }))}
            onChange={(next): void => {
              if (isProxyStatus(next)) setStatus(next);
              setPage(1);
            }}
          />
          <Select
            aria-label={t('proxies.filterSource')}
            w={220}
            value={source ?? 'all'}
            allowDeselect={false}
            data={[
              { value: 'all', label: t('proxies.allSources') },
              ...sources.map((each): { value: string; label: string } => ({
                value: each,
                label: each === manualSource ? t('proxies.manual') : each,
              })),
            ]}
            onChange={(next): void => {
              setSource(isListSource(next) ? next : null);
              setPage(1);
            }}
          />
        </Group>
        {proxies.isError && <ErrorAlert error={proxies.error} />}
        {setProxyDisabled.error !== null && <ErrorAlert error={setProxyDisabled.error} />}
        {data === undefined ? (
          !proxies.isError && <Loader />
        ) : (
          <>
            <Table.ScrollContainer minWidth={1000}>
              <Table verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('proxies.server')}</Table.Th>
                    <Table.Th>{t('proxies.source')}</Table.Th>
                    <Table.Th>{t('proxies.country')}</Table.Th>
                    <Table.Th>{t('proxies.statusColumn')}</Table.Th>
                    <Table.Th>{t('proxies.latency')}</Table.Th>
                    <Table.Th>{t('proxies.success')}</Table.Th>
                    <Table.Th>{t('proxies.reputation')}</Table.Th>
                    <Table.Th>{t('proxies.checked')}</Table.Th>
                    <Table.Th>{t('proxies.enabled')}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.items.map((proxy): ReactElement => (
                    <ProxyRow
                      key={proxy.server}
                      proxy={proxy}
                      switching={setProxyDisabled.isPending}
                      onSwitch={(off): void => {
                        setProxyDisabled.mutate({ server: proxy.server, disabled: off });
                      }}
                    />
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            {data.items.length === 0 && <Text c="dimmed">{t('proxies.noMatch')}</Text>}
            {data.total > proxyPageSize && (
              <Pagination total={lastPage} value={page} onChange={setPage} />
            )}
          </>
        )}
      </Stack>
    </Card>
  );
}

export function ProxiesPage(): ReactElement {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const stats = useProxyStats();

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <Stack gap={2}>
          <Title order={2}>{t('proxies.title')}</Title>
          <Text size="sm" c="dimmed">
            {t('proxies.hint')}
          </Text>
        </Stack>
        <Button
          variant="light"
          onClick={(): void => {
            setAdding(true);
          }}
        >
          {t('proxies.add')}
        </Button>
      </Group>
      {stats.isError && <ErrorAlert error={stats.error} />}
      {stats.data !== undefined && <ProxyFigures stats={stats.data} />}
      <ProxySources stats={stats.data} />
      <ProxyList sources={[...proxySources, manualSource]} />
      <AddProxyDialog
        opened={adding}
        onClose={(): void => {
          setAdding(false);
        }}
      />
    </Stack>
  );
}
