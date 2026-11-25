import { formatDateValue } from '@/shared/utils/date';
import { transactionTypeLabelKey } from '@/shared/utils/transactionType';
import type { ClientLedgerEntry, LedgerColumnKey, PdfSettings } from '@/shared/types';

export type LedgerExcelColumn = { key: LedgerColumnKey; header: string; cell: (e: ClientLedgerEntry) => string | number };

// One cell per ledger column, as written to Excel. Shared by the ledger's own Excel export and
// the workspace-wide Excel ZIP (Settings → Database) so a client's sheet reads the same either way.
// Listed in the ledger's default column order; callers reorder to the user's saved order.
export function ledgerExcelColumns(t: (key: string) => string, dateFormat: PdfSettings['dateFormat']): LedgerExcelColumn[] {
 return [
  { key: 'created', header: t('date'), cell: (e) => formatDateValue(e.createdAt, dateFormat) },
  { key: 'counterparty', header: t('counterparty'), cell: (e) => e.counterpartyName },
  { key: 'direction', header: t('direction'), cell: (e) => t(e.direction === 'outgoing' ? 'outgoing' : 'incoming') },
  { key: 'type', header: t('transaction_type'), cell: (e) => t(transactionTypeLabelKey(e.type)) },
  { key: 'amount', header: t('amount'), cell: (e) => e.amount },
  // A reversed rate is shown the way it was entered (1 / stored multiplier); a 0 there would be
  // Infinity, so it's left blank like a pending one.
  { key: 'exchangeRate', header: t('exchange_rate'), cell: (e) => (e.pendingRate ? '' : e.exchangeRateReversed ? (e.exchangeRate ? 1 / e.exchangeRate : '') : e.exchangeRate) },
  { key: 'commission', header: t('commission'), cell: (e) => e.commission },
  { key: 'netChange', header: t('net_change'), cell: (e) => (e.pendingRate ? '' : e.netChange) },
  { key: 'runningBalance', header: t('running_balance'), cell: (e) => e.runningBalance },
  { key: 'currency', header: t('currency'), cell: (e) => e.currencyCode },
  { key: 'description', header: t('transaction_description'), cell: (e) => e.description ?? '' },
 ];
}
