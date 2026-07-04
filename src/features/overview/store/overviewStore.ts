import { create } from 'zustand';
import type { Dispatch, SetStateAction } from 'react';
import { getStoredOverviewRates, saveOverviewRates } from '@/shared/lib/localStorage';

/**
 * Overview UI state (per-browser): the user-entered FX rates for the balance
 * cards plus their flip toggles. Rates persist via the existing localStorage
 * helpers (unchanged key/format).
 *
 * Rates are keyed per card (`group.key` = `orgId:currencyId`) so the same currency
 * can carry a different rate in each organization. Older entries keyed by bare
 * currency code are still read as a fallback (see OverviewSection) so previously
 * saved rates are not lost after the switch to per-card keys.
 */
type OverviewStore = {
 overviewRates: Record<string, string>;
 overviewFlipAll: boolean;
 overviewFlipped: Set<string>;
 setOverviewFlipAll: Dispatch<SetStateAction<boolean>>;
 setOverviewFlipped: Dispatch<SetStateAction<Set<string>>>;
 updateOverviewRate: (cardKey: string, value: string) => void;
};

export const useOverviewStore = create<OverviewStore>((set) => ({
 overviewRates: getStoredOverviewRates(),
 overviewFlipAll: false,
 overviewFlipped: new Set(),
 setOverviewFlipAll: (updater) =>
  set((s) => ({ overviewFlipAll: typeof updater === 'function' ? updater(s.overviewFlipAll) : updater })),
 setOverviewFlipped: (updater) =>
  set((s) => ({ overviewFlipped: typeof updater === 'function' ? updater(s.overviewFlipped) : updater })),
 updateOverviewRate: (cardKey, value) =>
  set((s) => {
   const next = { ...s.overviewRates, [cardKey]: value };
   saveOverviewRates(next);
   return { overviewRates: next };
  }),
}));
