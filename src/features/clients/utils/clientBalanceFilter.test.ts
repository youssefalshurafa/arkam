import { describe, expect, it } from 'vitest';
import type { ClientBalanceEntry } from './clientBalances';
import { balanceMatchesSearch, clientMatchesBalanceRange, emptyBalanceRangeFilter, isBalanceRangeActive } from './clientBalanceFilter';

const USD = 1;
const TRY = 2;
const entry = (balance: number, currencyId = USD): ClientBalanceEntry => ({ accountId: currencyId * 100, currencyId, currencyCode: currencyId === USD ? 'USD' : 'TRY', currencySymbol: '', balance });
const range = (overrides: Partial<ReturnType<typeof emptyBalanceRangeFilter>>) => ({ ...emptyBalanceRangeFilter(), ...overrides });

describe('balanceMatchesSearch', () => {
 it('matches a bare number against the balance as displayed, as a contains', () => {
  expect(balanceMatchesSearch([entry(25000.4)], '25000')).toBe(true);
  expect(balanceMatchesSearch([entry(25000.4)], '250')).toBe(true);
  expect(balanceMatchesSearch([entry(-25000)], '25,000')).toBe(true);
  expect(balanceMatchesSearch([entry(1200)], '25000')).toBe(false);
 });

 it('applies ranges and bounds exactly, on the magnitude', () => {
  expect(balanceMatchesSearch([entry(30000)], '20000-40000')).toBe(true);
  expect(balanceMatchesSearch([entry(-30000)], '20000-40000')).toBe(true);
  expect(balanceMatchesSearch([entry(50000)], '20000-40000')).toBe(false);
  expect(balanceMatchesSearch([entry(50000)], '>40000')).toBe(true);
  expect(balanceMatchesSearch([entry(500)], '<=500')).toBe(true);
 });

 it('matches when any one of the client\'s currency balances matches', () => {
  expect(balanceMatchesSearch([entry(10), entry(30000, TRY)], '20000-40000')).toBe(true);
 });

 it('ignores text that is not a number query, leaving name search to answer it', () => {
  expect(balanceMatchesSearch([entry(30000)], 'Ahmed')).toBe(false);
  expect(balanceMatchesSearch([entry(30000)], '')).toBe(false);
  expect(balanceMatchesSearch([], '30000')).toBe(false);
 });
});

describe('clientMatchesBalanceRange', () => {
 it('is inactive, and matches everyone, when nothing is set', () => {
  expect(isBalanceRangeActive(emptyBalanceRangeFilter())).toBe(false);
  expect(clientMatchesBalanceRange([], emptyBalanceRangeFilter())).toBe(true);
 });

 it('keeps balances between min and max, inclusive, either sign', () => {
  const filter = range({ min: '20000', max: '40000' });
  expect(clientMatchesBalanceRange([entry(20000)], filter)).toBe(true);
  expect(clientMatchesBalanceRange([entry(40000)], filter)).toBe(true);
  expect(clientMatchesBalanceRange([entry(-30000)], filter)).toBe(true);
  expect(clientMatchesBalanceRange([entry(19999.99)], filter)).toBe(false);
  expect(clientMatchesBalanceRange([entry(40000.01)], filter)).toBe(false);
 });

 it('treats a blank bound as open and swaps bounds entered backwards', () => {
  expect(clientMatchesBalanceRange([entry(1_000_000)], range({ min: '20000' }))).toBe(true);
  expect(clientMatchesBalanceRange([entry(5)], range({ max: '100' }))).toBe(true);
  expect(clientMatchesBalanceRange([entry(30000)], range({ min: '40000', max: '20000' }))).toBe(true);
  expect(clientMatchesBalanceRange([entry(30000)], range({ min: '20,000', max: '40,000' }))).toBe(true);
 });

 it('narrows by direction: owes us = negative, we owe = positive, zero is neither', () => {
  expect(clientMatchesBalanceRange([entry(-30000)], range({ min: '20000', max: '40000', direction: 'owes_us' }))).toBe(true);
  expect(clientMatchesBalanceRange([entry(30000)], range({ min: '20000', max: '40000', direction: 'owes_us' }))).toBe(false);
  expect(clientMatchesBalanceRange([entry(30000)], range({ direction: 'we_owe' }))).toBe(true);
  expect(clientMatchesBalanceRange([entry(0)], range({ direction: 'we_owe' }))).toBe(false);
  expect(clientMatchesBalanceRange([entry(0)], range({ direction: 'owes_us' }))).toBe(false);
 });

 it('narrows by currency, and every condition must hold on the SAME balance', () => {
  // 30,000 is in range but in TRY; the USD balance is USD but out of range.
  const balances = [entry(10, USD), entry(30000, TRY)];
  expect(clientMatchesBalanceRange(balances, range({ min: '20000', max: '40000', currencyId: USD }))).toBe(false);
  expect(clientMatchesBalanceRange(balances, range({ min: '20000', max: '40000', currencyId: TRY }))).toBe(true);
 });
});
