import { create } from 'zustand';
import type { Dispatch, SetStateAction } from 'react';

/**
 * Overview UI state (per-browser, ephemeral): which balance cards are flipped to
 * show their main-currency-converted face. The FX rates themselves are no longer
 * stored here — they're persisted server-side (see accountingApi.saveHarvestRate /
 * the harvestRates workspace collection), shared with حصاد اليوم (Today's Harvest).
 */
type OverviewStore = {
 overviewFlipped: Set<string>;
 setOverviewFlipped: Dispatch<SetStateAction<Set<string>>>;
};

export const useOverviewStore = create<OverviewStore>((set) => ({
 overviewFlipped: new Set(),
 setOverviewFlipped: (updater) =>
  set((s) => ({ overviewFlipped: typeof updater === 'function' ? updater(s.overviewFlipped) : updater })),
}));
