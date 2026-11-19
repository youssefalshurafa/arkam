import { getCommissionAmount } from '@/shared/utils/commission';

/**
 * The calculator prices a foreign currency in the main currency THROUGH a bridge currency —
 * usually USD, but any currency works (pricing SAR through AED or EUR), and "direct" is simply
 * the main currency as its own bridge.
 *
 * How a currency X's rate against the bridge B is written:
 * - 'units-per-bridge': 1 B = rate X   (AED against USD: 3.67, MAD against USD: 10.45)
 * - 'bridge-per-unit':  1 X = rate B   (CHF against USD: 1.1862)
 * Rates are taken the way the source shows them, so the user never inverts by hand.
 */
export type RateQuote = 'units-per-bridge' | 'bridge-per-unit';

export type PriceCalcInput = {
 /** Amount of the foreign currency (e.g. 100,000 AED). May be 0 — the price still computes. */
 amount: number;
 /** The foreign currency's rate against the bridge, read according to `rateQuote`. */
 rate: number;
 rateQuote: RateQuote;
 /**
  * Commission in percent, SIGNED: positive adds it to the bridge-currency value (+0.5 → ×1.005),
  * negative deducts it (−3.7 → ×0.963). Same sign-is-direction convention as every other
  * commission in the app (see CommissionDirectionToggle).
  */
 commissionPct: number;
 /** The main currency's rate against the bridge, read according to `mainQuote` (MAD: 1 USD = 10.45). */
 mainRate: number;
 mainQuote: RateQuote;
};

export type PriceCalcResult = {
 /** Price of 1 unit of the foreign currency in the main currency, commission included. */
 price: number;
 /** The amount converted to the bridge currency, before commission. */
 bridgeBase: number;
 /** The signed commission in the bridge currency (negative when deducted). */
 commissionBridge: number;
 /** The amount converted to the bridge currency, commission included. */
 bridgeValue: number;
 /** The amount converted to the main currency, commission included. */
 mainValue: number;
};

/** How many units of the bridge one unit of X is worth, from X's rate as quoted. */
export const bridgePerUnit = (rate: number, quote: RateQuote) => (quote === 'bridge-per-unit' ? rate : 1 / rate);

// Generalizes the user's sheet formula
//   (((amount/fxUsd) + (amount/fxUsd)*commission%) * mainUsd) / amount
// to any bridge currency, either quote direction on both rates, and a signed commission. The
// amount cancels out of the price, so it is computed per unit and the price shows even before
// an amount is typed. Returns null when either rate is missing (the sheet's blank cell).
export function computePrice({ amount, rate, rateQuote, commissionPct, mainRate, mainQuote }: PriceCalcInput): PriceCalcResult | null {
 if (!Number.isFinite(rate) || !Number.isFinite(mainRate) || rate <= 0 || mainRate <= 0) return null;
 const pct = Number.isFinite(commissionPct) ? commissionPct : 0;
 const safeAmount = Number.isFinite(amount) ? amount : 0;

 // Converting with the quote as given (rather than pre-inverting it) avoids the rounding a
 // hand-typed inverse introduces (1 / 1.1862 = 0.84303…, not 0.8414).
 const perUnit = bridgePerUnit(rate, rateQuote);
 const mainPerBridge = 1 / bridgePerUnit(mainRate, mainQuote);
 const price = (perUnit + getCommissionAmount(perUnit, pct)) * mainPerBridge;

 const bridgeBase = safeAmount * perUnit;
 const commissionBridge = getCommissionAmount(bridgeBase, pct);
 const bridgeValue = bridgeBase + commissionBridge;
 return { price, bridgeBase, commissionBridge, bridgeValue, mainValue: bridgeValue * mainPerBridge };
}
