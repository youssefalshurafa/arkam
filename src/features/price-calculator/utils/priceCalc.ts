import { getCommissionAmount } from '@/shared/utils/commission';

export type PriceCalcInput = {
 /** Amount of the foreign currency (e.g. 100,000 AED). May be 0 — the price still computes. */
 amount: number;
 /** How many units of the foreign currency one USD buys (e.g. AED 3.67). */
 foreignPerUsd: number;
 /** Commission in percent, added on top of the USD value (e.g. 0.5). */
 commissionPct: number;
 /** How many units of the main currency one USD buys (e.g. MAD 10.45). */
 mainPerUsd: number;
};

export type PriceCalcResult = {
 /** Price of 1 unit of the foreign currency in the main currency, commission included. */
 price: number;
 /** The amount converted to USD, commission included. */
 usdValue: number;
 /** The amount converted to the main currency, commission included. */
 mainValue: number;
};

// Mirrors the user's sheet formula:
//   (((amount/fxUsd) + (amount/fxUsd)*commission%) * mainUsd) / amount
// The amount cancels out of the price, so it is computed per unit and the price shows even
// before an amount is typed. Returns null when either rate is missing (the sheet's blank cell).
export function computePrice({ amount, foreignPerUsd, commissionPct, mainPerUsd }: PriceCalcInput): PriceCalcResult | null {
 if (!Number.isFinite(foreignPerUsd) || !Number.isFinite(mainPerUsd) || foreignPerUsd <= 0 || mainPerUsd <= 0) return null;
 const pct = Number.isFinite(commissionPct) ? commissionPct : 0;
 const safeAmount = Number.isFinite(amount) ? amount : 0;

 const usdPerUnit = 1 / foreignPerUsd;
 const usdPerUnitWithCommission = usdPerUnit + getCommissionAmount(usdPerUnit, pct);
 const price = usdPerUnitWithCommission * mainPerUsd;

 const usdBase = safeAmount / foreignPerUsd;
 const usdValue = usdBase + getCommissionAmount(usdBase, pct);
 return { price, usdValue, mainValue: usdValue * mainPerUsd };
}
