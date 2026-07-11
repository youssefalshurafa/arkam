'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { formatDateValue } from '@/shared/utils/date';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { useTransactionsStore, type ArchiveExportModalState } from '@/features/transactions/store/transactionsStore';
import { selectArchiveExportRows } from '@/features/transactions/utils/archiveExport';
import type { TransactionTableRow } from '@/shared/types';

type ArchiveExportModalProps = {
 // The archive rows exactly as displayed (filtered + sorted) — the export slices from these.
 displayedTransactionRows: TransactionTableRow[];
 // Highlighted rows keyed by transaction id (shared with the transactions table).
 highlightedTxRows: Map<number, string>;
 onExport: (range: ArchiveExportModalState) => void;
};

// Archive PDF-export dialog. Mirrors the client-ledger export options: an inclusive date
// window plus a one-click "range between highlighted rows" shortcut that narrows the export
// to just the rows between the first and last highlighted archive rows.
export default function ArchiveExportModal({ displayedTransactionRows, highlightedTxRows, onExport }: ArchiveExportModalProps) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const pdfSettings = useSettingsStore((s) => s.pdfSettings);
 const archiveExportModal = useTransactionsStore((s) => s.archiveExportModal);
 const setArchiveExportModal = useTransactionsStore((s) => s.setArchiveExportModal);

 if (!archiveExportModal) return null;
 const modal = archiveExportModal;

 const highlightedRows = displayedTransactionRows.filter((row) => highlightedTxRows.has(row.id));
 const selectedCount = selectArchiveExportRows(displayedTransactionRows, modal).length;
 // The date window only applies when no highlighted range is active; validate it only then.
 const usingRowRange = modal.fromRowId != null || modal.toRowId != null;
 const rangeInvalid = !usingRowRange && (!modal.fromDate || !modal.toDate || modal.fromDate > modal.toDate);

 return (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
   <div className="w-full max-w-md rounded bg-white p-6 shadow-2xl">
    <h3 className="text-lg font-semibold text-slate-900">{t('archive_export_pdf')}</h3>

    <div className="mt-5 flex flex-col gap-4">
     <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('export_date_from')}</label>
      <input
       type="date"
       value={modal.fromDate}
       onChange={(e) => setArchiveExportModal((prev) => (prev ? { ...prev, fromDate: e.target.value, fromRowId: null, toRowId: null } : prev))}
       className="rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
      />
     </div>
     <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('export_date_to')}</label>
      <input
       type="date"
       value={modal.toDate}
       onChange={(e) => setArchiveExportModal((prev) => (prev ? { ...prev, toDate: e.target.value, fromRowId: null, toRowId: null } : prev))}
       className="rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
      />
     </div>

     {/* Shortcut: derive the range from the highlighted rows. Both boundaries are inclusive —
         the first highlighted row is the first exported, the last highlighted row the final one.
         A single highlighted row exports just that row (it's both the first and the last). */}
     {highlightedRows.length >= 1 ? (
      <div className="flex flex-col gap-1">
       <button
        type="button"
        onClick={() => {
         // Boundaries follow display order (first/last highlighted row); the row ids drive the
         // export as a positional slice, while the date fields are set to the min/max of the
         // highlighted dates just so they read coherently regardless of sort direction.
         const first = highlightedRows[0];
         const last = highlightedRows[highlightedRows.length - 1];
         const dates = highlightedRows.map((row) => row.createdAt.slice(0, 10)).sort();
         setArchiveExportModal((prev) =>
          prev ? { ...prev, fromDate: dates[0], toDate: dates[dates.length - 1], fromRowId: first.id, toRowId: last.id } : prev,
         );
        }}
        className="cursor-pointer rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-100"
       >
        {t('export_use_highlights')}
       </button>
       <p className="text-xs text-slate-400">{t('export_use_highlights_hint')}</p>
      </div>
     ) : null}

     {/* When a highlighted range is active, show its boundaries so it's clear what's exported. */}
     {modal.fromRowId != null || modal.toRowId != null
      ? (() => {
         const first = displayedTransactionRows.find((row) => row.id === modal.fromRowId);
         const last = displayedTransactionRows.find((row) => row.id === modal.toRowId);
         const label = (row: TransactionTableRow | undefined) =>
          row ? `${formatDateValue(row.createdAt, pdfSettings.dateFormat)}${row.description ? ` · ${row.description}` : ''}` : '—';
         return (
          <div className="rounded border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-800">
           <div className="truncate">{label(first)}</div>
           <div className="my-0.5 text-amber-400">↓</div>
           <div className="truncate">{label(last)}</div>
          </div>
         );
        })()
      : null}

     <div className="rounded border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
      <div className="flex justify-between">
       <span className="text-slate-500">{t('client_page_transaction_count')}</span>
       <span className="font-semibold text-slate-900">{selectedCount}</span>
      </div>
     </div>
    </div>

    <div className="mt-5 flex justify-end gap-2">
     <button
      type="button"
      onClick={() => setArchiveExportModal(null)}
      className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
     >
      {t('cancel')}
     </button>
     <button
      type="button"
      onClick={() => onExport(modal)}
      disabled={rangeInvalid || selectedCount === 0}
      className="flex items-center gap-1.5 rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-40"
     >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
       <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
       <polyline points="14 2 14 8 20 8" />
      </svg>
      {t('transactions_export_pdf')}
     </button>
    </div>
   </div>
  </div>
 );
}
