import {
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  MultiSelect,
  Pagination,
  Progress,
  SegmentedControl,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { ErrorAlert, marketplaceColor, marketplaceName, useLocale } from 'frontend-shared';
import { type ReactElement, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { jobStatusLabel } from '../jobs/job-status-label.type.js';
import {
  proxyPageSize,
  type ProxyPageType,
  proxySources,
  type ProxySourceType,
  useAddProxy,
  useDeleteAllProxies,
  useDeleteProxy,
  useProxies,
  useRefreshSources,
  useSetProxyDisabled,
} from './use-proxies.hook.js';

type ProxyItemType = ProxyPageType['items'][number];

type ProxyReputationType = ProxyItemType['reputations'][number];

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

type ChoiceType = 'all' | 'true' | 'false';

function toFilter(choice: ChoiceType): 'true' | 'false' | undefined {
  return choice === 'all' ? undefined : choice;
}

function isChoice(value: string): value is ChoiceType {
  return value === 'all' || value === 'true' || value === 'false';
}

function Choice({
  label,
  value,
  labels,
  onChange,
}: {
  label: string;
  value: ChoiceType;
  labels: [string, string];
  onChange: (value: ChoiceType) => void;
}): ReactElement {
  const { t } = useTranslation();

  return (
    <Stack gap={4}>
      <Text size="sm">{label}</Text>
      <SegmentedControl
        aria-label={label}
        value={value}
        data={[
          { value: 'all', label: t('common.all') },
          { value: 'true', label: labels[0] },
          { value: 'false', label: labels[1] },
        ]}
        onChange={(next): void => {
          if (isChoice(next)) onChange(next);
        }}
      />
    </Stack>
  );
}

function RefreshSource(): ReactElement {
  const { t } = useTranslation();
  const refresh = useRefreshSources();
  const [sources, setSources] = useState<readonly ProxySourceType[]>(proxySources);
  const running =
    refresh.jobIds.length > 0 && refresh.status !== 'completed' && refresh.status !== 'failed';

  return (
    <Stack gap={4}>
      <Group align="flex-end">
        <MultiSelect
          label={t('proxies.sources')}
          data={[...proxySources]}
          value={[...sources]}
          disabled={refresh.isStarting || running}
          onChange={(values): void => {
            setSources(proxySources.filter((source): boolean => values.includes(source)));
          }}
        />
        <Button
          disabled={sources.length === 0}
          loading={refresh.isStarting || running}
          onClick={(): void => {
            refresh.start(sources);
          }}
        >
          {t('proxies.refreshSource')}
        </Button>
        {refresh.status !== null && <Badge>{jobStatusLabel(refresh.status, t)}</Badge>}
      </Group>
      {running && refresh.percent !== null && (
        <Progress.Root size="xl" aria-label={t('proxies.refreshProgress')}>
          <Progress.Section value={refresh.percent}>
            <Progress.Label>{`${String(refresh.percent)}%`}</Progress.Label>
          </Progress.Section>
        </Progress.Root>
      )}
      {refresh.error !== null && <ErrorAlert error={refresh.error} />}
    </Stack>
  );
}

/** One proxy of the list, with the switch that turns it off and the button that deletes it. */
function ProxyRow({
  proxy,
  switching,
  onSwitch,
  onDelete,
}: {
  proxy: ProxyItemType;
  switching: boolean;
  onSwitch: (disabled: boolean) => void;
  onDelete: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const locale = useLocale();

  return (
    <Table.Tr>
      <Table.Td>{proxy.server}</Table.Td>
      <Table.Td>{proxy.source}</Table.Td>
      <Table.Td>{proxy.country ?? '-'}</Table.Td>
      <Table.Td>
        <Tooltip
          multiline
          w={260}
          label={proxy.alive ? t('proxies.aliveHint') : t('proxies.deadHint')}
        >
          <Badge color={proxy.alive ? 'green' : 'red'}>
            {proxy.alive ? t('proxies.alive') : t('proxies.dead')}
          </Badge>
        </Tooltip>
      </Table.Td>
      <Table.Td>
        {proxy.latencyMs === null ? '-' : t('proxies.milliseconds', { value: proxy.latencyMs })}
      </Table.Td>
      <Table.Td>
        {t('proxies.successOf', {
          percent: Math.round(proxy.successRate * 100),
          checks: proxy.checksTotal,
        })}
      </Table.Td>
      <Table.Td>
        <ProxyReputations reputations={proxy.reputations} />
      </Table.Td>
      <Table.Td>{new Date(proxy.lastCheckedAt).toLocaleString(locale)}</Table.Td>
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
      <Table.Td>
        <Button size="xs" color="red" variant="light" onClick={onDelete}>
          {t('proxies.delete')}
        </Button>
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

/** Asks to confirm, then runs `confirm`; the dialog closes when it succeeds. */
function ConfirmDialog({
  opened,
  title,
  text,
  action,
  error,
  pending,
  onConfirm,
  onClose,
}: {
  opened: boolean;
  title: string;
  text: string;
  action: string;
  error: Error | null;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}): ReactElement {
  return (
    <Modal opened={opened} title={title} onClose={onClose}>
      <Stack>
        <Text>{text}</Text>
        {error !== null && <ErrorAlert error={error} />}
        <Button color="red" loading={pending} onClick={onConfirm}>
          {action}
        </Button>
      </Stack>
    </Modal>
  );
}

export function ProxiesPage(): ReactElement {
  const { t } = useTranslation();
  const [alive, setAlive] = useState<ChoiceType>('all');
  const [disabled, setDisabled] = useState<ChoiceType>('all');
  const [page, setPage] = useState(1);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const proxies = useProxies({
    alive: toFilter(alive),
    disabled: toFilter(disabled),
    page,
  });
  const setProxyDisabled = useSetProxyDisabled();
  const deleteProxy = useDeleteProxy();
  const deleteAllProxies = useDeleteAllProxies();
  const data = proxies.data;
  const lastPage = Math.max(1, Math.ceil((data?.total ?? 0) / proxyPageSize));

  // The last proxy of the last page is gone: the page goes with it.
  useEffect((): void => {
    if (data !== undefined && page > lastPage) setPage(lastPage);
  }, [data, page, lastPage]);

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <Title order={2}>{t('proxies.title')}</Title>
        <Group align="flex-start">
          <Button
            variant="light"
            onClick={(): void => {
              setAdding(true);
            }}
          >
            {t('proxies.add')}
          </Button>
          <Button
            color="red"
            variant="light"
            onClick={(): void => {
              setDeletingAll(true);
            }}
          >
            {t('proxies.deleteAll')}
          </Button>
          <RefreshSource />
        </Group>
      </Group>
      <Group>
        <Choice
          label={t('proxies.filterAlive')}
          value={alive}
          labels={[t('proxies.filterAliveYes'), t('proxies.filterAliveNo')]}
          onChange={(next): void => {
            setAlive(next);
            setPage(1);
          }}
        />
        <Choice
          label={t('proxies.filterOff')}
          value={disabled}
          labels={[t('proxies.filterOffYes'), t('proxies.filterOffNo')]}
          onChange={(next): void => {
            setDisabled(next);
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
          <Table.ScrollContainer minWidth={900}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('proxies.server')}</Table.Th>
                  <Table.Th>{t('proxies.source')}</Table.Th>
                  <Table.Th>{t('proxies.country')}</Table.Th>
                  <Table.Th>{t('proxies.status')}</Table.Th>
                  <Table.Th>{t('proxies.latency')}</Table.Th>
                  <Table.Th>{t('proxies.success')}</Table.Th>
                  <Table.Th>{t('proxies.reputation')}</Table.Th>
                  <Table.Th>{t('proxies.checked')}</Table.Th>
                  <Table.Th>{t('proxies.enabled')}</Table.Th>
                  <Table.Th />
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
                    onDelete={(): void => {
                      deleteProxy.reset();
                      setDeleting(proxy.server);
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
      <AddProxyDialog
        opened={adding}
        onClose={(): void => {
          setAdding(false);
        }}
      />
      <ConfirmDialog
        opened={deleting !== null}
        title={t('proxies.deleteTitle')}
        text={t('proxies.deleteText', { server: deleting ?? '' })}
        action={t('proxies.delete')}
        error={deleteProxy.error}
        pending={deleteProxy.isPending}
        onConfirm={(): void => {
          if (deleting === null) return;

          deleteProxy.mutate(deleting, {
            onSuccess: (): void => {
              setDeleting(null);
            },
          });
        }}
        onClose={(): void => {
          setDeleting(null);
        }}
      />
      <ConfirmDialog
        opened={deletingAll}
        title={t('proxies.deleteAllTitle')}
        text={t('proxies.deleteAllText')}
        action={t('proxies.deleteAll')}
        error={deleteAllProxies.error}
        pending={deleteAllProxies.isPending}
        onConfirm={(): void => {
          deleteAllProxies.mutate(undefined, {
            onSuccess: (): void => {
              setDeletingAll(false);
            },
          });
        }}
        onClose={(): void => {
          setDeletingAll(false);
        }}
      />
    </Stack>
  );
}
