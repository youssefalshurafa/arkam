import { describe, expect, it } from 'vitest';
import { suggestRoundedBalance } from './accountBalances';

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
