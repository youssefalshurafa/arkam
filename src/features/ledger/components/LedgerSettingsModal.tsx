'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useLedgerStore } from '@/features/ledger/store/ledgerStore';
import type { LedgerColumnKey, PdfSettings, StoredLedgerSettings } from '@/shared/types';

type LedgerSettingsModalProps = {
 orderedLedgerColumnOptions: Array<{ key: LedgerColumnKey; label: string }>;
 persistLedgerSettings: (patch: Partial<StoredLedgerSettings>) => void;
 updateLedgerDecimals: (next: number) => void;
 updateLedgerDateFormat: (next: PdfSettings['dateFormat']) => void;
 updateLedgerRowHighlightColor: (next: string) => void;
 updateLedgerNetChangeHighlightColor: (next: string) => void;
 toggleLedgerCurrencySymbol: () => void;
 toggleLedgerHighlightNetChange: () => void;
 toggleLedgerColumn: (column: LedgerColumnKey) => void;
};

export default function LedgerSettingsModal({
 orderedLedgerColumnOptions, persistLedgerSettings, updateLedgerDecimals, updateLedgerDateFormat,
 updateLedgerRowHighlightColor, updateLedgerNetChangeHighlightColor, toggleLedgerCurrencySymbol, toggleLedgerHighlightNetChange, toggleLedgerColumn,
}: LedgerSettingsModalProps) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const { showLedgerSettingsModal, setShowLedgerSettingsModal, ledgerDecimals, ledgerDateFormat, ledgerHighlightNetChange, ledgerNetChangeHighlightColor, ledgerRowHighlightColor, ledgerRowClickHighlight, setLedgerRowClickHighlight, showLedgerCurrencySymbol, setShowLedgerCurrencySymbol, ledgerColumnVisibility, setLedgerColumnVisibility, setLedgerColumnOrder } = useLedgerStore();

 return (
    <div
     className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
     onClick={() => setShowLedgerSettingsModal(false)}
    >
     <div
      className="w-full max-w-md rounded bg-white p-6 shadow-2xl"
      onClick={(e) => e.stopPropagation()}
     >
      <h3 className="text-lg font-semibold text-slate-900">{t('nav_settings')}</h3>

      <div className="mt-5 flex flex-col gap-5">
       {/* Decimal places */}
       <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('decimal_places')}</p>
        <div className="mt-2 flex overflow-hidden rounded border border-slate-300 bg-white w-fit">
         <button
          type="button"
          onClick={() => updateLedgerDecimals(Math.max(0, ledgerDecimals - 1))}
          disabled={ledgerDecimals === 0}
          className="px-3 py-1.5 text-sm font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-30 transition"
         >
          -
         </button>
         <span className="border-x border-slate-200 px-3 py-1.5 text-center text-sm font-semibold text-slate-800">{ledgerDecimals}</span>
         <button
          type="button"
          onClick={() => updateLedgerDecimals(Math.min(6, ledgerDecimals + 1))}
          disabled={ledgerDecimals === 6}
          className="px-3 py-1.5 text-sm font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-30 transition"
         >
          +
         </button>
        </div>
       </div>

       {/* Currency symbol toggle */}
       <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('currency_symbol')}</p>
        <button
         type="button"
         onClick={() => toggleLedgerCurrencySymbol()}
         aria-pressed={showLedgerCurrencySymbol}
         className={`mt-2 cursor-pointer rounded border px-3 py-1.5 text-xs font-semibold transition ${
          showLedgerCurrencySymbol ? 'border-blue-600 bg-blue-700 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
         }`}
        >
         {t('currency_symbol')}
        </button>
       </div>

       {/* Date format */}
       <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('pdf_date_format_label')}</p>
        <select
         value={ledgerDateFormat}
         onChange={(event) => updateLedgerDateFormat(event.target.value as PdfSettings['dateFormat'])}
         className="mt-2 w-full max-w-xs rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-blue-300 focus:ring"
        >
         <option value="full">2026-06-26 (YYYY-MM-DD)</option>
         <option value="day-month">26/06 (DD/MM)</option>
         <option value="month-day">06/26 (MM/DD)</option>
         <option value="day-month-year-2">26/06/26 (DD/MM/YY)</option>
         <option value="month-year">06/2026 (MM/YYYY)</option>
        </select>
       </div>

       {/* Highlight net change column */}
       <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('ledger_highlight_net_change')}</p>
        <button
         type="button"
         onClick={() => toggleLedgerHighlightNetChange()}
         aria-pressed={ledgerHighlightNetChange}
         className={`mt-2 cursor-pointer rounded border px-3 py-1.5 text-xs font-semibold transition ${
          ledgerHighlightNetChange ? 'border-blue-600 bg-blue-700 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
         }`}
        >
         {t('ledger_highlight_net_change')}
        </button>
        {ledgerHighlightNetChange ? (
         <div className="mt-2 flex items-center gap-2">
          <input
           type="color"
           value={ledgerNetChangeHighlightColor}
           onChange={(event) => updateLedgerNetChangeHighlightColor(event.target.value)}
           className="h-8 w-14 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
          />
          <span
           className="rounded px-3 py-1 text-xs font-semibold text-slate-700"
           style={{ backgroundColor: ledgerNetChangeHighlightColor }}
          >
           {ledgerNetChangeHighlightColor}
          </span>
         </div>
        ) : null}
       </div>

       {/* Row highlight colour */}
       <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('ledger_row_highlight_color')}</p>
        <div className="mt-2 flex items-center gap-2">
         <input
          type="color"
          value={ledgerRowHighlightColor}
          onChange={(event) => updateLedgerRowHighlightColor(event.target.value)}
          className="h-8 w-14 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
         />
         <span
          className="rounded px-3 py-1 text-xs font-semibold text-slate-700"
          style={{ backgroundColor: ledgerRowHighlightColor }}
         >
          {ledgerRowHighlightColor}
         </span>
        </div>
       </div>

       {/* Column visibility */}
       <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('client_ledger_columns')}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
         {orderedLedgerColumnOptions.map((column) => {
          const isVisible = ledgerColumnVisibility[column.key];
          return (
           <button
            key={column.key}
            type="button"
            onClick={() => toggleLedgerColumn(column.key)}
            aria-pressed={isVisible}
            className={`cursor-pointer rounded border px-3 py-1.5 text-xs font-semibold transition ${
             isVisible ? 'border-blue-600 bg-blue-700 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
            }`}
           >
            {column.label}
           </button>
          );
         })}
        </div>
       </div>
      </div>

      <div className="mt-5 flex justify-end gap-2">
       <button
        type="button"
        onClick={() => setShowLedgerSettingsModal(false)}
        className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
       >
        {t('close')}
       </button>
       <button
        type="button"
        onClick={() => {
         persistLedgerSettings({});
         setShowLedgerSettingsModal(false);
        }}
        className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
       >
        {t('ledger_settings_save')}
       </button>
      </div>
     </div>
    </div>
 );
}
