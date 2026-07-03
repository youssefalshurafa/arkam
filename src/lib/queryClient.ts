import { QueryClient } from '@tanstack/react-query';

/**
 * App-wide QueryClient factory.
 *
 * Defaults are tuned for this desktop/local-first accounting app: data is
 * workspace-scoped and served from a local SQLite bridge, so refetch-on-focus
 * churn is unwanted and a short staleTime keeps things responsive without
 * hammering the bridge. Mutations invalidate the relevant keys explicitly
 * (see per-feature hooks), replacing the old manual `loadData()` reloads.
 */
export function createQueryClient(): QueryClient {
 return new QueryClient({
  defaultOptions: {
   queries: {
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
   },
   mutations: {
    retry: 0,
   },
  },
 });
}

/**
 * Centralized query keys. Every server-data query/invalidation references one
 * of these so key shapes stay consistent across features. `all` is the coarse
 * invalidation used after workspace-wide mutations (import/restore/delete-all).
 */
export const queryKeys = {
 all: ['accounting'] as const,
 organizations: () => [...queryKeys.all, 'organizations'] as const,
 clients: () => [...queryKeys.all, 'clients'] as const,
 currencies: () => [...queryKeys.all, 'currencies'] as const,
 transactions: () => [...queryKeys.all, 'transactions'] as const,
 clientAccounts: () => [...queryKeys.all, 'clientAccounts'] as const,
 clientAdjustments: () => [...queryKeys.all, 'clientAdjustments'] as const,
 backupInfo: () => [...queryKeys.all, 'backupInfo'] as const,
 workspaces: () => [...queryKeys.all, 'workspaces'] as const,
} as const;
