import type { TransactionTableRow } from '@/shared/types';
import type { ArchiveExportModalState } from '@/features/transactions/store/transactionsStore';

// Resolves which archive rows an export range covers, shared by the export dialog's count
// preview and the actual export so they can never diverge. Two mutually-exclusive modes:
//   • Row boundaries set (the "range between highlighted rows" shortcut): an inclusive
//     positional slice of the displayed order. This is exact and independent of the sort
//     direction — using a date window here would break when the archive is sorted newest-first
//     (the first highlighted row would have a later date than the last).
//   • Otherwise: an inclusive date window over the displayed rows.
export function selectArchiveExportRows(rows: TransactionTableRow[], range: ArchiveExportModalState): TransactionTableRow[] {
 if (range.fromRowId != null || range.toRowId != null) {
  const startIdx = range.fromRowId != null ? Math.max(0, rows.findIndex((row) => row.id === range.fromRowId)) : 0;
  const endRaw = range.toRowId != null ? rows.findIndex((row) => row.id === range.toRowId) : -1;
  const endIdx = endRaw === -1 ? rows.length - 1 : endRaw;
  return startIdx <= endIdx ? rows.slice(startIdx, endIdx + 1) : [];
 }
 return rows.filter((row) => {
  const d = row.createdAt.slice(0, 10);
  return (!range.fromDate || d >= range.fromDate) && (!range.toDate || d <= range.toDate);
 });
}
