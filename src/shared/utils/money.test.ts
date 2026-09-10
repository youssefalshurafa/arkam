import { describe, expect, it } from 'vitest';
import { MONEY_EPSILON, isZeroMoney, moneyEquals } from './money';

describe('isZeroMoney', () => {
 it('treats exact zero as zero', () => {
  expect(isZeroMoney(0)).toBe(true);
  expect(isZeroMoney(-0)).toBe(true);
 });

 // The three residuals an actual sweep of this project's production data turned up.
 it('treats real observed drift as zero', () => {
  expect(isZeroMoney(-1.1641532182693481e-10)).toBe(true);
  expect(isZeroMoney(-3.637978807091713e-12)).toBe(true);
 });

 it('keeps a genuine small balance visible', () => {
  // The third production residual. Small enough to write off, far too big to be float noise —
  // it must stay a real balance so the write-off flow handles it, not this predicate.
  expect(isZeroMoney(-0.0032697547680982098)).toBe(false);
  expect(isZeroMoney(0.01)).toBe(false);
 });

 it('is exclusive at the boundary', () => {
  expect(isZeroMoney(MONEY_EPSILON)).toBe(false);
  expect(isZeroMoney(MONEY_EPSILON / 2)).toBe(true);
 });

 it('does not treat non-finite values as zero', () => {
  expect(isZeroMoney(NaN)).toBe(false);
  expect(isZeroMoney(Infinity)).toBe(false);
  expect(isZeroMoney(-Infinity)).toBe(false);
 });

 it('catches the drift a sum of equal-and-opposite amounts leaves behind', () => {
  // 0.1 + 0.2 - 0.3 is the canonical example and lands at ~5.5e-17.
  expect(isZeroMoney(0.1 + 0.2 - 0.3)).toBe(true);
  expect(0.1 + 0.2 - 0.3 === 0).toBe(false);
 });
});

describe('moneyEquals', () => {
 it('ignores drift between two amounts', () => {
  expect(moneyEquals(0.1 + 0.2, 0.3)).toBe(true);
  expect(0.1 + 0.2 === 0.3).toBe(false);
 });

 it('still separates genuinely different amounts', () => {
  expect(moneyEquals(100, 100.01)).toBe(false);
 });
});
