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

// A missing party only counts as "incomplete, needs assignment" when the row has no
// counterParty — an intentionally one-sided transaction (free-text counterparty set) is
// already complete and shouldn't clutter the Archive's missing-party queue. Expenses/write-offs
// (type === 'adjustment') are inherently, permanently one-sided by design — not a data gap
// awaiting a second party — so they never belong in this queue regardless of counterParty.
export function isArchiveEligible(row: Transaction): boolean {
 return !!row.isArchived || (row.type !== 'adjustment' && (!row.accountFromId || !row.accountToId) && !row.counterParty?.trim());
}

/**
 * How the Archive treats rows the user hid from it: leave them out (the default), fold them
 * back in alongside everything else, or show nothing but them. The third is what makes hiding
 * reversible in practice — without a hidden-only view, a row that was hidden is gone from the
 * list with no way to look at what you've accumulated.
 */
export type HiddenFilter = 'exclude' | 'include' | 'only';

export function countHiddenArchiveRows(rows: Transaction[]): number {
 return rows.filter((row) => isArchiveEligible(row) && row.archiveHidden).length;
}

function matchesHiddenFilter(row: TransactionTableRow, hiddenFilter: HiddenFilter): boolean {
 if (hiddenFilter === 'include') return true;
 return hiddenFilter === 'only' ? !!row.archiveHidden : !row.archiveHidden;
}

// Applies manual ordering, the archive/transactions split, and the active filters.
// Ported verbatim from the page's displayedTransactionRows memo.
export function filterDisplayedTransactionRows({ transactionTableRows, manualRowOrder, section, txFilterSearch, txFilterWholeWord, txFilterClient, txFilterDateFrom, txFilterDateTo, txFilterHideExpenses, txHiddenFilter }: {
 transactionTableRows: TransactionTableRow[];
 manualRowOrder: number[] | null;
 section: Section;
 txFilterSearch: string;
 txFilterWholeWord: boolean;
 txFilterClient: string;
 txFilterDateFrom: string;
 txFilterDateTo: string;
 txFilterHideExpenses: boolean;
 txHiddenFilter: HiddenFilter;
}): TransactionTableRow[] {
  const ordered = (() => {
   if (!manualRowOrder) return transactionTableRows;
   const rowMap = new Map(transactionTableRows.map((r) => [r.id, r]));
   return manualRowOrder.flatMap((id) => {
    const row = rowMap.get(id);
    return row ? [row] : [];
   });
  })();
  // Rows the user explicitly hid from the Archive list (see setTransactionArchiveHidden). A
  // pure display filter — hiding never touches balances, and a hidden row stays archive-
  // eligible, so 'only' is a complete view of what was hidden rather than a lossy one.
  let filtered =
   section === 'archive'
    ? ordered.filter((row) => isArchiveEligible(row) && matchesHiddenFilter(row, txHiddenFilter))
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
