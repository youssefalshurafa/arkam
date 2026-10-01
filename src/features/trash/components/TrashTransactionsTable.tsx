'use client';

import { useMemo, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import type { TrashTransactionRow, WorkspaceRole } from '@/lib/accountingApi';
import { tableWrapClassName } from '@/shared/styles';
import { chargeAmount } from '@/shared/utils/commission';
import { formatDateValue } from '@/shared/utils/date';
import { formatRateValue } from '@/shared/utils/format';
import { transactionTypeLabelKey } from '@/shared/utils/transactionType';
import { useTransactionsStore } from '@/features/transactions/store/transactionsStore';
import { canPurge, canRestoreTransaction, daysRemaining, isExpiringSoon, searchTrashTransactions } from '@/features/trash/utils/trash';

type Props = {
 rows: TrashTransactionRow[];
 truncated: boolean;
 role: WorkspaceRole | null;
 sessionUserId: string | null;
 serverNow: string;
 retentionDays: number;
 busy: boolean;
 nameFor: (userId: string | null) => string;
 formatDeletedAt: (value: string) => string;
 onRestore: (rows: TrashTransactionRow[]) => Promise<void>;
 onPurge: (rows: TrashTransactionRow[]) => Promise<void>;
};

const PAGE_SIZES = [25, 50, 100];

/**
 * The Trash's transactions, laid out like the Transactions page table — same columns, honouring
 * that table's column visibility and date format — plus who deleted each row, when it expires,
 * and Restore / Delete permanently per row or for a checked selection. Read-only: a trashed row
 * has to be restored before it can be edited.
 */
export default function TrashTransactionsTable({
 rows,
 truncated,
 role,
 sessionUserId,
 serverNow,
 retentionDays,
 busy,
 nameFor,
 formatDeletedAt,
 onRestore,
 onPurge,
}: Props) {
 const { language, isRTL } = useLanguage();
 const { t } = useTranslation(language);
 const numLocale = language === 'fr' ? 'en-US' : language;
 const { columns, dateFormat } = useTransactionsStore((s) => s.transactionTableSettings);
 const [search, setSearch] = useState('');
 const [page, setPage] = useState(1);
 const [pageSize, setPageSize] = useState(50);
 const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

 const allowPurge = canPurge(role);
 const filtered = useMemo(() => searchTrashTransactions(rows, search), [rows, search]);
 const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
 const currentPage = Math.min(page, totalPages);
 const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
 // Only rows still in the Trash count — a restore or purge drops them from `rows` on refetch.
 const selectedRows = rows.filter((row) => selectedIds.has(row.id));
 const restorableSelected = selectedRows.filter((row) => canRestoreTransaction(role, sessionUserId, row));
 const allPageSelected = pageRows.length > 0 && pageRows.every((row) => selectedIds.has(row.id));

 const thClass = `px-3 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`;

 function toggleRow(id: number) {
  setSelectedIds((current) => {
   const next = new Set(current);
   if (next.has(id)) next.delete(id);
   else next.add(id);
   return next;
  });
 }

 function togglePage() {
  setSelectedIds((current) => {
   const next = new Set(current);
   for (const row of pageRows) {
    if (allPageSelected) next.delete(row.id);
    else next.add(row.id);
   }
   return next;
  });
 }

 async function runOnSelection(action: (rows: TrashTransactionRow[]) => Promise<void>, target: TrashTransactionRow[]) {
  await action(target);
  setSelectedIds(new Set());
 }

 const party = (name: string, currency: string, fallback: string) =>
  name ? (
   <>
    {name} <span className="text-xs font-normal text-fg-faint">{currency}</span>
   </>
  ) : fallback ? (
   <span className="italic text-fg-faint">{fallback}</span>
  ) : (
   <span className="text-fg-faint">-</span>
  );

 const payerLabel = (row: TrashTransactionRow, payer: string | null) => {
  switch (payer) {
   case 'from':
    return row.clientFromName;
   case 'to':
    return row.clientToName;
   case 'me_to_from':
    return t('charges_payer_me_to_name', { name: row.clientFromName });
   case 'me_to_to':
    return t('charges_payer_me_to_name', { name: row.clientToName });
   case 'from_to_me':
    return t('charges_payer_name_to_me', { name: row.clientFromName });
   case 'to_to_me':
    return t('charges_payer_name_to_me', { name: row.clientToName });
   default:
    return '';
  }
 };

 if (rows.length === 0) {
  return <p className="text-sm text-fg-faint">{t('trash_no_transactions')}</p>;
 }

 return (
  <div>
   <div className="flex flex-wrap items-center gap-2">
    <input
     type="search"
     value={search}
     onChange={(event) => {
      setSearch(event.target.value);
      setPage(1);
     }}
     placeholder={t('trash_search_placeholder')}
     className="min-w-0 flex-1 rounded border border-border-strong bg-surface px-3 py-1.5 text-sm text-fg outline-none ring-blue-300 focus:ring sm:max-w-xs"
    />
    {selectedRows.length > 0 ? (
     <div className="flex flex-wrap items-center gap-2">
      {restorableSelected.length > 0 ? (
       <button
        type="button"
        onClick={() => void runOnSelection(onRestore, restorableSelected)}
        disabled={busy}
        className="rounded border border-accent bg-accent px-3 py-1.5 text-xs font-semibold text-accent-contrast transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
       >
        {t('trash_restore_selected', { count: restorableSelected.length })}
       </button>
      ) : null}
      {allowPurge ? (
       <button
        type="button"
        onClick={() => void runOnSelection(onPurge, selectedRows)}
        disabled={busy}
        className="rounded border border-border-strong px-3 py-1.5 text-xs font-semibold text-bad-text transition hover:bg-bad-bg disabled:cursor-not-allowed disabled:opacity-50"
       >
        {t('trash_delete_selected', { count: selectedRows.length })}
       </button>
      ) : null}
      <button type="button" onClick={() => setSelectedIds(new Set())} className="text-xs font-medium text-accent hover:underline">
       {t('clear_selection')}
      </button>
     </div>
    ) : null}
   </div>

   {truncated ? <p className="mt-2 text-xs text-warn-text">{t('trash_truncated', { count: rows.length })}</p> : null}

   <div className={`${tableWrapClassName} max-h-[70vh] overflow-y-auto`}>
    <table className="w-full text-sm">
     <thead className="sticky top-0 z-20 bg-surface-hover text-fg-muted">
      <tr>
       <th className="w-px whitespace-nowrap px-2 py-3">
        <input type="checkbox" checked={allPageSelected} onChange={togglePage} aria-label={t('trash_select_page')} className="h-4 w-4 cursor-pointer rounded border-border-strong" />
       </th>
       <th className="w-px px-2 py-3" aria-label={t('actions')} />
       {columns.created ? <th className={thClass}>{t('date')}</th> : null}
       {columns.description ? <th className={thClass}>{t('transaction_description')}</th> : null}
       {columns.type ? <th className={thClass}>{t('transaction_type')}</th> : null}
       {columns.accountFrom ? <th className={thClass}>{t('transaction_account_from')}</th> : null}
       {columns.accountTo ? <th className={thClass}>{t('transaction_account_to')}</th> : null}
       {columns.amount ? <th className={thClass}>{t('transaction_amount')}</th> : null}
       {columns.exchangeRate ? <th className={thClass}>{t('transaction_exchange_rate')}</th> : null}
       {columns.charges ? <th className={thClass}>{t('charges')}</th> : null}
       {columns.commission ? <th className={thClass}>{t('commission')}</th> : null}
       <th className={thClass}>{t('trash_col_deleted')}</th>
      </tr>
     </thead>
     <tbody>
      {pageRows.length === 0 ? (
       <tr>
        <td colSpan={12} className="px-4 py-6 text-center text-sm text-fg-faint">
         {t('trash_no_matches')}
        </td>
       </tr>
      ) : null}
      {pageRows.map((row, index) => {
       const days = daysRemaining(row.deletedAt, serverNow, retentionDays);
       const allowRestore = canRestoreTransaction(role, sessionUserId, row);
       const charges = ([1, 2] as const)
        .map((slot) => ({
         amount: chargeAmount(slot === 1 ? row.charges : row.charges2),
         currency: slot === 1 ? row.chargesCurrencyCode : row.charges2CurrencyCode,
         payer: payerLabel(row, slot === 1 ? row.chargesPayer : row.chargesPayer2),
        }))
        .filter((charge) => charge.amount);
       const commissions = [
        row.commissionFrom ? `${row.clientFromName}: ${formatRateValue(row.commissionFrom)}%` : '',
        row.commissionTo ? `${row.clientToName}: ${formatRateValue(row.commissionTo)}%` : '',
       ].filter(Boolean);
       return (
        <tr key={row.id} className={`border-t border-border align-top transition-colors hover:bg-surface-hover ${index % 2 === 1 ? 'bg-surface-2' : 'bg-surface'}`}>
         <td className="w-px whitespace-nowrap px-2 py-3 align-middle">
          <input
           type="checkbox"
           checked={selectedIds.has(row.id)}
           onChange={() => toggleRow(row.id)}
           aria-label={t('trash_select_row')}
           className="h-4 w-4 cursor-pointer rounded border-border-strong"
          />
         </td>
         <td className="whitespace-nowrap px-2 py-3">
          <div className="flex items-center gap-1.5">
           {allowRestore ? (
            <button
             type="button"
             onClick={() => void onRestore([row])}
             disabled={busy || row.pastEditLocked}
             title={row.pastEditLocked ? t('trash_restore_past_locked') : row.touchesReconciled ? t('trash_touches_reconciled') : undefined}
             className="rounded border border-accent bg-accent px-2.5 py-1 text-xs font-semibold text-accent-contrast transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
            >
             {t('trash_restore')}
            </button>
           ) : null}
           {allowPurge ? (
            <button
             type="button"
             onClick={() => void onPurge([row])}
             disabled={busy}
             title={t('trash_delete_forever')}
             aria-label={t('trash_delete_forever')}
             className="rounded p-1 text-bad-text transition hover:bg-bad-bg disabled:cursor-not-allowed disabled:opacity-50"
            >
             <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
             </svg>
            </button>
           ) : null}
          </div>
         </td>
         {columns.created ? <td className="whitespace-nowrap px-3 py-3 text-fg-faint">{formatDateValue(row.createdAt, dateFormat)}</td> : null}
         {columns.description ? <td className="min-w-28 px-3 py-3 text-fg-muted">{row.description || <span className="text-fg-faint">-</span>}</td> : null}
         {columns.type ? <td className="whitespace-nowrap px-3 py-3 text-fg-muted">{t(transactionTypeLabelKey(row.type))}</td> : null}
         {columns.accountFrom ? (
          <td className="whitespace-nowrap px-3 py-3 font-medium text-fg">
           {party(row.clientFromName, row.accountFromCurrencySymbol || row.accountFromCurrencyCode, row.accountFromId ? '' : row.counterParty)}
          </td>
         ) : null}
         {columns.accountTo ? (
          <td className="whitespace-nowrap px-3 py-3 font-medium text-fg">
           {party(row.clientToName, row.accountToCurrencySymbol || row.accountToCurrencyCode, row.accountToId ? '' : row.counterParty)}
          </td>
         ) : null}
         {columns.amount ? (
          <td className="whitespace-nowrap px-3 py-3 text-fg-muted">
           <span className="font-semibold">{row.amount.toLocaleString(numLocale)}</span> <span className="text-fg-faint">{row.currencySymbol || row.currencyCode}</span>
          </td>
         ) : null}
         {columns.exchangeRate ? (
          <td className="whitespace-nowrap px-3 py-3 text-fg-muted">
           {row.exchangeRateFrom !== 1 || row.exchangeRateTo !== 1 ? (
            <div className="space-y-0.5 text-xs">
             {row.exchangeRateFrom !== 1 ? (
              <div>
               {row.clientFromName}: {formatRateValue(row.exchangeRateFromReversed ? 1 / row.exchangeRateFrom : row.exchangeRateFrom)}
              </div>
             ) : null}
             {row.exchangeRateTo !== 1 ? (
              <div>
               {row.clientToName}: {formatRateValue(row.exchangeRateToReversed ? 1 / row.exchangeRateTo : row.exchangeRateTo)}
              </div>
             ) : null}
            </div>
           ) : (
            <span className="text-fg-faint">-</span>
           )}
          </td>
         ) : null}
         {columns.charges ? (
          <td className="px-3 py-3 text-fg-muted">
           {charges.length ? (
            <div className="flex flex-col gap-2">
             {charges.map((charge, i) => (
              <div key={i}>
               <span className="whitespace-nowrap">
                {charge.amount.toLocaleString(numLocale)}
                {charge.currency ? <span className="text-fg-faint"> {charge.currency}</span> : null}
               </span>
               {charge.payer ? <div className="text-xs text-fg-faint">{charge.payer}</div> : null}
              </div>
             ))}
            </div>
           ) : (
            <span className="text-fg-faint">-</span>
           )}
          </td>
         ) : null}
         {columns.commission ? (
          <td className="px-3 py-3 text-fg-muted">
           {commissions.length ? (
            <div className="space-y-0.5 text-xs">
             {commissions.map((text, i) => (
              <div key={i}>{text}</div>
             ))}
            </div>
           ) : (
            <span className="text-fg-faint">-</span>
           )}
          </td>
         ) : null}
         <td className="px-3 py-3 text-xs text-fg-muted">
          <div className="whitespace-nowrap font-medium text-fg">{nameFor(row.deletedBy)}</div>
          <div className="whitespace-nowrap text-fg-faint">{formatDeletedAt(row.deletedAt)}</div>
          <span
           className={`mt-1 inline-block whitespace-nowrap rounded-full px-2 py-0.5 font-semibold ${
            isExpiringSoon(days) ? 'bg-warn-bg text-warn-text' : 'bg-surface-2 text-fg-muted'
           }`}
          >
           {days === 0 ? t('trash_expires_today') : t('trash_days_left', { count: days })}
          </span>
         </td>
        </tr>
       );
      })}
     </tbody>
    </table>
   </div>

   {filtered.length > PAGE_SIZES[0] ? (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
     <div className="text-xs text-fg-muted">
      {(currentPage - 1) * pageSize + 1}–{Math.min(filtered.length, currentPage * pageSize)} {t('pagination_of')} {filtered.length}
     </div>
     <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-fg-faint">{t('pagination_per_page')}</span>
      <select
       value={pageSize}
       onChange={(event) => {
        setPageSize(Number(event.target.value));
        setPage(1);
       }}
       className="rounded border border-border-strong bg-surface px-1.5 py-1 text-xs text-fg outline-none ring-blue-300 focus:ring"
      >
       {PAGE_SIZES.map((size) => (
        <option key={size} value={size}>
         {size}
        </option>
       ))}
      </select>
      <button
       type="button"
       onClick={() => setPage(Math.max(1, currentPage - 1))}
       disabled={currentPage <= 1}
       className="rounded border border-border-strong px-2 py-1 text-xs font-semibold text-fg-muted transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
       {t('pagination_prev')}
      </button>
      <span className="text-xs text-fg-faint">
       {currentPage} / {totalPages}
      </span>
      <button
       type="button"
       onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
       disabled={currentPage >= totalPages}
       className="rounded border border-border-strong px-2 py-1 text-xs font-semibold text-fg-muted transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
       {t('pagination_next')}
      </button>
     </div>
    </div>
   ) : null}
  </div>
 );
}
