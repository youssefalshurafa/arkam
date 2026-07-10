'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { savePdfCols, savePdfDateRange } from '@/shared/lib/localStorage';
import { formatDateValue } from '@/shared/utils/date';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { ledgerEntryKey, getLedgerTransactionDraftKey } from '@/features/ledger/utils/ledgerEntries';
import { useLedgerStore } from '@/features/ledger/store/ledgerStore';
import type { Client, ClientAccountLedger, ClientLedgerEntry, LedgerColumnKey, PdfColVisibility } from '@/shared/types';

type PdfExportModalProps = {
 selectedClientLedgers: ClientAccountLedger[];
 selectedClientForLedger: Client | null;
 pdfAllColumns: Array<{ key: LedgerColumnKey; label: string }>;
 onExportLedgerPdf: (ledger: ClientAccountLedger, fromDate: string, toDate: string, colVisibility: PdfColVisibility, fromEntryKey?: string | null, toEntryKey?: string | null) => void;
 onExportLedgerExcel: (ledger: ClientAccountLedger, fromDate: string, toDate: string, colVisibility: PdfColVisibility, fromEntryKey?: string | null, toEntryKey?: string | null) => void;
};

export default function PdfExportModal({ selectedClientLedgers, selectedClientForLedger, pdfAllColumns, onExportLedgerPdf, onExportLedgerExcel }: PdfExportModalProps) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 // French uses 'en-US' grouping (comma thousands, period decimal) instead of the
 // official fr-FR narrow-no-break-space separator, which renders as near-invisible.
 const numLocale = language === 'fr' ? 'en-US' : language;
 const pdfSettings = useSettingsStore((s) => s.pdfSettings);
 const pdfExportModal = useLedgerStore((s) => s.pdfExportModal);
 const setPdfExportModal = useLedgerStore((s) => s.setPdfExportModal);
 const highlightedLedgerRows = useLedgerStore((s) => s.highlightedLedgerRows);

 return (
  <>
   {pdfExportModal
    ? (() => {
       const ledger = selectedClientLedgers.find((l) => l.accountId === pdfExportModal.accountId);
       if (!ledger) return null;
       return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
         <div className="w-full max-w-md rounded bg-white p-6 shadow-2xl">
          <h3 className="text-lg font-semibold text-slate-900">{t('export_ledger_title')}</h3>
          <p className="mt-1 text-sm text-slate-500">
           {selectedClientForLedger?.name} &mdash; {ledger.currencyName}
          </p>

          <div className="mt-5 flex flex-col gap-4">
           <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('export_date_from')}</label>
            <input
             type="date"
             value={pdfExportModal.fromDate}
             onChange={(e) => {
              savePdfDateRange(pdfExportModal.accountId, e.target.value, pdfExportModal.toDate);
              setPdfExportModal((prev) => (prev ? { ...prev, fromDate: e.target.value, fromEntryKey: null, toEntryKey: null } : prev));
             }}
             className="rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
            />
           </div>
           <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('export_date_to')}</label>
            <input
             type="date"
             value={pdfExportModal.toDate}
             onChange={(e) => {
              savePdfDateRange(pdfExportModal.accountId, pdfExportModal.fromDate, e.target.value);
              setPdfExportModal((prev) => (prev ? { ...prev, toDate: e.target.value, fromEntryKey: null, toEntryKey: null } : prev));
             }}
             className="rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
            />
           </div>

           {/* Shortcut: derive the range from the highlighted rows. Both boundaries are
               inclusive — the first highlighted row is the first row shown, the last
               highlighted row is the final row shown. Everything before the first highlight
               is rolled into the opening (pre-)balance. */}
           {(() => {
            const highlightedEntries = ledger.entries.filter((e) => highlightedLedgerRows.has(getLedgerTransactionDraftKey(e.transactionId, ledger.accountId)));
            if (highlightedEntries.length < 2) return null;
            return (
             <div className="flex flex-col gap-1">
              <button
               type="button"
               onClick={() => {
                const first = highlightedEntries[highlightedEntries.length - 2];
                const last = highlightedEntries[highlightedEntries.length - 1];
                // Both highlighted rows are included in the export: start AT the first
                // highlight (not the row after it), end AT the last highlight.
                const newFrom = first.createdAt.slice(0, 10);
                const newTo = last.createdAt.slice(0, 10);
                savePdfDateRange(pdfExportModal.accountId, newFrom, newTo);
                setPdfExportModal((prev) =>
                 prev ? { ...prev, fromDate: newFrom, toDate: newTo, fromEntryKey: ledgerEntryKey(first), toEntryKey: ledgerEntryKey(last) } : prev,
                );
               }}
               className="cursor-pointer rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-100"
              >
               {t('export_use_highlights')}
              </button>
              <p className="text-xs text-slate-400">{t('export_use_highlights_hint')}</p>
             </div>
            );
           })()}

           {/* Start picker lists only the From-date's transactions; End picker only the To-date's. */}
           {(() => {
            const startCandidates = ledger.entries.filter((e) => e.createdAt.slice(0, 10) === pdfExportModal.fromDate);
            const endCandidates = ledger.entries.filter((e) => e.createdAt.slice(0, 10) === pdfExportModal.toDate);
            if (startCandidates.length === 0 && endCandidates.length === 0) return null;
            const startKey =
             pdfExportModal.fromEntryKey && startCandidates.some((e) => ledgerEntryKey(e) === pdfExportModal.fromEntryKey)
              ? pdfExportModal.fromEntryKey
              : startCandidates[0]
                ? ledgerEntryKey(startCandidates[0])
                : '';
            const endKey =
             pdfExportModal.toEntryKey && endCandidates.some((e) => ledgerEntryKey(e) === pdfExportModal.toEntryKey)
              ? pdfExportModal.toEntryKey
              : endCandidates[endCandidates.length - 1]
                ? ledgerEntryKey(endCandidates[endCandidates.length - 1])
                : '';
            const entryLabel = (e: ClientLedgerEntry) =>
             `${formatDateValue(e.createdAt, pdfSettings.dateFormat)} · ${e.counterpartyName} · ${e.direction === 'outgoing' ? '−' : '+'}${e.amount.toLocaleString(numLocale, { maximumFractionDigits: pdfSettings.decimals })} ${e.currencySymbol || e.currencyCode}`;
            return (
             <>
              {startCandidates.length > 0 ? (
               <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('export_start_transaction')}</label>
                <select
                 value={startKey}
                 onChange={(e) => setPdfExportModal((prev) => (prev ? { ...prev, fromEntryKey: e.target.value } : prev))}
                 className="rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                >
                 {startCandidates.map((entry) => (
                  <option
                   key={ledgerEntryKey(entry)}
                   value={ledgerEntryKey(entry)}
                  >
                   {entryLabel(entry)}
                  </option>
                 ))}
                </select>
               </div>
              ) : null}
              {endCandidates.length > 0 ? (
               <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('export_end_transaction')}</label>
                <select
                 value={endKey}
                 onChange={(e) => setPdfExportModal((prev) => (prev ? { ...prev, toEntryKey: e.target.value } : prev))}
                 className="rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                >
                 {endCandidates.map((entry) => (
                  <option
                   key={ledgerEntryKey(entry)}
                   value={ledgerEntryKey(entry)}
                  >
                   {entryLabel(entry)}
                  </option>
                 ))}
                </select>
               </div>
              ) : null}
             </>
            );
           })()}

           {/* Column toggles */}
           <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('pdf_columns_label')}</label>
            <div className="mt-2 flex flex-wrap gap-1.5">
             {pdfAllColumns.map((col) => {
              const isRunningBal = col.key === 'runningBalance';
              const isOn = isRunningBal || pdfExportModal.cols[col.key];
              return (
               <button
                key={col.key}
                type="button"
                disabled={isRunningBal}
                onClick={() => {
                 if (isRunningBal) return;
                 const newCols = { ...pdfExportModal.cols, [col.key]: !pdfExportModal.cols[col.key] };
                 savePdfCols(pdfExportModal.accountId, newCols);
                 setPdfExportModal((prev) => (prev ? { ...prev, cols: newCols } : prev));
                }}
                className={`rounded border px-2.5 py-1 text-xs font-medium transition ${
                 isOn ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'
                } ${isRunningBal ? 'cursor-default opacity-60' : 'cursor-pointer'}`}
               >
                {col.label}
               </button>
              );
             })}
            </div>
           </div>

           {(() => {
            const candidates = ledger.entries.filter((e) => {
             const d = e.createdAt.slice(0, 10);
             return d >= pdfExportModal.fromDate && d <= pdfExportModal.toDate;
            });
            const startIdx = pdfExportModal.fromEntryKey
             ? Math.max(
                0,
                candidates.findIndex((e) => ledgerEntryKey(e) === pdfExportModal.fromEntryKey),
               )
             : 0;
            const endIdxRaw = pdfExportModal.toEntryKey ? candidates.findIndex((e) => ledgerEntryKey(e) === pdfExportModal.toEntryKey) : -1;
            const endIdx = endIdxRaw === -1 ? candidates.length - 1 : endIdxRaw;
            const selected = startIdx <= endIdx ? candidates.slice(startIdx, endIdx + 1) : [];
            const firstSelected = selected[0];
            const cutoffIndex = firstSelected ? ledger.entries.findIndex((e) => ledgerEntryKey(e) === ledgerEntryKey(firstSelected)) : ledger.entries.length;
            const preBalance = ledger.startingBalance + ledger.entries.slice(0, cutoffIndex < 0 ? 0 : cutoffIndex).reduce((sum, e) => sum + e.netChange, 0);
            const count = selected.length;
            return (
             <div className="rounded border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <div className="flex justify-between">
               <span className="text-slate-500">{t('export_pre_balance')}</span>
               <span className={`font-semibold ${preBalance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {preBalance.toLocaleString(numLocale, { maximumFractionDigits: 2 })} {ledger.currencySymbol || ledger.currencyCode}
               </span>
              </div>
              <div className="mt-1 flex justify-between">
               <span className="text-slate-500">{t('client_page_transaction_count')}</span>
               <span className="font-semibold text-slate-900">{count}</span>
              </div>
             </div>
            );
           })()}
          </div>

          <div className="mt-5 flex justify-end gap-2">
           <button
            type="button"
            onClick={() => setPdfExportModal(null)}
            className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
           >
            {t('cancel')}
           </button>
           <button
            type="button"
            onClick={() =>
             void onExportLedgerExcel(ledger, pdfExportModal.fromDate, pdfExportModal.toDate, pdfExportModal.cols, pdfExportModal.fromEntryKey, pdfExportModal.toEntryKey)
            }
            disabled={!pdfExportModal.fromDate || !pdfExportModal.toDate || pdfExportModal.fromDate > pdfExportModal.toDate}
            className="flex items-center gap-1.5 rounded border border-emerald-600 bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
           >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
             <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
             <polyline points="14 2 14 8 20 8" />
             <path d="M9 13l6 5M15 13l-6 5" />
            </svg>
            {t('transactions_export_excel')}
           </button>
           <button
            type="button"
            onClick={() =>
             void onExportLedgerPdf(ledger, pdfExportModal.fromDate, pdfExportModal.toDate, pdfExportModal.cols, pdfExportModal.fromEntryKey, pdfExportModal.toEntryKey)
            }
            disabled={!pdfExportModal.fromDate || !pdfExportModal.toDate || pdfExportModal.fromDate > pdfExportModal.toDate}
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
      })()
    : null}
  </>
 );
}
