import { describe, expect, it } from 'vitest';
import { computePrice } from './priceCalc';

describe('computePrice', () => {
 it('reproduces the AED → MAD sheet example (commission added)', () => {
  const result = computePrice({ amount: 100000, rate: 3.67, rateQuote: 'foreign-per-usd', commissionPct: 0.5, mainPerUsd: 10.45 });
  expect(result).not.toBeNull();
  expect(result!.price.toFixed(3)).toBe('2.862');
  expect(Math.round(result!.mainValue)).toBe(286165);
  expect(Math.round(result!.usdValue)).toBe(27384);
 });

 it('reproduces the CHF → MAD manual calculation (USD-per-CHF quote, commission deducted)', () => {
  const result = computePrice({ amount: 100000, rate: 1.18619, rateQuote: 'usd-per-foreign', commissionPct: -3.7, mainPerUsd: 10.45 });
  expect(result).not.toBeNull();
  expect(result!.price.toFixed(3)).toBe('11.937');
  expect(Math.round(result!.usdBase)).toBe(118619);
  expect(Math.round(result!.commissionUsd)).toBe(-4389);
  expect(Math.round(result!.usdValue)).toBe(114230);
  expect(result!.mainValue).toBeCloseTo(1193704.5, 0);
 });

 it('gives the same price whichever way the rate is quoted', () => {
  const direct = computePrice({ amount: 500, rate: 3.67, rateQuote: 'foreign-per-usd', commissionPct: 0.5, mainPerUsd: 10.45 });
  const inverse = computePrice({ amount: 500, rate: 1 / 3.67, rateQuote: 'usd-per-foreign', commissionPct: 0.5, mainPerUsd: 10.45 });
  expect(inverse!.price).toBeCloseTo(direct!.price, 10);
  expect(inverse!.mainValue).toBeCloseTo(direct!.mainValue, 6);
 });

 it('returns null when a rate is missing or zero', () => {
  expect(computePrice({ amount: 100, rate: 0, rateQuote: 'foreign-per-usd', commissionPct: 0.5, mainPerUsd: 10.45 })).toBeNull();
  expect(computePrice({ amount: 100, rate: 3.67, rateQuote: 'usd-per-foreign', commissionPct: 0.5, mainPerUsd: 0 })).toBeNull();
  expect(computePrice({ amount: 100, rate: NaN, rateQuote: 'foreign-per-usd', commissionPct: 0.5, mainPerUsd: 10.45 })).toBeNull();
 });

 it('still computes the price without an amount', () => {
  const result = computePrice({ amount: 0, rate: 3.67, rateQuote: 'foreign-per-usd', commissionPct: 0.5, mainPerUsd: 10.45 });
  expect(result!.price.toFixed(3)).toBe('2.862');
  expect(result!.mainValue).toBe(0);
  expect(result!.usdValue).toBe(0);
 });

 it('with no commission the price is the plain cross rate', () => {
  const result = computePrice({ amount: 1, rate: 3.67, rateQuote: 'foreign-per-usd', commissionPct: 0, mainPerUsd: 10.45 });
  expect(result!.price).toBeCloseTo(10.45 / 3.67, 10);
 });

 it('treats an invalid commission (e.g. a lone "-") as 0', () => {
  const result = computePrice({ amount: 1, rate: 4, rateQuote: 'foreign-per-usd', commissionPct: NaN, mainPerUsd: 10 });
  expect(result!.price).toBeCloseTo(2.5, 10);
 });
});
