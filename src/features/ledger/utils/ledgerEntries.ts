import type { ClientLedgerEntry, SearchTag } from '@/shared/types';
import { parseAmountQuery, sameText } from '@/features/transactions/utils/searchTags';
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
 if (clients.length && !clients.some((tag) => sameText(entry.counterpartyName, tag.value))) return false;
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
    return sameText(entry.currencyCode, tag.value);
  }
 });
}

// Key for a per-account ledger transaction draft (transaction id scoped to the account).
export function getLedgerTransactionDraftKey(transactionId: number, ledgerAccountId: number) {
 return `${transactionId}:${ledgerAccountId}`;
}

// The export range the ledger's highlighted rows define, or null when the account has none.
// With 2+ highlights it runs between the last two (both rows included); a single highlight is
// both boundaries, so the export holds just that row. Shared by the Download button (which
// opens the export dialog pre-scoped to this) and the dialog's own "use highlighted rows".
export function highlightedExportRange(entries: ClientLedgerEntry[], ledgerAccountId: number, highlightedRows: Map<string, string>) {
 const highlighted = entries.filter((e) => highlightedRows.has(getLedgerTransactionDraftKey(e.transactionId, ledgerAccountId)));
 if (highlighted.length === 0) return null;
 const last = highlighted[highlighted.length - 1];
 const first = highlighted.length >= 2 ? highlighted[highlighted.length - 2] : last;
 return {
  fromDate: first.createdAt.slice(0, 10),
  toDate: last.createdAt.slice(0, 10),
  fromEntryKey: ledgerEntryKey(first),
  toEntryKey: ledgerEntryKey(last),
 };
}

// Whether a ledger export leaves this row out: the owner flagged it "Hide from PDF" and the
// workspace's switch for that is on. Its balance still counts — the exports keep each shown
// row's real running balance, so the column jumps where a hidden row was.
export function isHiddenFromExport(entry: ClientLedgerEntry, pdfRowHidingEnabled: boolean): boolean {
 return pdfRowHidingEnabled && !!entry.pdfHidden;
}

// The entries a ledger export holds. A sum-mode selection (selectionKeys) is exactly those rows,
// in ledger order. Otherwise it's the date range, narrowed by the start/end transaction pickers
// (handy when a day has many transactions). Shared by the export dialog, PDF and Excel so the
// count the dialog shows is the row count the file gets.
export function selectLedgerExportEntries(
 entries: ClientLedgerEntry[],
 range: { fromDate: string; toDate: string; fromEntryKey?: string | null; toEntryKey?: string | null; selectionKeys?: string[] | null },
): ClientLedgerEntry[] {
 if (range.selectionKeys) {
  const keys = new Set(range.selectionKeys);
  return entries.filter((e) => keys.has(ledgerEntryKey(e)));
 }
 const candidates = entries.filter((e) => {
  const d = e.createdAt.slice(0, 10);
  return d >= range.fromDate && d <= range.toDate;
 });
 const startIdx = range.fromEntryKey ? Math.max(0, candidates.findIndex((e) => ledgerEntryKey(e) === range.fromEntryKey)) : 0;
 const endIdxRaw = range.toEntryKey ? candidates.findIndex((e) => ledgerEntryKey(e) === range.toEntryKey) : -1;
 const endIdx = endIdxRaw === -1 ? candidates.length - 1 : endIdxRaw;
 return startIdx <= endIdx ? candidates.slice(startIdx, endIdx + 1) : [];
}
