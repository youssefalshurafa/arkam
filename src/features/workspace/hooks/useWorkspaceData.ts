'use client';

import { useCallback, useEffect, useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { accountingApi, type BackupInfo } from '@/lib/accountingApi';
import { queryKeys } from '@/lib/queryClient';
import { readDataCache, saveDataCache } from '@/shared/lib/localStorage';
import type {
 Client,
 ClientAccount,
 Currency,
 HarvestRate,
 IgnoredAnomaly,
 Organization,
 Reconciliation,
 Transaction,
 WriteOffMargin,
} from '@/shared/types';

/**
 * The full workspace snapshot. All collections are fetched together (as the
 * app always did in loadData) plus backup metadata, so a single query owns the
 * server cache and one invalidation refetches everything consistently.
 */
export type WorkspaceData = {
 organizations: Organization[];
 clients: Client[];
 currencies: Currency[];
 transactions: Transaction[];
 clientAccounts: ClientAccount[];
 reconciliations: Reconciliation[];
 ignoredAnomalies: IgnoredAnomaly[];
 harvestRates: HarvestRate[];
 writeOffMargins: WriteOffMargin[];
 backup: BackupInfo | null;
};

/**
 * Same-browser cross-tab notification channel for a workspace snapshot. Named after the same
 * (userId, workspaceId) pair as the query key so a mutation in one tab only pokes other tabs
 * viewing the same user+workspace — never a different account or workspace sharing the browser.
 */
function workspaceSyncName(userId: string | null | undefined, workspaceId: string | null | undefined): string {
 return `arkam:workspace-sync:${userId ?? '__anon__'}:${workspaceId ?? '__none__'}`;
}

// One channel per name for the tab's whole life, rather than one per message. The previous
// version opened a fresh BroadcastChannel inside `invalidate` and closed it on the very next
// line. The spec says already-queued deliveries survive that, and a Node check agreed, so this
// is not a confirmed cause of the missed updates it was written to address — but posting
// through a port that is being torn down in the same breath is needless exposure for no gain,
// and a channel opened once is simpler than one opened per mutation.
const syncChannels = new Map<string, BroadcastChannel>();

function getWorkspaceSyncChannel(userId: string | null | undefined, workspaceId: string | null | undefined): BroadcastChannel | null {
 if (typeof window === 'undefined' || !('BroadcastChannel' in window)) return null;
 const name = workspaceSyncName(userId, workspaceId);
 let channel = syncChannels.get(name);
 if (!channel) {
  channel = new BroadcastChannel(name);
  syncChannels.set(name, channel);
 }
 return channel;
}

/**
 * Tells every other tab on this user+workspace that the snapshot they hold is out of date.
 *
 * Sent two ways on purpose. BroadcastChannel is the direct route, but it is one in-memory hop
 * with no delivery guarantee and no support in some privacy modes; a `localStorage` write is the
 * belt-and-braces one, since the `storage` event fires in other tabs of the same origin and is
 * about as reliable as browser messaging gets. Neither reaches the tab it came from — the spec
 * excludes the sender in both cases — so this can't loop back into a self-invalidate.
 */
function notifyWorkspaceChanged(userId: string | null | undefined, workspaceId: string | null | undefined) {
 if (typeof window === 'undefined') return;
 const name = workspaceSyncName(userId, workspaceId);
 getWorkspaceSyncChannel(userId, workspaceId)?.postMessage('invalidate');
 try {
  window.localStorage.setItem(name, String(Date.now()));
 } catch {
  /* private mode / quota — the BroadcastChannel above is still in play */
 }
}

/**
 * Loads (and caches) the workspace snapshot. Ports loadData() verbatim: the same
 * parallel fetch, the empty-currency reseed fallback, and the sessionStorage
 * cache write. initialData seeds instantly from that cache so the first paint has
 * data (isPending stays false when a cache exists — matching the old
 * `isLoading = _initialCache === null` behavior); it is treated as stale so a
 * fresh fetch still runs on mount.
 */
export function useWorkspaceData(userId: string | null | undefined, workspaceId: string | null | undefined) {
 const queryClient = useQueryClient();
 const queryKey = queryKeys.workspaceData(userId, workspaceId);

 // Cross-tab live sync: another tab on the same user+workspace signals here after its own
 // mutations settle (see notifyWorkspaceChanged); refetch so this tab's view — a client's
 // ledger, say — picks up a transaction added next door without a manual reload.
 //
 // Listening on both routes matters more than it looks: the only other thing that would
 // eventually refresh this tab is refetchOnWindowFocus, and that is gated by the 30s staleTime.
 // Switching to a tab you were just using is inside that window, so if the signal is missed
 // there is no second chance and the tab sits on stale data until it is reloaded by hand.
 useEffect(() => {
  if (typeof window === 'undefined') return;
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const name = workspaceSyncName(userId, workspaceId);
  const channel = getWorkspaceSyncChannel(userId, workspaceId);
  const onStorage = (event: StorageEvent) => {
   if (event.key === name) refresh();
  };
  channel?.addEventListener('message', refresh);
  window.addEventListener('storage', onStorage);
  return () => {
   // The channel itself stays open for the tab's lifetime (it is shared and cached by name);
   // only this subscription goes away.
   channel?.removeEventListener('message', refresh);
   window.removeEventListener('storage', onStorage);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [queryClient, userId, workspaceId]);

 return useQuery<WorkspaceData>({
  queryKey,
  queryFn: async () => {
   // One request for the whole snapshot. This was ten parallel POSTs to /api/accounting, which
   // multiplied every piece of per-request work — session decode, workspace-role lookup,
   // schema-ensure, pool checkout — by ten for a single page load, and on a cold database made
   // all ten queue behind the same schema advisory lock. The collections are always needed
   // together and always invalidated together, so there was never a reason to ask separately.
   const snapshot = await accountingApi.getWorkspaceSnapshot();
   const { backup } = snapshot;
   const organizations = snapshot.organizations as Organization[];
   const clients = snapshot.clients as Client[];
   const transactions = snapshot.transactions as Transaction[];
   const clientAccounts = snapshot.clientAccounts as ClientAccount[];
   const reconciliations = snapshot.reconciliations as Reconciliation[];
   const ignoredAnomalies = snapshot.ignoredAnomalies as IgnoredAnomaly[];
   const harvestRates = snapshot.harvestRates as HarvestRate[];
   const writeOffMargins = snapshot.writeOffMargins as WriteOffMargin[];

   let currencies = snapshot.currencies as Currency[];
   // Seed (or repair) the currency catalog when it's empty or clearly under-seeded. A
   // fully-seeded catalog is the whole ISO list (160+) plus extras like USDT; anything at
   // or below a handful of rows means it never got seeded — historically a fresh workspace
   // could end up with ONLY USDT pre-seeded, which a plain `!length` check wouldn't catch,
   // leaving the user with a one-currency list. Reseed is idempotent (ON CONFLICT) and
   // preserves any enabled/main flags, so repairing an existing workspace is safe.
   if (currencies.length <= 1) {
    await accountingApi.reseedCurrencies();
    currencies = (await accountingApi.listCurrencies()) as Currency[];
   }

   saveDataCache({ organizations, clients, currencies, transactions, clientAccounts, reconciliations, ignoredAnomalies, harvestRates, writeOffMargins }, userId, workspaceId);
   return { organizations, clients, currencies, transactions, clientAccounts, reconciliations, ignoredAnomalies, harvestRates, writeOffMargins, backup };
  },
  initialData: () => {
   const cache = readDataCache(userId, workspaceId);
   // Older cached snapshots predate `reconciliations`/`ignoredAnomalies`/`harvestRates`/
   // `writeOffMargins`; default them so consumers never see undefined.
   return cache
    ? {
       ...cache,
       reconciliations: cache.reconciliations ?? [],
       ignoredAnomalies: cache.ignoredAnomalies ?? [],
       harvestRates: cache.harvestRates ?? [],
       writeOffMargins: cache.writeOffMargins ?? [],
       backup: null,
      }
    : undefined;
  },
  // The sessionStorage snapshot is per-tab and can be arbitrarily stale (another
  // tab may have written new transactions to the server since it was saved).
  // Stamp it as fetched at epoch so React Query always treats the seed as stale
  // and runs a fresh mount refetch — the cache only speeds the first paint, it
  // never suppresses a server read. Without this the seed counts as "fresh" for
  // staleTime and a refreshed tab would show old data until the next mutation.
  initialDataUpdatedAt: 0,
  // 'always' rather than inheriting the default true, which the global 30s staleTime gates.
  // Returning to a tab is precisely when its data is about to be read and acted on, and
  // switching back to a tab you were just using falls inside that 30s window — so the gated
  // version does nothing exactly when it is needed. This is the backstop that makes the tab
  // correct on its own even if every cross-tab signal above is missed; the signals are what
  // make it correct *immediately*, without waiting for a focus.
  refetchOnWindowFocus: 'always',
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

 const invalidate = useCallback(() => {
  const result = queryClient.invalidateQueries({ queryKey });
  // Tell other same-browser tabs on this user+workspace to refetch too, so e.g. a
  // client's ledger open in another tab picks up a transaction just added here.
  notifyWorkspaceChanged(userId, workspaceId);
  return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [queryClient, userId, workspaceId]);

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
   setReconciliations: bind('reconciliations'),
   setIgnoredAnomalies: bind('ignoredAnomalies'),
   setHarvestRates: bind('harvestRates'),
   setWriteOffMargins: bind('writeOffMargins'),
  };
 }, [update]);

 return { update, invalidate, setters };
}
