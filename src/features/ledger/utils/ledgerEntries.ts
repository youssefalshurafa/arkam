import type { ClientLedgerEntry, SearchTag } from '@/shared/types';
import { parseAmountQuery } from '@/features/transactions/utils/searchTags';
import { amountMatchesSearch, textMatchesSearch } from '@/shared/utils/searchMatch';

// Stable identifier for a ledger entry (used to pick exact start/end boundaries for PDF export).
export function ledgerEntryKey(entry: ClientLedgerEntry) {
 return `t-${entry.transactionId}`;
}

// Matches the ledger filter bar's free-text search against a single entry's
// counterparty, description, and amount.
export function ledgerEntryMatchesSearch(entry: ClientLedgerEntry, query: string, wholeWord: boolean): boolean {
 if (!query) return true;
 return (
  textMatchesSearch(entry.counterpartyName, query, wholeWord) ||
  textMatchesSearch(entry.description ?? '', query, wholeWord) ||
  amountMatchesSearch(entry.amount, query, wholeWord)
 );
}

// The ledger search box's chips. Same kinds as the Transactions page (searchTags.ts), with one
// difference: every row here already belongs to this client, so a client chip means the
// counterparty — and since a row has only one counterparty, several client chips mean "any of
// them" (ANDing them could never match). Every other chip must match, as on Transactions.
export function ledgerEntryMatchesSearchTags(entry: ClientLedgerEntry, tags: SearchTag[]): boolean {
 const clients = tags.filter((tag) => tag.kind === 'client');
 if (clients.length && !clients.some((tag) => entry.counterpartyName === tag.value)) return false;
 return tags.every((tag) => {
  switch (tag.kind) {
   case 'client':
    return true;
   case 'amount': {
    const matches = parseAmountQuery(tag.value);
    return matches ? matches(Math.abs(entry.amount)) : true;
   }
   case 'description':
    return (entry.description ?? '').toLowerCase().includes(tag.value.toLowerCase());
   case 'currency':
    return entry.currencyCode === tag.value;
  }
 });
}

// Key for a per-account ledger transaction draft (transaction id scoped to the account).
export function getLedgerTransactionDraftKey(transactionId: number, ledgerAccountId: number) {
 return `${transactionId}:${ledgerAccountId}`;
}
