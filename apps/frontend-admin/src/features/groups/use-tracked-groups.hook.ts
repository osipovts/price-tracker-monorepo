import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ensure } from 'frontend-shared';

import { api } from '../../shared/api/api.client.js';
import type { operations } from '../../shared/api/schema.js';

export type TrackedGroupPageType =
  operations['AdminController_groups']['responses'][200]['content']['application/json'];
export type TrackedGroupType = TrackedGroupPageType['items'][number];

/** Where the app shows a group of any user to an administrator, read-only. */
export function groupViewUrl(groupId: string): string {
  return `/app/view/groups/${groupId}`;
}

export function useTrackedGroups(
  page: number,
  pageSize: number,
): UseQueryResult<TrackedGroupPageType | undefined> {
  return useQuery({
    queryKey: ['groups', { page, pageSize }],
    queryFn: async (): Promise<TrackedGroupPageType | undefined> =>
      ensure(await api.GET('/admin/product-groups', { params: { query: { page, pageSize } } })),
    placeholderData: (previous): TrackedGroupPageType | undefined => previous,
    refetchInterval: 60_000,
  });
}
