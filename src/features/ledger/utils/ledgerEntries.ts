import type { ClientLedgerEntry } from '@/shared/types';
import { amountMatchesSearch, textMatchesSearch } from '@/shared/utils/searchMatch';

// Stable identifier for a ledger entry (used to pick exact start/end boundaries for PDF export).
export function ledgerEntryKey(entry: ClientLedgerEntry) {
 return entry.isAdjustment ? `a-${entry.adjustmentId}` : `t-${entry.transactionId}`;
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

// Key for a per-account ledger transaction draft (transaction id scoped to the account).
export function getLedgerTransactionDraftKey(transactionId: number, ledgerAccountId: number) {
 return `${transactionId}:${ledgerAccountId}`;
}
