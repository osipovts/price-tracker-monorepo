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

export type DashboardType =
  operations['AdminController_dashboard']['responses'][200]['content']['application/json'];

export type MarketplaceType =
  operations['AdminProductsController_setMarketplaceDisabled']['parameters']['path']['marketplace'];

export function useDashboard(): UseQueryResult<DashboardType | undefined> {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: async (): Promise<DashboardType | undefined> =>
      ensure(await api.GET('/admin/dashboard')),
    refetchInterval: 30_000,
  });
}

export function useSetMarketplaceDisabled(): UseMutationResult<
  void,
  Error,
  { marketplace: MarketplaceType; disabled: boolean }
> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async ({ marketplace, disabled }): Promise<void> => {
      ensure(
        await api.PATCH('/admin/marketplaces/{marketplace}', {
          params: { path: { marketplace } },
          body: { disabled },
        }),
      );
    },
    onSuccess: async (): Promise<void> => {
      await client.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
