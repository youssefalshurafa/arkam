import { describe, expect, it } from 'vitest';
import { computePrice, type PriceCalcInput } from './priceCalc';

// Main currency MAD at "1 USD = 10.45 MAD", the way the user's sheet has it.
const viaUsd = { mainRate: 10.45, mainQuote: 'units-per-bridge' } as const;
const calc = (input: Omit<PriceCalcInput, 'mainRate' | 'mainQuote'> & Partial<PriceCalcInput>) => computePrice({ ...viaUsd, ...input });

describe('computePrice', () => {
 it('reproduces the AED → MAD sheet example (commission added)', () => {
  const result = calc({ amount: 100000, rate: 3.67, rateQuote: 'units-per-bridge', commissionPct: 0.5 });
  expect(result).not.toBeNull();
  expect(result!.price.toFixed(3)).toBe('2.862');
  expect(Math.round(result!.mainValue)).toBe(286165);
  expect(Math.round(result!.bridgeValue)).toBe(27384);
 });

 it('reproduces the CHF → MAD manual calculation (USD-per-CHF quote, commission deducted)', () => {
  const result = calc({ amount: 100000, rate: 1.18619, rateQuote: 'bridge-per-unit', commissionPct: -3.7 });
  expect(result).not.toBeNull();
  expect(result!.price.toFixed(3)).toBe('11.937');
  expect(Math.round(result!.bridgeBase)).toBe(118619);
  expect(Math.round(result!.commissionBridge)).toBe(-4389);
  expect(Math.round(result!.bridgeValue)).toBe(114230);
  expect(result!.mainValue).toBeCloseTo(1193704.5, 0);
 });

 it('gives the same price whichever way the foreign rate is quoted', () => {
  const direct = calc({ amount: 500, rate: 3.67, rateQuote: 'units-per-bridge', commissionPct: 0.5 });
  const inverse = calc({ amount: 500, rate: 1 / 3.67, rateQuote: 'bridge-per-unit', commissionPct: 0.5 });
  expect(inverse!.price).toBeCloseTo(direct!.price, 10);
  expect(inverse!.mainValue).toBeCloseTo(direct!.mainValue, 6);
 });

 it('gives the same price whichever way the main rate is quoted', () => {
  const direct = calc({ amount: 500, rate: 3.67, rateQuote: 'units-per-bridge', commissionPct: 0.5 });
  const inverse = calc({ amount: 500, rate: 3.67, rateQuote: 'units-per-bridge', commissionPct: 0.5, mainRate: 1 / 10.45, mainQuote: 'bridge-per-unit' });
  expect(inverse!.price).toBeCloseTo(direct!.price, 10);
 });

 it('any bridge currency gives the same price as USD for consistent rates (SAR through AED)', () => {
  // 1 USD = 3.75 SAR = 3.6725 AED = 10.45 MAD, so 1 AED = 3.75/3.6725 SAR and 10.45/3.6725 MAD.
  const throughUsd = calc({ amount: 100000, rate: 3.75, rateQuote: 'units-per-bridge', commissionPct: -1 });
  const throughAed = computePrice({
   amount: 100000,
   rate: 3.75 / 3.6725,
   rateQuote: 'units-per-bridge',
   commissionPct: -1,
   mainRate: 10.45 / 3.6725,
   mainQuote: 'units-per-bridge',
  });
  expect(throughAed!.price).toBeCloseTo(throughUsd!.price, 10);
  expect(throughAed!.mainValue).toBeCloseTo(throughUsd!.mainValue, 6);
  expect(throughAed!.bridgeValue).toBeCloseTo((100000 / (3.75 / 3.6725)) * 0.99, 6);
 });

 it('direct pricing is the main currency as its own bridge (main rate 1)', () => {
  // 1 SAR = 2.78 MAD, +0.5% → 2.7939
  const result = computePrice({ amount: 1000, rate: 2.78, rateQuote: 'bridge-per-unit', commissionPct: 0.5, mainRate: 1, mainQuote: 'units-per-bridge' });
  expect(result!.price).toBeCloseTo(2.78 * 1.005, 10);
  expect(result!.mainValue).toBeCloseTo(result!.bridgeValue, 10);
 });

 it('returns null when a rate is missing or zero', () => {
  expect(calc({ amount: 100, rate: 0, rateQuote: 'units-per-bridge', commissionPct: 0.5 })).toBeNull();
  expect(calc({ amount: 100, rate: 3.67, rateQuote: 'bridge-per-unit', commissionPct: 0.5, mainRate: 0 })).toBeNull();
  expect(calc({ amount: 100, rate: NaN, rateQuote: 'units-per-bridge', commissionPct: 0.5 })).toBeNull();
  expect(calc({ amount: 100, rate: 3.67, rateQuote: 'units-per-bridge', commissionPct: 0.5, mainRate: NaN })).toBeNull();
 });

 it('still computes the price without an amount', () => {
  const result = calc({ amount: 0, rate: 3.67, rateQuote: 'units-per-bridge', commissionPct: 0.5 });
  expect(result!.price.toFixed(3)).toBe('2.862');
  expect(result!.mainValue).toBe(0);
  expect(result!.bridgeValue).toBe(0);
 });

 it('with no commission the price is the plain cross rate', () => {
  const result = calc({ amount: 1, rate: 3.67, rateQuote: 'units-per-bridge', commissionPct: 0 });
  expect(result!.price).toBeCloseTo(10.45 / 3.67, 10);
 });

 it('treats an invalid commission (e.g. a lone "-") as 0', () => {
  const result = calc({ amount: 1, rate: 4, rateQuote: 'units-per-bridge', commissionPct: NaN, mainRate: 10 });
  expect(result!.price).toBeCloseTo(2.5, 10);
 });
});
