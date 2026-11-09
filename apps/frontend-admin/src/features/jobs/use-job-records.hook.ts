import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ensure } from 'frontend-shared';

import { api } from '../../shared/api/api.client.js';
import type { operations } from '../../shared/api/schema.js';

type JobRecordQueryType = NonNullable<operations['AdminController_jobs']['parameters']['query']>;

export type JobRecordPageType =
  operations['AdminController_jobs']['responses'][200]['content']['application/json'];
export type JobRecordType = JobRecordPageType['items'][number];
export type JobKindType = JobRecordType['kind'];
export type JobStateType = NonNullable<JobRecordQueryType['state']>;

export const jobKinds: readonly JobKindType[] = ['price_fetch', 'proxy_fetch', 'handbook_fetch'];
export const jobStates: readonly JobStateType[] = ['active', 'completed', 'failed'];

export interface JobRecordFilterInterface {
  kind?: JobKindType;
  state?: JobStateType;
  page: number;
  pageSize: number;
}

/** A job that has not ended, nor is taken for lost. */
export function isActive(job: Pick<JobRecordType, 'status' | 'lost'>): boolean {
  return !job.lost && job.status !== 'completed' && job.status !== 'failed';
}

/** The jobs, the newest first; the page follows them while one of them is on its way, and now and then else. */
export function useJobRecords(
  filter: JobRecordFilterInterface,
  idleRefreshMs = 15_000,
): UseQueryResult<JobRecordPageType | undefined> {
  return useQuery({
    queryKey: ['jobs', filter],
    queryFn: async (): Promise<JobRecordPageType | undefined> =>
      ensure(
        await api.GET('/admin/jobs', {
          params: {
            query: {
              page: filter.page,
              pageSize: filter.pageSize,
              ...(filter.kind === undefined ? {} : { kind: filter.kind }),
              ...(filter.state === undefined ? {} : { state: filter.state }),
            },
          },
        }),
      ),
    placeholderData: (previous): JobRecordPageType | undefined => previous,
    refetchInterval: (query): number =>
      query.state.data?.items.some(isActive) === true ? 2000 : idleRefreshMs,
  });
}
