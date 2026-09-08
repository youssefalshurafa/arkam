import { describe, expect, it } from 'vitest';
import { copyTextFrom } from './cellCopy';

// The client-name cell renders `{name} <span>{currency}</span>`, so the cell's own text carries the
// account's currency badge after the name. Copying should hand back the name alone.
describe('copyTextFrom', () => {
 it('drops the account currency badge from a client name', () => {
  expect(copyTextFrom('جعيدان dhs', ['dhs'])).toBe('جعيدان');
  expect(copyTextFrom('عبد الرحمن usdt', ['usdt'])).toBe('عبد الرحمن');
 });

 // The reported bug: the old pattern only matched UPPERCASE codes, so a symbol was trimmed while
 // a lowercase code was left behind. Marking the badge removes the guesswork entirely.
 it('handles symbols and lowercase codes alike', () => {
  for (const [text, badge] of [
   ['ابو ريان €', '€'],
   ['العدنان $', '$'],
   ['المرسى dhs', 'dhs'],
   ['نبيل usdt', 'usdt'],
  ] as const) {
   expect(copyTextFrom(text, [badge])).toBe(text.slice(0, text.length - badge.length).trim());
  }
 });

 // The ledger renders its badge parenthesised, which no trailing-currency pattern would have caught.
 it('drops a parenthesised badge', () => {
  expect(copyTextFrom('احمد الفنيدق (dhs)', ['(dhs)'])).toBe('احمد الفنيدق');
 });

 // Why the last occurrence is removed rather than the first.
 it('keeps a name that happens to contain the currency text', () => {
  expect(copyTextFrom('dhs shop dhs', ['dhs'])).toBe('dhs shop');
 });

 it('leaves an unmarked cell to the trailing-currency pattern, as before', () => {
  expect(copyTextFrom('1,462,000 MAD', [])).toBe('1,462,000');
  expect(copyTextFrom('12,000 €', [])).toBe('12,000');
 });

 // A cell that is nothing but a currency should still copy something rather than nothing.
 it('keeps the raw text when trimming would empty the cell', () => {
  expect(copyTextFrom('MAD', [])).toBe('MAD');
 });

 it('collapses the whitespace left behind', () => {
  expect(copyTextFrom('  ابو   ريان   €  ', ['€'])).toBe('ابو ريان');
 });

 it('ignores a badge whose text is not present', () => {
  expect(copyTextFrom('Milano', ['dhs'])).toBe('Milano');
 });

 it('returns empty for an empty cell', () => {
  expect(copyTextFrom('   ', [])).toBe('');
 });
});
