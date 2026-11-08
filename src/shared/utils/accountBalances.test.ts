import { describe, expect, it } from 'vitest';
import { isWriteOffEligible, suggestRoundedBalance } from './accountBalances';

describe('suggestRoundedBalance', () => {
 it('rounds to the nearest hundred, keeping the sign', () => {
  expect(suggestRoundedBalance(-6_959_294.02)).toBe(-6_959_300);
  expect(suggestRoundedBalance(-8_079_071.57)).toBe(-8_079_100);
  expect(suggestRoundedBalance(-550_080.6)).toBe(-550_100);
  expect(suggestRoundedBalance(-2_793_612.76)).toBe(-2_793_600);
  expect(suggestRoundedBalance(432_026)).toBe(432_000);
  expect(suggestRoundedBalance(-747)).toBe(-700);
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
