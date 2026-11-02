import {
  useMutation,
  type UseMutationResult,
  useQueries,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { ensure } from 'frontend-shared';

import { api } from '../../shared/api/api.client.js';
import type { operations } from '../../shared/api/schema.js';
import {
  forgetPendingAdd,
  type PendingAddInterface,
  rememberPendingAdd,
} from './pending-add.type.js';
import {
  historyPageSize,
  loadPriceHistory,
  type PriceHistoryInterface,
} from './price-history.type.js';

type PriceHistoryPageType =
  operations['ProductsController_prices']['responses'][200]['content']['application/json'];
export type ObservationType = PriceHistoryPageType['items'][number];

export type ProductHistoryType = PriceHistoryInterface<
  PriceHistoryPageType['product'],
  ObservationType
>;

export interface AddedProductInterface {
  /** The group the product is in: the one asked for, a new one, or the one it was in already. */
  groupId: string;
  /** The user tracked the product before: the hub answers 200, not 201, and leaves it in its group. */
  trackedAlready: boolean;
}

export function useAddProduct(): UseMutationResult<
  AddedProductInterface,
  Error,
  PendingAddInterface
> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (add: PendingAddInterface): Promise<AddedProductInterface> => {
      rememberPendingAdd(add);
      const result = await api.POST('/products', {
        body: {
          url: add.url,
          ...(add.cityId === null ? {} : { cityId: add.cityId }),
          ...(add.groupId === null ? {} : { groupId: add.groupId }),
        },
      });
      const added = ensure(result);
      if (added === undefined) throw new Error('The hub answered an add with no product');

      return { groupId: added.groupId, trackedAlready: result.response.status === 200 };
    },
    onSuccess: (): Promise<void> => client.invalidateQueries({ queryKey: ['product-groups'] }),
    // Here, not in the call: the page that made it may be gone by then.
    onSettled: forgetPendingAdd,
  });
}

export function useDeleteProduct(): UseMutationResult<void, Error, string> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      ensure(await api.DELETE('/products/{id}', { params: { path: { id } } }));
    },
    onSuccess: async (_data, id): Promise<void> => {
      client.removeQueries({ queryKey: ['price-history', id] });
      await client.invalidateQueries({ queryKey: ['product-groups'] });
    },
  });
}

export function usePriceHistory(id: string): UseQueryResult<ProductHistoryType | undefined> {
  const client = useQueryClient();
  const key = ['price-history', id];

  return useQuery({
    queryKey: key,
    // What the page has of the history stays: a refresh asks for what is newer only.
    queryFn: (): Promise<ProductHistoryType | undefined> =>
      loadPriceHistory(
        async (page) =>
          ensure(
            await api.GET('/products/{id}/prices', {
              params: { path: { id }, query: { page, pageSize: historyPageSize } },
            }),
          ),
        client.getQueryData<ProductHistoryType>(key),
      ),
    refetchInterval: 60_000,
  });
}

/** The history of each of the products, in the order given; undefined for one not loaded yet. */
export function usePriceHistories(
  ids: readonly string[],
): Array<UseQueryResult<ProductHistoryType | undefined>> {
  const client = useQueryClient();

  return useQueries({
    queries: ids.map((id) => ({
      queryKey: ['price-history', id],
      queryFn: (): Promise<ProductHistoryType | undefined> =>
        loadPriceHistory(
          async (page) =>
            ensure(
              await api.GET('/products/{id}/prices', {
                params: { path: { id }, query: { page, pageSize: historyPageSize } },
              }),
            ),
          client.getQueryData<ProductHistoryType>(['price-history', id]),
        ),
      refetchInterval: 60_000,
    })),
  });
}

export type CityType =
  operations['CitiesController_list']['responses'][200]['content']['application/json']['items'][number];

/** The cities of DNS whose names have the query in them, for the user to choose from. */
export function useCities(query: string, enabled: boolean): UseQueryResult<CityType[] | undefined> {
  return useQuery({
    queryKey: ['cities', 'dns', query],
    queryFn: async (): Promise<CityType[] | undefined> =>
      ensure(
        await api.GET('/marketplaces/{marketplace}/cities', {
          params: { path: { marketplace: 'dns' }, query: { query, limit: 20 } },
        }),
      )?.items,
    enabled,
    staleTime: 5 * 60_000,
    placeholderData: (previous): CityType[] | undefined => previous,
  });
}
