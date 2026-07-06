'use client';

import { useCallback, useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { accountingApi, type BackupInfo } from '@/lib/accountingApi';
import { queryKeys } from '@/lib/queryClient';
import { readDataCache, saveDataCache } from '@/shared/lib/localStorage';
import type {
 Client,
 ClientAccount,
 ClientAdjustment,
 Currency,
 Organization,
 Reconciliation,
 Transaction,
} from '@/shared/types';

/**
 * The full workspace snapshot. All six collections are fetched together (as the
 * app always did in loadData) plus backup metadata, so a single query owns the
 * server cache and one invalidation refetches everything consistently.
 */
export type WorkspaceData = {
 organizations: Organization[];
 clients: Client[];
 currencies: Currency[];
 transactions: Transaction[];
 clientAccounts: ClientAccount[];
 adjustments: ClientAdjustment[];
 reconciliations: Reconciliation[];
 backup: BackupInfo | null;
};

/**
 * Loads (and caches) the workspace snapshot. Ports loadData() verbatim: the same
 * parallel fetch, the empty-currency reseed fallback, and the sessionStorage
 * cache write. initialData seeds instantly from that cache so the first paint has
 * data (isPending stays false when a cache exists — matching the old
 * `isLoading = _initialCache === null` behavior); it is treated as stale so a
 * fresh fetch still runs on mount.
 */
export function useWorkspaceData(userId: string | null | undefined, workspaceId: string | null | undefined) {
 return useQuery<WorkspaceData>({
  queryKey: queryKeys.workspaceData(userId, workspaceId),
  queryFn: async () => {
   const [organizations, clients, currencyRows, transactions, clientAccounts, adjustments, reconciliations, backup] = (await Promise.all([
    accountingApi.listOrganizations(),
    accountingApi.listClients(),
    accountingApi.listCurrencies(),
    accountingApi.listTransactions(),
    accountingApi.listAllClientAccounts(),
    accountingApi.listClientAdjustments(),
    accountingApi.listReconciliations(),
    accountingApi.getBackupInfo(),
   ])) as [Organization[], Client[], Currency[], Transaction[], ClientAccount[], ClientAdjustment[], Reconciliation[], BackupInfo];

   let currencies = currencyRows;
   if (!currencies.length) {
    await accountingApi.reseedCurrencies();
    currencies = (await accountingApi.listCurrencies()) as Currency[];
   }

   saveDataCache({ organizations, clients, currencies, transactions, adjustments, clientAccounts, reconciliations }, userId, workspaceId);
   return { organizations, clients, currencies, transactions, clientAccounts, adjustments, reconciliations, backup };
  },
  initialData: () => {
   const cache = readDataCache(userId, workspaceId);
   // Older cached snapshots predate `reconciliations`; default it so consumers never see undefined.
   return cache ? { ...cache, reconciliations: cache.reconciliations ?? [], backup: null } : undefined;
  },
  // The sessionStorage snapshot is per-tab and can be arbitrarily stale (another
  // tab may have written new transactions to the server since it was saved).
  // Stamp it as fetched at epoch so React Query always treats the seed as stale
  // and runs a fresh mount refetch — the cache only speeds the first paint, it
  // never suppresses a server read. Without this the seed counts as "fresh" for
  // staleTime and a refreshed tab would show old data until the next mutation.
  initialDataUpdatedAt: 0,
 });
}

/**
 * Cache-editing helpers over the workspace snapshot. `update` applies a
 * setState-style updater to one collection (used by the optimistic edits that
 * previously called setTransactions/setClientAccounts/... directly); `invalidate`
 * triggers a full refetch (the replacement for the old loadData() reload calls).
 */
export function useWorkspaceCache(userId: string | null | undefined, workspaceId: string | null | undefined) {
 const queryClient = useQueryClient();
 const queryKey = queryKeys.workspaceData(userId, workspaceId);

 const update = useCallback(
  <K extends keyof WorkspaceData>(key: K, updater: SetStateAction<WorkspaceData[K]>) => {
   queryClient.setQueryData<WorkspaceData>(queryKey, (prev) => {
    if (!prev) return prev;
    const current = prev[key];
    const next = typeof updater === 'function' ? (updater as (value: WorkspaceData[K]) => WorkspaceData[K])(current) : updater;
    return { ...prev, [key]: next };
   });
  },
  // queryKey is derived from userId/workspaceId; depend on both so a switch retargets.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [queryClient, userId, workspaceId],
 );

 const invalidate = useCallback(
  () => queryClient.invalidateQueries({ queryKey }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [queryClient, userId, workspaceId],
 );

 /**
  * Stable `setState`-compatible setters, one per collection. Identity is memoized
  * so they can safely sit in downstream useCallback/useEffect dependency arrays.
  */
 const setters = useMemo(() => {
  const bind = <K extends keyof WorkspaceData>(key: K): Dispatch<SetStateAction<WorkspaceData[K]>> => (updater) => update(key, updater);
  return {
   setOrganizations: bind('organizations'),
   setClients: bind('clients'),
   setCurrencies: bind('currencies'),
   setTransactions: bind('transactions'),
   setClientAccounts: bind('clientAccounts'),
   setAdjustments: bind('adjustments'),
   setReconciliations: bind('reconciliations'),
  };
 }, [update]);

 return { update, invalidate, setters };
}
