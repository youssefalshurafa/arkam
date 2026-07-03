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
export function useWorkspaceData(userId: string | null | undefined) {
 return useQuery<WorkspaceData>({
  queryKey: queryKeys.workspaceData(userId),
  queryFn: async () => {
   const [organizations, clients, currencyRows, transactions, clientAccounts, adjustments, backup] = (await Promise.all([
    accountingApi.listOrganizations(),
    accountingApi.listClients(),
    accountingApi.listCurrencies(),
    accountingApi.listTransactions(),
    accountingApi.listAllClientAccounts(),
    accountingApi.listClientAdjustments(),
    accountingApi.getBackupInfo(),
   ])) as [Organization[], Client[], Currency[], Transaction[], ClientAccount[], ClientAdjustment[], BackupInfo];

   let currencies = currencyRows;
   if (!currencies.length) {
    await accountingApi.reseedCurrencies();
    currencies = (await accountingApi.listCurrencies()) as Currency[];
   }

   saveDataCache({ organizations, clients, currencies, transactions, adjustments, clientAccounts }, userId);
   return { organizations, clients, currencies, transactions, clientAccounts, adjustments, backup };
  },
  initialData: () => {
   const cache = readDataCache(userId);
   return cache ? { ...cache, backup: null } : undefined;
  },
 });
}

/**
 * Cache-editing helpers over the workspace snapshot. `update` applies a
 * setState-style updater to one collection (used by the optimistic edits that
 * previously called setTransactions/setClientAccounts/... directly); `invalidate`
 * triggers a full refetch (the replacement for the old loadData() reload calls).
 */
export function useWorkspaceCache(userId: string | null | undefined) {
 const queryClient = useQueryClient();
 const queryKey = queryKeys.workspaceData(userId);

 const update = useCallback(
  <K extends keyof WorkspaceData>(key: K, updater: SetStateAction<WorkspaceData[K]>) => {
   queryClient.setQueryData<WorkspaceData>(queryKey, (prev) => {
    if (!prev) return prev;
    const current = prev[key];
    const next = typeof updater === 'function' ? (updater as (value: WorkspaceData[K]) => WorkspaceData[K])(current) : updater;
    return { ...prev, [key]: next };
   });
  },
  // queryKey is derived from userId; depend on the id so a user switch retargets.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [queryClient, userId],
 );

 const invalidate = useCallback(
  () => queryClient.invalidateQueries({ queryKey }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [queryClient, userId],
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
  };
 }, [update]);

 return { update, invalidate, setters };
}
