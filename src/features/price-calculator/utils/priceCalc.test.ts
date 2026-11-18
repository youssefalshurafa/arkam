import { describe, expect, it } from 'vitest';
import { computePrice } from './priceCalc';

describe('computePrice', () => {
 it('reproduces the AED → MAD sheet example', () => {
  const result = computePrice({ amount: 100000, foreignPerUsd: 3.67, commissionPct: 0.5, mainPerUsd: 10.45 });
  expect(result).not.toBeNull();
  expect(result!.price.toFixed(3)).toBe('2.862');
  expect(Math.round(result!.mainValue)).toBe(286165);
  expect(Math.round(result!.usdValue)).toBe(27384);
 });

 it('returns null when a rate is missing or zero', () => {
  expect(computePrice({ amount: 100, foreignPerUsd: 0, commissionPct: 0.5, mainPerUsd: 10.45 })).toBeNull();
  expect(computePrice({ amount: 100, foreignPerUsd: 3.67, commissionPct: 0.5, mainPerUsd: 0 })).toBeNull();
  expect(computePrice({ amount: 100, foreignPerUsd: NaN, commissionPct: 0.5, mainPerUsd: 10.45 })).toBeNull();
 });

 it('still computes the price without an amount', () => {
  const result = computePrice({ amount: 0, foreignPerUsd: 3.67, commissionPct: 0.5, mainPerUsd: 10.45 });
  expect(result!.price.toFixed(3)).toBe('2.862');
  expect(result!.mainValue).toBe(0);
  expect(result!.usdValue).toBe(0);
 });

 it('with no commission the price is the plain cross rate', () => {
  const result = computePrice({ amount: 1, foreignPerUsd: 3.67, commissionPct: 0, mainPerUsd: 10.45 });
  expect(result!.price).toBeCloseTo(10.45 / 3.67, 10);
 });

 it('treats an invalid commission as 0', () => {
  const result = computePrice({ amount: 1, foreignPerUsd: 4, commissionPct: NaN, mainPerUsd: 10 });
  expect(result!.price).toBeCloseTo(2.5, 10);
 });
});
