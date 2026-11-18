import { create } from 'zustand';
import { getStoredPriceCalculator, savePriceCalculator, type PriceCalculatorQuote, type StoredPriceCalculator } from '@/shared/lib/localStorage';

/**
 * The Price Calculator's inputs, held in a store (not component state) for the same reason as
 * useLiveRatesSettingsStore: the per-user settings sync in page.tsx applies the server copy to
 * localStorage only once that fetch resolves, which can be AFTER this page has mounted (e.g.
 * opening /price-calculator directly on a new device). page.tsx calls `hydrate()` right after
 * applying, so the restored values show up without a reload.
 *
 * Values are persisted only from the setters — i.e. on an actual user edit, never on mount. A
 * mount-time save would fire the settings-changed event and push a snapshot to the server
 * before the real settings had arrived, overwriting the user's synced values with empties.
 */
type PriceCalculatorStore = StoredPriceCalculator & {
 setForeignCode: (code: string) => void;
 setAmount: (value: string) => void;
 setMainPerUsd: (value: string) => void;
 setForeignRate: (code: string, value: string) => void;
 setForeignQuote: (code: string, quote: PriceCalculatorQuote) => void;
 setCommission: (code: string, value: string) => void;
 hydrate: () => void;
};

const pickPersisted = (s: StoredPriceCalculator): StoredPriceCalculator => ({
 foreignCode: s.foreignCode,
 amount: s.amount,
 commissionPct: s.commissionPct,
 mainPerUsd: s.mainPerUsd,
 foreignRates: s.foreignRates,
 foreignQuotes: s.foreignQuotes,
 commissions: s.commissions,
});

export const usePriceCalculatorStore = create<PriceCalculatorStore>((set, get) => {
 const update = (patch: Partial<StoredPriceCalculator>) => {
  set(patch);
  savePriceCalculator(pickPersisted(get()));
 };
 return {
  ...getStoredPriceCalculator(),
  setForeignCode: (code) => update({ foreignCode: code }),
  setAmount: (value) => update({ amount: value }),
  setMainPerUsd: (value) => update({ mainPerUsd: value }),
  setForeignRate: (code, value) => update({ foreignRates: { ...get().foreignRates, [code]: value } }),
  setForeignQuote: (code, quote) => update({ foreignQuotes: { ...get().foreignQuotes, [code]: quote } }),
  setCommission: (code, value) => update({ commissions: { ...get().commissions, [code]: value } }),
  // Re-read from localStorage without saving back (used after the server settings are applied).
  hydrate: () => set(getStoredPriceCalculator()),
 };
});
