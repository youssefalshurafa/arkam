import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStoredPriceCalculator, priceCalculatorPairKey, priceCalculatorStorageKey } from './localStorage';

const withStored = (value: unknown) => {
 const store = new Map([[priceCalculatorStorageKey, JSON.stringify(value)]]);
 vi.stubGlobal('window', { localStorage: { getItem: (k: string) => store.get(k) ?? null } });
};

afterEach(() => {
 vi.unstubAllGlobals();
});

describe('getStoredPriceCalculator', () => {
 it('migrates a save from before the bridge currency was selectable (everything through USD)', () => {
  withStored({
   foreignCode: 'CHF',
   amount: '100,000',
   commissionPct: '0.5',
   mainPerUsd: '10.45',
   foreignRates: { AED: '3.67', CHF: '1.1862' },
   foreignQuotes: { CHF: 'usd-per-foreign' },
   commissions: { AED: '0.5', CHF: '-3.7' },
  });
  const s = getStoredPriceCalculator();
  expect(s.foreignCode).toBe('CHF');
  expect(s.amount).toBe('100,000');
  // AED had no stored quote → it was the old default, "1 USD = 3.67 AED".
  expect(s.rates[priceCalculatorPairKey('AED', 'USD')]).toEqual({ base: 'USD', value: '3.67' });
  expect(s.rates[priceCalculatorPairKey('CHF', 'USD')]).toEqual({ base: 'CHF', value: '1.1862' });
  expect(s.commissions).toEqual({ 'AED>USD': '0.5', 'CHF>USD': '-3.7' });
  // The shared main rate and commission stay as fallbacks (the main currency isn't known here).
  expect(s.mainPerUsd).toBe('10.45');
  expect(s.commissionPct).toBe('0.5');
  expect(s.decimals).toBe(3);
  expect(s.bridges).toEqual({});
 });

 it('reads the current shape as is, and drops malformed entries', () => {
  withStored({
   foreignCode: 'SAR',
   amount: '5',
   decimals: 5,
   bridges: { SAR: 'AED', CHF: 7 },
   rates: { 'AED|SAR': { base: 'AED', value: '1.0211' }, 'AED|MAD': { base: 'AED' }, 'MAD|USD': 'x' },
   commissions: { 'SAR>AED': '-1' },
  });
  const s = getStoredPriceCalculator();
  expect(s.decimals).toBe(5);
  expect(s.bridges).toEqual({ SAR: 'AED' });
  expect(s.rates).toEqual({ 'AED|SAR': { base: 'AED', value: '1.0211' } });
  expect(s.commissions).toEqual({ 'SAR>AED': '-1' });
 });

 it('falls back to 3 decimals for an out-of-range value', () => {
  withStored({ decimals: 42 });
  expect(getStoredPriceCalculator().decimals).toBe(3);
  withStored({ decimals: 1.5 });
  expect(getStoredPriceCalculator().decimals).toBe(3);
 });

 it('pair keys ignore direction', () => {
  expect(priceCalculatorPairKey('USD', 'MAD')).toBe(priceCalculatorPairKey('MAD', 'USD'));
 });
});
