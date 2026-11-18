import { getCommissionAmount } from '@/shared/utils/commission';

/**
 * How the foreign currency's USD rate is quoted:
 * - 'foreign-per-usd': 1 USD = X foreign (AED 3.67)
 * - 'usd-per-foreign': 1 foreign = X USD (CHF 1.1862)
 * The calculator takes the quote as the source shows it, so the user never inverts by hand.
 */
export type RateQuote = 'foreign-per-usd' | 'usd-per-foreign';

export type PriceCalcInput = {
 /** Amount of the foreign currency (e.g. 100,000 AED). May be 0 — the price still computes. */
 amount: number;
 /** The foreign currency's rate against USD, read according to `rateQuote`. */
 rate: number;
 rateQuote: RateQuote;
 /**
  * Commission in percent, SIGNED: positive adds it to the USD value (+0.5 → ×1.005),
  * negative deducts it (−3.7 → ×0.963). Same sign-is-direction convention as every other
  * commission in the app (see CommissionDirectionToggle).
  */
 commissionPct: number;
 /** How many units of the main currency one USD buys (e.g. MAD 10.45). */
 mainPerUsd: number;
};

export type PriceCalcResult = {
 /** Price of 1 unit of the foreign currency in the main currency, commission included. */
 price: number;
 /** The amount converted to USD, before commission. */
 usdBase: number;
 /** The signed commission in USD (negative when deducted). */
 commissionUsd: number;
 /** The amount converted to USD, commission included. */
 usdValue: number;
 /** The amount converted to the main currency, commission included. */
 mainValue: number;
};

// Generalizes the user's sheet formula
//   (((amount/fxUsd) + (amount/fxUsd)*commission%) * mainUsd) / amount
// to either rate quote and a signed commission. The amount cancels out of the price, so it
// is computed per unit and the price shows even before an amount is typed. Returns null when
// either rate is missing (the sheet's blank cell).
export function computePrice({ amount, rate, rateQuote, commissionPct, mainPerUsd }: PriceCalcInput): PriceCalcResult | null {
 if (!Number.isFinite(rate) || !Number.isFinite(mainPerUsd) || rate <= 0 || mainPerUsd <= 0) return null;
 const pct = Number.isFinite(commissionPct) ? commissionPct : 0;
 const safeAmount = Number.isFinite(amount) ? amount : 0;

 // Converting with the quote as given (rather than pre-inverting it) avoids the rounding a
 // hand-typed inverse introduces (1 / 1.1862 = 0.84303…, not 0.8414).
 const usdPerUnit = rateQuote === 'usd-per-foreign' ? rate : 1 / rate;
 const price = (usdPerUnit + getCommissionAmount(usdPerUnit, pct)) * mainPerUsd;

 const usdBase = safeAmount * usdPerUnit;
 const commissionUsd = getCommissionAmount(usdBase, pct);
 const usdValue = usdBase + commissionUsd;
 return { price, usdBase, commissionUsd, usdValue, mainValue: usdValue * mainPerUsd };
}
