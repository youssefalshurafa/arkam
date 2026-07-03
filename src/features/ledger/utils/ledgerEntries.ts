import type { ClientLedgerEntry } from '@/shared/types';

// Stable identifier for a ledger entry (used to pick exact start/end boundaries for PDF export).
export function ledgerEntryKey(entry: ClientLedgerEntry) {
 return entry.isAdjustment ? `a-${entry.adjustmentId}` : `t-${entry.transactionId}`;
}

// Key for a per-account ledger transaction draft (transaction id scoped to the account).
export function getLedgerTransactionDraftKey(transactionId: number, ledgerAccountId: number) {
 return `${transactionId}:${ledgerAccountId}`;
}
