import { describe, expect, it } from 'vitest';
import { formatAmount, groupDigits } from './numberFormat';

describe('groupDigits', () => {
 it('groups by 3 normally', () => {
  expect(groupDigits('1600540', 3, ',')).toBe('1,600,540');
  expect(groupDigits('100', 3, ',')).toBe('100');
 });

 // The two examples the setting was asked for.
 it('puts a 4-digit group on the right and 3s to its left', () => {
  expect(groupDigits('1600540', 4, ',')).toBe('160,0540');
  expect(groupDigits('12000000', 4, ',')).toBe('1,200,0000');
  expect(groupDigits('1234', 4, ',')).toBe('1234');
  expect(groupDigits('12345', 4, ',')).toBe('1,2345');
  expect(groupDigits('123456789012', 4, ',')).toBe('12,345,678,9012');
 });

 it('handles Arabic-Indic digits without a leading separator', () => {
  expect(groupDigits('١٦٠٠٥٤٠', 4, '٬')).toBe('١٦٠٬٠٥٤٠');
  expect(groupDigits('٦٠٠٥٤٠', 3, '٬')).toBe('٦٠٠٬٥٤٠');
 });
});

describe('formatAmount', () => {
 const grouping = { IQD: 4 };

 it('matches toLocaleString for currencies on the normal grouping', () => {
  expect(formatAmount(1600540.5, 'en-US', 'USD', { maximumFractionDigits: 2 }, grouping)).toBe((1600540.5).toLocaleString('en-US', { maximumFractionDigits: 2 }));
  expect(formatAmount(1600540, 'en-US', null, undefined, grouping)).toBe('1,600,540');
  expect(formatAmount(1600540, 'en-US', 'IQD', undefined, {})).toBe('1,600,540');
 });

 it('regroups a configured currency, keeping sign and decimals', () => {
  expect(formatAmount(1600540, 'en-US', 'IQD', undefined, grouping)).toBe('160,0540');
  expect(formatAmount(-12000000.25, 'en-US', 'IQD', { maximumFractionDigits: 2 }, grouping)).toBe('-1,200,0000.25');
  expect(formatAmount(999, 'en-US', 'IQD', undefined, grouping)).toBe('999');
 });
});
