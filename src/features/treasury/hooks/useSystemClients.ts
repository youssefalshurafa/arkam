'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { accountingApi } from '@/lib/accountingApi';
import { queryKeys } from '@/lib/queryClient';
import type { SystemClient, TreasuryBalanceEntry } from '@/shared/types';

/**
 * The hidden Treasury/Cashbox `clients` rows (id/name/kind/owner) — a small, separate query
 * from useWorkspaceData's bundled snapshot (see listSystemClients), fetched only while the
 * Treasury section is mounted. `enabled` gates the fetch so every other page never pays for
 * this round-trip.
 */
export function useSystemClients(userId: string | null | undefined, workspaceId: string | null | undefined, enabled: boolean) {
 return useQuery<SystemClient[]>({
  queryKey: queryKeys.systemClients(userId, workspaceId),
  queryFn: () => accountingApi.listSystemClients(),
  enabled,
 });
}

/** Invalidates the system-clients query, e.g. after ensureTreasuryAndCashboxes bootstraps new rows. */
export function useInvalidateSystemClients(userId: string | null | undefined, workspaceId: string | null | undefined) {
 const queryClient = useQueryClient();
 return () => queryClient.invalidateQueries({ queryKey: queryKeys.systemClients(userId, workspaceId) });
}

/**
 * Treasury's cash-on-hand per currency — balance only, no ledger entries. Unlike
 * useSystemClients, this is fetched for EVERY role including a `member`, since
 * getTreasuryBalance's server-side response is deliberately summary-only (see route.ts) and
 * safe to show even to a role that can't see Treasury's own ledger.
 */
export function useTreasuryBalance(userId: string | null | undefined, workspaceId: string | null | undefined, enabled: boolean) {
 return useQuery<TreasuryBalanceEntry[]>({
  queryKey: queryKeys.treasuryBalance(userId, workspaceId),
  queryFn: () => accountingApi.getTreasuryBalance(),
  enabled,
 });
}

/** Invalidates the Treasury-balance query, e.g. after a transfer transaction is submitted. */
export function useInvalidateTreasuryBalance(userId: string | null | undefined, workspaceId: string | null | undefined) {
 const queryClient = useQueryClient();
 return () => queryClient.invalidateQueries({ queryKey: queryKeys.treasuryBalance(userId, workspaceId) });
}
