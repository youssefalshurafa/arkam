import type { TransactionTableRow } from '@/shared/types';

/**
 * Advanced-search tags for the Transactions/Archive filter panel. Every tag must match for a
 * row to show (AND), which is what makes combinations like "client X + client Y" (every
 * transaction between the two, either direction) or "client X + amount 500" work.
 */
export type SearchTagKind = 'client' | 'amount' | 'description' | 'currency';

export type SearchTag = { kind: SearchTagKind; value: string };

// Amount tags accept an exact value ("500"), an inclusive range ("100-500"), or a one-sided
// bound (">500", "<500", ">=500", "<=500"). Thousands separators/spaces are ignored, matching
// amountMatchesSearch. Returns null when the text isn't a usable amount query.
export function parseAmountQuery(raw: string): ((amount: number) => boolean) | null {
 const text = raw.replace(/[,\s]/g, '');
 if (!text) return null;
 const bound = /^(>=|<=|>|<)(\d+(?:\.\d+)?)$/.exec(text);
 if (bound) {
  const n = Number(bound[2]);
  switch (bound[1]) {
   case '>': return (amount) => amount > n;
   case '>=': return (amount) => amount >= n;
   case '<': return (amount) => amount < n;
   default: return (amount) => amount <= n;
  }
 }
 const range = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(text);
 if (range) {
  const min = Math.min(Number(range[1]), Number(range[2]));
  const max = Math.max(Number(range[1]), Number(range[2]));
  return (amount) => amount >= min && amount <= max;
 }
 if (/^\d+(?:\.\d+)?$/.test(text)) {
  const n = Number(text);
  return (amount) => amount === n;
 }
 return null;
}

function tagMatches(row: TransactionTableRow, tag: SearchTag): boolean {
 switch (tag.kind) {
  case 'client':
   return row.clientFromName === tag.value || row.clientToName === tag.value;
  case 'amount': {
   const matches = parseAmountQuery(tag.value);
   // Amounts may be negative for some one-sided rows; the user thinks in magnitudes.
   return matches ? matches(Math.abs(row.amount)) : true;
  }
  case 'description': {
   const needle = tag.value.toLowerCase();
   // Split-description rows carry per-side text instead of (or besides) the main one.
   return [row.description, row.descriptionFrom, row.descriptionTo].some((text) => !!text && text.toLowerCase().includes(needle));
  }
  case 'currency':
   return row.currencyCode === tag.value;
 }
}

export function rowMatchesSearchTags(row: TransactionTableRow, tags: SearchTag[]): boolean {
 return tags.every((tag) => tagMatches(row, tag));
}

export function sameSearchTag(a: SearchTag, b: SearchTag): boolean {
 return a.kind === b.kind && a.value === b.value;
}
