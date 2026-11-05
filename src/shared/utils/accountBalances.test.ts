import { describe, expect, it } from 'vitest';
import { isWriteOffEligible, suggestRoundedBalance } from './accountBalances';

describe('suggestRoundedBalance', () => {
 it('rounds large balances to the nearest hundred, keeping the sign', () => {
  expect(suggestRoundedBalance(-5_407_978)).toBe(-5_408_000);
  expect(suggestRoundedBalance(-2_793_612.76)).toBe(-2_793_600);
  expect(suggestRoundedBalance(432_022)).toBe(432_000);
 });

 it('uses a smaller step for smaller balances', () => {
  expect(suggestRoundedBalance(12_345)).toBe(12_300);
  expect(suggestRoundedBalance(-747)).toBe(-750);
 });

 it('leaves an already round balance unchanged', () => {
  expect(suggestRoundedBalance(2_576_000)).toBe(2_576_000);
 });
});

describe('isWriteOffEligible', () => {
 const margins = new Map([[1, 50]]);

 it('offers a write-off for balances from 1 up to the margin, either sign', () => {
  expect(isWriteOffEligible(1, 1, margins)).toBe(true);
  expect(isWriteOffEligible(-37.5, 1, margins)).toBe(true);
  expect(isWriteOffEligible(50, 1, margins)).toBe(true);
 });

 it('skips sub-unit balances, which already read as 0', () => {
  expect(isWriteOffEligible(0, 1, margins)).toBe(false);
  expect(isWriteOffEligible(0.4, 1, margins)).toBe(false);
  expect(isWriteOffEligible(-0.99, 1, margins)).toBe(false);
 });

 it('skips balances over the margin', () => {
  expect(isWriteOffEligible(50.01, 1, margins)).toBe(false);
 });
});
