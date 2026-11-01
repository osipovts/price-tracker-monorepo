import {
  useMutation,
  type UseMutationResult,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { ensure } from 'frontend-shared';

import { api } from '../../shared/api/api.client.js';
import type { operations } from '../../shared/api/schema.js';

export type ProductGroupPageType =
  operations['ProductGroupsController_list']['responses'][200]['content']['application/json'];
export type ProductGroupType = ProductGroupPageType['items'][number];
export type ProductGroupDetailType =
  operations['ProductGroupsController_get']['responses'][200]['content']['application/json'];
export type StatsPeriodType = ProductGroupPageType['statsPeriod'];

export const statsPeriods: readonly StatsPeriodType[] = ['24h', '7d', '30d'];
export const groupPageSize = 20;

/** How long to wait for the first price of a product that has none yet, in milliseconds. */
const firstPricePollMs = 3000;

/** A group whose products have no price yet, or no picture yet. */
function isAwaitingData(group: ProductGroupType): boolean {
  return group.productCount > 0 && group.current === null && group.thumbnailUrl === null;
}

export function useProductGroups(page: number): UseQueryResult<ProductGroupPageType | undefined> {
  return useQuery({
    queryKey: ['product-groups', 'list', page],
    queryFn: async (): Promise<ProductGroupPageType | undefined> =>
      ensure(
        await api.GET('/product-groups', { params: { query: { page, pageSize: groupPageSize } } }),
      ),
    placeholderData: (previous): ProductGroupPageType | undefined => previous,
    // A product that was just added has no price until a worker reads it, and no picture until it is kept.
    refetchInterval: (query): number | false =>
      query.state.data?.items.some(isAwaitingData) === true ? firstPricePollMs : false,
  });
}

export function useProductGroup(id: string): UseQueryResult<ProductGroupDetailType | undefined> {
  return useQuery({
    queryKey: ['product-groups', 'detail', id],
    queryFn: async (): Promise<ProductGroupDetailType | undefined> =>
      ensure(await api.GET('/product-groups/{id}', { params: { path: { id } } })),
    refetchInterval: (query): number | false =>
      query.state.data?.products.some((product) => product.latest === null) === true
        ? firstPricePollMs
        : 60_000,
  });
}

function useGroupMutation<VariablesType>(
  call: (variables: VariablesType) => Promise<void>,
): UseMutationResult<void, Error, VariablesType> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: call,
    onSuccess: (): Promise<void> => client.invalidateQueries({ queryKey: ['product-groups'] }),
  });
}

export function useCreateGroup(): UseMutationResult<void, Error, string | null> {
  return useGroupMutation(async (title: string | null): Promise<void> => {
    ensure(await api.POST('/product-groups', { body: title === null ? {} : { title } }));
  });
}

export function useRenameGroup(id: string): UseMutationResult<void, Error, string> {
  return useGroupMutation(async (title: string): Promise<void> => {
    ensure(await api.PATCH('/product-groups/{id}', { params: { path: { id } }, body: { title } }));
  });
}

export function useDeleteGroup(): UseMutationResult<void, Error, string> {
  return useGroupMutation(async (id: string): Promise<void> => {
    ensure(await api.DELETE('/product-groups/{id}', { params: { path: { id } } }));
  });
}

export function useChooseStatsPeriod(): UseMutationResult<void, Error, StatsPeriodType> {
  return useGroupMutation(async (statsPeriod: StatsPeriodType): Promise<void> => {
    ensure(await api.PUT('/product-groups/stats-period', { body: { statsPeriod } }));
  });
}
