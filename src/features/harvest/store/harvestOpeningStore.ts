import { create } from 'zustand';
import { getStoredHarvestOpening, saveHarvestOpening } from '@/shared/lib/localStorage';

/**
 * Per-browser opening inventory for حصاد اليوم (Today's Harvest).
 *
 * The house already holds currency accumulated before it started tagging
 * buy/sell transactions. The user records, per currency, how much they held and
 * its average cost (in the main currency) as of `asOf`; the engine seeds each
 * weighted-average-cost pool from this, then replays only transactions on/after
 * `asOf`. Without this, the first sells compute against an empty/wrong cost.
 */
type OpeningEntry = { qty: string; avgCost: string };

type HarvestOpeningStore = {
  asOf: string;
  byCurrency: Record<string, OpeningEntry>;
  setAsOf: (date: string) => void;
  setEntry: (currencyId: number, patch: Partial<OpeningEntry>) => void;
};

const initial = getStoredHarvestOpening();

export const useHarvestOpeningStore = create<HarvestOpeningStore>((set) => ({
  asOf: initial.asOf,
  byCurrency: initial.byCurrency,
  setAsOf: (date) =>
    set((s) => {
      const next = { asOf: date, byCurrency: s.byCurrency };
      saveHarvestOpening(next);
      return { asOf: date };
    }),
  setEntry: (currencyId, patch) =>
    set((s) => {
      const key = String(currencyId);
      const existing = s.byCurrency[key] ?? { qty: '', avgCost: '' };
      const merged: OpeningEntry = { qty: existing.qty, avgCost: existing.avgCost, ...patch };
      const byCurrency = { ...s.byCurrency, [key]: merged };
      saveHarvestOpening({ asOf: s.asOf, byCurrency });
      return { byCurrency };
    }),
}));
