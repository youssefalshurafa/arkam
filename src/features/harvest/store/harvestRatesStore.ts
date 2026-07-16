import { create } from 'zustand';
import { getStoredHarvestRates, saveHarvestRates } from '@/shared/lib/localStorage';
import { localDateKey } from '@/shared/utils/date';

// Re-exported so existing harvest imports (`from '../store/harvestRatesStore'`) keep working;
// the canonical implementation now lives in shared/utils/date.ts.
export { localDateKey };

/**
 * Per-browser daily reference rates for حصاد اليوم (Today's Harvest).
 *
 * Keyed by `${dateKey}:${currencyId}:${groupKey}` (dateKey = local `yyyy-mm-dd`,
 * groupKey = `org:<organizationId>` or `client:<clientId>` for a client with no
 * organization) → the main-currency value of one unit, as raw input text. Different
 * organizations/standalone clients can trade the same foreign currency at different
 * rates, so the rate is entered per rate-group, not once globally per currency. These
 * only value foreign-to-foreign trades and free position gains; deals that price
 * directly against the main currency use the transaction's own dealt rate.
 */
type HarvestRatesStore = {
  rates: Record<string, string>;
  updateRate: (dateKey: string, currencyId: number, groupKey: string, value: string) => void;
};

export const harvestRateKey = (dateKey: string, currencyId: number, groupKey: string) => `${dateKey}:${currencyId}:${groupKey}`;

export const useHarvestRatesStore = create<HarvestRatesStore>((set) => ({
  rates: getStoredHarvestRates(),
  updateRate: (dateKey, currencyId, groupKey, value) =>
    set((s) => {
      const next = { ...s.rates, [harvestRateKey(dateKey, currencyId, groupKey)]: value };
      saveHarvestRates(next);
      return { rates: next };
    }),
}));
