import { create } from 'zustand';
import {
 getStoredPriceCalculator,
 priceCalculatorPairKey,
 priceCalculatorRouteKey,
 savePriceCalculator,
 type PriceCalculatorRate,
 type StoredPriceCalculator,
} from '@/shared/lib/localStorage';

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
 setDecimals: (value: number) => void;
 setBridge: (foreign: string, bridge: string) => void;
 /** The rate between two currencies, as "1 rate.base = rate.value <the other>". */
 setRate: (a: string, b: string, rate: PriceCalculatorRate) => void;
 setCommission: (foreign: string, bridge: string, value: string) => void;
 hydrate: () => void;
};

const pickPersisted = (s: StoredPriceCalculator): StoredPriceCalculator => ({
 foreignCode: s.foreignCode,
 amount: s.amount,
 decimals: s.decimals,
 bridges: s.bridges,
 rates: s.rates,
 commissions: s.commissions,
 mainPerUsd: s.mainPerUsd,
 commissionPct: s.commissionPct,
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
  setDecimals: (value) => update({ decimals: value }),
  setBridge: (foreign, bridge) => update({ bridges: { ...get().bridges, [foreign]: bridge } }),
  setRate: (a, b, rate) => update({ rates: { ...get().rates, [priceCalculatorPairKey(a, b)]: rate } }),
  setCommission: (foreign, bridge, value) => update({ commissions: { ...get().commissions, [priceCalculatorRouteKey(foreign, bridge)]: value } }),
  // Re-read from localStorage without saving back (used after the server settings are applied).
  hydrate: () => set(getStoredPriceCalculator()),
 };
});
