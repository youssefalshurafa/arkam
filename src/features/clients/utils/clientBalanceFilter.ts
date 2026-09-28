import type { ClientBalanceEntry } from '@/features/clients/utils/clientBalances';
import { parseAmountQuery } from '@/features/transactions/utils/searchTags';

/**
 * Balance search for the Clients page — both the plain search box and the advanced range.
 *
 * A client has one balance per currency account; a client matches when ANY of them does. Amounts
 * are compared as magnitudes (the size of the balance, as the user reads it off the chip) — the
 * sign is a separate question ("owes us" vs "we owe"), answered by the range's `direction`.
 * Sign convention, as everywhere on this page: negative = the client owes us (debit, red),
 * positive = we owe the client (credit, green).
 */

const magnitude = (balance: number) => Math.abs(balance);

/**
 * The plain search box's number matching. A range ("20000-40000") or bound (">20000", "<=500")
 * is applied exactly, same syntax as the Transactions advanced search. A bare number matches as
 * text against the balance as displayed (rounded, no separators), so typing "250" finds 25,000
 * as you type — the same contains-behaviour name search has. Returns false for text that isn't
 * a number query at all, so name search stays the only thing that answers "Ahmed".
 */
export function balanceMatchesSearch(entries: ClientBalanceEntry[], query: string): boolean {
 const text = query.replace(/[,\s]/g, '');
 if (!text) return false;
 if (/^\d+(?:\.\d+)?$/.test(text)) {
  return entries.some((entry) => String(Math.round(magnitude(entry.balance))).includes(text) || String(magnitude(entry.balance)).includes(text));
 }
 const matches = parseAmountQuery(text);
 return matches ? entries.some((entry) => matches(magnitude(entry.balance))) : false;
}

export type BalanceDirection = 'any' | 'owes_us' | 'we_owe';

export type BalanceRangeFilter = {
 // Kept as the raw input text so a half-typed value survives re-renders; blank = no bound.
 min: string;
 max: string;
 currencyId: number | null;
 direction: BalanceDirection;
};

export const emptyBalanceRangeFilter = (): BalanceRangeFilter => ({ min: '', max: '', currencyId: null, direction: 'any' });

function parseBound(value: string): number | null {
 const text = value.replace(/[,\s]/g, '');
 if (!text) return null;
 const n = Number(text);
 return Number.isFinite(n) ? Math.abs(n) : null;
}

export function isBalanceRangeActive(filter: BalanceRangeFilter): boolean {
 return parseBound(filter.min) != null || parseBound(filter.max) != null || filter.currencyId != null || filter.direction !== 'any';
}

/**
 * Whether one of the client's balances satisfies every set part of the range: the currency, the
 * direction, and min ≤ |balance| ≤ max (inclusive; a bound left blank is open, and the two are
 * swapped if entered backwards). A zero balance has no direction, so it never matches "owes us"
 * or "we owe".
 */
export function clientMatchesBalanceRange(entries: ClientBalanceEntry[], filter: BalanceRangeFilter): boolean {
 if (!isBalanceRangeActive(filter)) return true;
 let min = parseBound(filter.min);
 let max = parseBound(filter.max);
 if (min != null && max != null && min > max) [min, max] = [max, min];
 return entries.some((entry) => {
  if (filter.currencyId != null && entry.currencyId !== filter.currencyId) return false;
  if (filter.direction === 'owes_us' && !(entry.balance < 0)) return false;
  if (filter.direction === 'we_owe' && !(entry.balance > 0)) return false;
  const size = magnitude(entry.balance);
  if (min != null && size < min) return false;
  if (max != null && size > max) return false;
  return true;
 });
}
