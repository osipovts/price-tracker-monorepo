import {
  useMutation,
  type UseMutationResult,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { ensure } from 'frontend-shared';
import { useEffect, useRef } from 'react';

import { api } from '../../shared/api/api.client.js';
import type { operations } from '../../shared/api/schema.js';
import { type JobRecordType, useJobRecords } from '../jobs/use-job-records.hook.js';
import { activeJobIds, hasEnded, latestJobsBySource } from './proxy-refresh.type.js';

export type ProxyPageType =
  operations['ProxiesController_list']['responses'][200]['content']['application/json'];
export type ProxyStatsType =
  operations['ProxiesController_stats']['responses'][200]['content']['application/json'];
export type ProxySourceType =
  operations['ProxySourcesController_refresh']['parameters']['path']['source'];
export type ProxyListSourceType = NonNullable<
  NonNullable<operations['ProxiesController_list']['parameters']['query']>['source']
>;

/** The sources the hub reads proxies from, in the order the panel lists them. */
export const proxySources: readonly ProxySourceType[] = [
  'proxifly',
  'geonode',
  'proxyscrape',
  'monosans',
  'github-free-proxy-list',
];

/** The source of the proxies added by hand. */
export const manualSource = 'manual';

/** What the list shows: the working ones (alive and on), the dead, the ones turned off, or all. */
export const proxyStatuses = ['all', 'working', 'dead', 'off'] as const;

export type ProxyStatusType = (typeof proxyStatuses)[number];

export interface ProxyFilterInterface {
  status: ProxyStatusType;
  source: ProxyListSourceType | null;
  page: number;
}

export const proxyPageSize = 20;

/** The query of the hub for the status asked for. */
function statusQuery(status: ProxyStatusType): {
  alive?: 'true' | 'false';
  disabled?: 'true' | 'false';
} {
  switch (status) {
    case 'working':
      return { alive: 'true', disabled: 'false' };
    case 'dead':
      return { alive: 'false' };
    case 'off':
      return { disabled: 'true' };
    case 'all':
      return {};
  }
}

export function useProxies(
  filter: ProxyFilterInterface,
): UseQueryResult<ProxyPageType | undefined> {
  return useQuery({
    queryKey: ['proxies', filter],
    queryFn: async (): Promise<ProxyPageType | undefined> =>
      ensure(
        await api.GET('/proxies', {
          params: {
            query: {
              page: filter.page,
              pageSize: proxyPageSize,
              ...statusQuery(filter.status),
              ...(filter.source === null ? {} : { source: filter.source }),
            },
          },
        }),
      ),
    placeholderData: (previous): ProxyPageType | undefined => previous,
  });
}

export function useProxyStats(): UseQueryResult<ProxyStatsType | undefined> {
  return useQuery({
    queryKey: ['proxy-stats'],
    queryFn: async (): Promise<ProxyStatsType | undefined> =>
      ensure(await api.GET('/proxies/stats')),
    refetchInterval: 30_000,
  });
}

/** What the lists, the figures and the dashboard show of the proxies is stale once they change. */
function useRefreshedViews(): () => Promise<void> {
  const client = useQueryClient();

  return async (): Promise<void> => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['proxies'] }),
      client.invalidateQueries({ queryKey: ['proxy-stats'] }),
      client.invalidateQueries({ queryKey: ['dashboard'] }),
    ]);
  };
}

export function useAddProxy(): UseMutationResult<void, Error, string> {
  const refreshed = useRefreshedViews();

  return useMutation({
    mutationFn: async (server: string): Promise<void> => {
      ensure(await api.POST('/proxies', { body: { server } }));
    },
    onSuccess: refreshed,
  });
}

export function useSetProxyDisabled(): UseMutationResult<
  void,
  Error,
  { server: string; disabled: boolean }
> {
  const refreshed = useRefreshedViews();

  return useMutation({
    mutationFn: async (change: { server: string; disabled: boolean }): Promise<void> => {
      ensure(
        await api.PATCH('/proxies', {
          params: { query: { server: change.server } },
          body: { disabled: change.disabled },
        }),
      );
    },
    onSuccess: refreshed,
  });
}

export interface SourceRefreshesInterface {
  /** The newest refresh of each source, whoever started it: the button or the schedule of the hub. */
  latest: Map<string, JobRecordType>;
  start: (sources: readonly ProxySourceType[]) => void;
  /** The sources whose refresh is being asked for. */
  starting: readonly ProxySourceType[];
  error: Error | null;
}

/**
 * The refreshes of the sources, as the jobs of the hub tell them: followed while one is on its way, whether the
 * button started it or the schedule did. When one ends, the proxies it checked are shown.
 */
export function useSourceRefreshes(): SourceRefreshesInterface {
  const client = useQueryClient();
  const refreshed = useRefreshedViews();
  const jobs = useJobRecords({ kind: 'proxy_fetch', page: 1, pageSize: 50 }, 10_000);
  const latest = latestJobsBySource(jobs.data?.items ?? []);
  const active = activeJobIds(latest.values());
  const previous = useRef<ReadonlySet<string>>(active);

  useEffect((): void => {
    if (hasEnded(previous.current, active)) void refreshed();
    previous.current = active;
  });

  const start = useMutation({
    mutationFn: async (sources: readonly ProxySourceType[]): Promise<void> => {
      await Promise.all(
        sources.map(async (source): Promise<void> => {
          ensure(
            await api.POST('/proxy-sources/{source}/refresh', {
              params: { path: { source } },
              body: {},
            }),
          );
        }),
      );
    },
    onSettled: (): Promise<void> => client.invalidateQueries({ queryKey: ['jobs'] }),
  });

  return {
    latest,
    start: (sources): void => {
      start.mutate(sources);
    },
    starting: start.isPending ? start.variables : [],
    error: start.error ?? jobs.error,
  };
}
