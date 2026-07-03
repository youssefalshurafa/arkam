import { create } from 'zustand';
import type { Dispatch, SetStateAction } from 'react';
import { getStoredOverviewRates, saveOverviewRates } from '@/shared/lib/localStorage';

/**
 * Overview UI state (per-browser): the user-entered FX rates for the balance
 * cards plus their flip toggles. Rates persist via the existing localStorage
 * helpers (unchanged key/format). Setters mirror the previous useState setters so
 * the moved JSX keeps calling them exactly as before.
 */
type OverviewStore = {
 overviewRates: Record<string, string>;
 overviewFlipAll: boolean;
 overviewFlipped: Set<string>;
 setOverviewFlipAll: Dispatch<SetStateAction<boolean>>;
 setOverviewFlipped: Dispatch<SetStateAction<Set<string>>>;
 updateOverviewRate: (currencyCode: string, value: string) => void;
};

export const useOverviewStore = create<OverviewStore>((set) => ({
 overviewRates: getStoredOverviewRates(),
 overviewFlipAll: false,
 overviewFlipped: new Set(),
 setOverviewFlipAll: (updater) =>
  set((s) => ({ overviewFlipAll: typeof updater === 'function' ? updater(s.overviewFlipAll) : updater })),
 setOverviewFlipped: (updater) =>
  set((s) => ({ overviewFlipped: typeof updater === 'function' ? updater(s.overviewFlipped) : updater })),
 updateOverviewRate: (currencyCode, value) =>
  set((s) => {
   const next = { ...s.overviewRates, [currencyCode]: value };
   saveOverviewRates(next);
   return { overviewRates: next };
  }),
}));
