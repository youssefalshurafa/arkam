'use client';

import { useCallback } from 'react';
import { useLedgerStore } from '@/features/ledger/store/ledgerStore';
import { defaultLedgerFilter, isLedgerFilterActive } from '@/shared/lib/localStorage';
import type { LedgerFilterState } from '@/shared/types';

/**
 * The ledger filter bar of one client. Each client keeps its own (see ledgerFilters in
 * ledgerStore), so a search typed on one client's ledger isn't waiting in the box when the
 * next client is opened. Derived straight from the map on every render rather than swapped in
 * by an effect on client change, so the new client never renders even once under the old
 * client's filter.
 */
export function useLedgerClientFilter(clientId: number | null | undefined) {
 const key = clientId == null ? '' : String(clientId);
 const filter = useLedgerStore((s) => s.ledgerFilters[key]) ?? defaultLedgerFilter;
 const setLedgerFilters = useLedgerStore((s) => s.setLedgerFilters);
 const updateFilter = useCallback(
  (patch: Partial<LedgerFilterState>) => setLedgerFilters((prev) => ({ ...prev, [key]: { ...(prev[key] ?? defaultLedgerFilter), ...patch } })),
  [key, setLedgerFilters],
 );
 const clearFilter = useCallback(() => updateFilter(defaultLedgerFilter), [updateFilter]);
 return { filter, updateFilter, clearFilter, isActive: isLedgerFilterActive(filter) };
}
