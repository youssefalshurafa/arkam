// Shared "search" matching used by the transactions table and client ledger
// filter bars. Supports a plain substring mode and a "whole word or number"
// mode that requires the query to appear as a standalone token.

function escapeRegExp(value: string): string {
 return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// True when `query` occurs in `text` as a standalone token (not embedded inside
// a longer word/number), e.g. "50" matches "50 usd" but not "500".
function isWholeWordMatch(text: string, query: string): boolean {
 const pattern = new RegExp(`(?<![a-zA-Z0-9])${escapeRegExp(query)}(?![a-zA-Z0-9])`, 'i');
 return pattern.test(text);
}

export function textMatchesSearch(text: string, query: string, wholeWord: boolean): boolean {
 if (!query) return true;
 if (!wholeWord) return text.toLowerCase().includes(query.toLowerCase());
 return isWholeWordMatch(text, query);
}

// Amount matching ignores thousands separators/spaces in the query, so "500,000"
// and "500000" both match the stored numeric amount. In whole-word mode the
// normalized query must equal the amount exactly rather than merely appear in it.
export function amountMatchesSearch(amount: number, query: string, wholeWord: boolean): boolean {
 if (!query) return true;
 const normalized = query.replace(/[,\s]/g, '');
 if (normalized === '') return false;
 const amountStr = String(amount);
 return wholeWord ? amountStr === normalized : amountStr.includes(normalized);
}
