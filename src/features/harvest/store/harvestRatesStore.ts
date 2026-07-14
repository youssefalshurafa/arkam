import { create } from 'zustand';
import { getStoredHarvestRates, saveHarvestRates } from '@/shared/lib/localStorage';

/**
 * Per-browser daily reference rates for حصاد اليوم (Today's Harvest).
 *
 * Keyed by `${dateKey}:${currencyId}` (dateKey = local `yyyy-mm-dd`) → the
 * main-currency value of one unit, as raw input text. These only value
 * foreign-to-foreign trades and free position gains; deals that price directly
 * against the main currency use the transaction's own dealt rate.
 */
type HarvestRatesStore = {
  rates: Record<string, string>;
  updateRate: (dateKey: string, currencyId: number, value: string) => void;
};

export const harvestRateKey = (dateKey: string, currencyId: number) => `${dateKey}:${currencyId}`;

// Local calendar day as `yyyy-mm-dd`, matching the engine's "today" definition.
export const localDateKey = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const useHarvestRatesStore = create<HarvestRatesStore>((set) => ({
  rates: getStoredHarvestRates(),
  updateRate: (dateKey, currencyId, value) =>
    set((s) => {
      const next = { ...s.rates, [harvestRateKey(dateKey, currencyId)]: value };
      saveHarvestRates(next);
      return { rates: next };
    }),
}));
