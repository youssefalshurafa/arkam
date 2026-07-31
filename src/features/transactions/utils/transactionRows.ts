import type { Section, Transaction, TransactionTableRow } from '@/shared/types';
import { amountMatchesSearch, textMatchesSearch } from '@/shared/utils/searchMatch';

// Sorts transactions by date (then id). Ported verbatim from the page's
// transactionTableRows memo.
export function buildTransactionTableRows({ transactions, txSortDir }: {
 transactions: Transaction[];
 txSortDir: 'asc' | 'desc';
}): TransactionTableRow[] {
  return [...transactions].sort((left, right) => {
   const dateDiff = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
   if (dateDiff !== 0) return txSortDir === 'desc' ? dateDiff : -dateDiff;
   // Stable tiebreaker: higher DB id = inserted later = shown first within the same date
   return txSortDir === 'desc' ? right.id - left.id : left.id - right.id;
  });
}

// Applies manual ordering, the archive/transactions split, and the active filters.
// Ported verbatim from the page's displayedTransactionRows memo.
export function filterDisplayedTransactionRows({ transactionTableRows, manualRowOrder, section, txFilterSearch, txFilterWholeWord, txFilterClient, txFilterDateFrom, txFilterDateTo, txFilterHideExpenses, txFilterShowHidden }: {
 transactionTableRows: TransactionTableRow[];
 manualRowOrder: number[] | null;
 section: Section;
 txFilterSearch: string;
 txFilterWholeWord: boolean;
 txFilterClient: string;
 txFilterDateFrom: string;
 txFilterDateTo: string;
 txFilterHideExpenses: boolean;
 txFilterShowHidden: boolean;
}): TransactionTableRow[] {
  const ordered = (() => {
   if (!manualRowOrder) return transactionTableRows;
   const rowMap = new Map(transactionTableRows.map((r) => [r.id, r]));
   return manualRowOrder.flatMap((id) => {
    const row = rowMap.get(id);
    return row ? [row] : [];
   });
  })();
  // A missing party only counts as "incomplete, needs assignment" when the row has no
  // counterParty — an intentionally one-sided transaction (free-text counterparty set) is
  // already complete and shouldn't clutter the Archive's missing-party queue.
  const isArchiveEligible = (row: TransactionTableRow) => row.isArchived || ((!row.accountFromId || !row.accountToId) && !row.counterParty?.trim());
  // Rows the user explicitly hid from the Archive list (see setTransactionArchiveHidden) stay
  // out of it unless "show hidden" is on — a pure display filter, doesn't affect balances.
  let filtered =
   section === 'archive'
    ? ordered.filter((row) => isArchiveEligible(row) && (txFilterShowHidden || !row.archiveHidden))
    : ordered.filter((row) => !row.isArchived);
  if (txFilterSearch) {
   filtered = filtered.filter(
    (row) =>
     textMatchesSearch(row.clientFromName, txFilterSearch, txFilterWholeWord) ||
     textMatchesSearch(row.clientToName, txFilterSearch, txFilterWholeWord) ||
     textMatchesSearch(row.description, txFilterSearch, txFilterWholeWord) ||
     amountMatchesSearch(row.amount, txFilterSearch, txFilterWholeWord),
   );
  }
  if (txFilterClient) {
   filtered = filtered.filter((row) => row.clientFromName === txFilterClient || row.clientToName === txFilterClient);
  }
  if (txFilterDateFrom) {
   filtered = filtered.filter((row) => row.createdAt.slice(0, 10) >= txFilterDateFrom);
  }
  if (txFilterDateTo) {
   filtered = filtered.filter((row) => row.createdAt.slice(0, 10) <= txFilterDateTo);
  }
  if (txFilterHideExpenses) {
   filtered = filtered.filter((row) => row.type !== 'adjustment');
  }
  return filtered;
}
