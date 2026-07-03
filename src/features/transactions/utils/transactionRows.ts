import type { ClientAccount, ClientAdjustment, Section, Transaction, TransactionTableRow } from '@/shared/types';

// Combines transactions with adjustment-derived rows and sorts by date (then id).
// Ported verbatim from the page's transactionTableRows memo.
export function buildTransactionTableRows({ adjustments, clientAccounts, transactions, txSortDir }: {
 adjustments: ClientAdjustment[];
 clientAccounts: ClientAccount[];
 transactions: Transaction[];
 txSortDir: 'asc' | 'desc';
}): TransactionTableRow[] {
  const adjustmentRows = adjustments.map((adjustment) => {
   const account = clientAccounts.find((currentAccount) => currentAccount.id === adjustment.accountId);

   return {
    id: -adjustment.id,
    adjustmentId: adjustment.id,
    isAdjustment: true,
    adjustmentDirection: adjustment.direction,
    accountFromId: adjustment.accountId,
    clientFromName: account?.clientName || '',
    accountFromCurrencyCode: account?.currencyCode || '',
    accountFromCurrencySymbol: account?.currencySymbol || '',
    accountToId: 0,
    clientToName: '',
    accountToCurrencyCode: '',
    accountToCurrencySymbol: '',
    currencyId: adjustment.currencyId ?? account?.currencyId ?? 0,
    currencyCode: adjustment.currencyCode || account?.currencyCode || '',
    currencySymbol: adjustment.currencySymbol || account?.currencySymbol || '',
    amount: adjustment.amount,
    type: 'adjustment',
    exchangeRateFrom: adjustment.exchangeRate || 1,
    commissionFrom: 0,
    exchangeRateTo: 1,
    commissionTo: 0,
    exchangeRateFromReversed: adjustment.exchangeRateReversed ? 1 : 0,
    exchangeRateToReversed: 0,
    charges: 0,
    chargesCurrencyId: null,
    chargesCurrencyCode: null,
    chargesCurrencySymbol: null,
    chargesPayer: '',
    chargesExchangeRate: 1,
    chargesDescription: '',
    description: adjustment.description,
    archiveNote: '',
    isArchived: 0,
    createdAt: adjustment.createdAt,
   };
  });

  return ([...transactions, ...adjustmentRows] as TransactionTableRow[]).sort((left, right) => {
   const dateDiff = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
   if (dateDiff !== 0) return txSortDir === 'desc' ? dateDiff : -dateDiff;
   // Stable tiebreaker: higher DB id = inserted later = shown first within the same date
   const leftId = left.isAdjustment ? (left.adjustmentId ?? 0) : left.id;
   const rightId = right.isAdjustment ? (right.adjustmentId ?? 0) : right.id;
   return txSortDir === 'desc' ? rightId - leftId : leftId - rightId;
  });
}

// Applies manual ordering, the archive/transactions split, and the active filters.
// Ported verbatim from the page's displayedTransactionRows memo.
export function filterDisplayedTransactionRows({ transactionTableRows, manualRowOrder, section, txFilterSearch, txFilterClient, txFilterDateFrom, txFilterDateTo }: {
 transactionTableRows: TransactionTableRow[];
 manualRowOrder: number[] | null;
 section: Section;
 txFilterSearch: string;
 txFilterClient: string;
 txFilterDateFrom: string;
 txFilterDateTo: string;
}): TransactionTableRow[] {
  const ordered = (() => {
   if (!manualRowOrder) return transactionTableRows;
   const rowMap = new Map(transactionTableRows.map((r) => [r.id, r]));
   return manualRowOrder.flatMap((id) => {
    const row = rowMap.get(id);
    return row ? [row] : [];
   });
  })();
  let filtered =
   section === 'archive' ? ordered.filter((row) => row.isArchived || (!row.isAdjustment && (!row.accountFromId || !row.accountToId))) : ordered.filter((row) => !row.isArchived);
  if (txFilterSearch) {
   const q = txFilterSearch.toLowerCase();
   // Amount matching ignores thousands separators/spaces, so "500,000" and
   // "500000" both match the stored numeric amount.
   const amountQ = q.replace(/[,\s]/g, '');
   filtered = filtered.filter(
    (row) =>
     row.clientFromName.toLowerCase().includes(q) ||
     row.clientToName.toLowerCase().includes(q) ||
     row.description.toLowerCase().includes(q) ||
     (amountQ !== '' && String(row.amount).includes(amountQ)),
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
  return filtered;
}
