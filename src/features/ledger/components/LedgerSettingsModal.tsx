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
 selectLedgerRowHighlightPreset: (index: number) => void;
 saveLedgerRowHighlightPreset: (index: number) => void;
 toggleLedgerCurrencySymbol: () => void;
 toggleLedgerHighlightNetChange: () => void;
 toggleLedgerColumn: (column: LedgerColumnKey) => void;
 clearLedgerRowHighlights: () => void;
};

export default function LedgerSettingsModal({
 orderedLedgerColumnOptions, persistLedgerSettings, updateLedgerDecimals, updateLedgerDateFormat,
 updateLedgerRowHighlightColor, updateLedgerNetChangeHighlightColor, selectLedgerRowHighlightPreset, saveLedgerRowHighlightPreset,
 toggleLedgerCurrencySymbol, toggleLedgerHighlightNetChange, toggleLedgerColumn,
 clearLedgerRowHighlights,
}: LedgerSettingsModalProps) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const {
  showLedgerSettingsModal, setShowLedgerSettingsModal, ledgerDecimals, ledgerDateFormat, ledgerHighlightNetChange, ledgerNetChangeHighlightColor,
  ledgerRowHighlightColor, ledgerRowHighlightPresets, ledgerRowClickHighlight, setLedgerRowClickHighlight, showLedgerCurrencySymbol, setShowLedgerCurrencySymbol,
  ledgerColumnVisibility, setLedgerColumnVisibility, setLedgerColumnOrder, highlightedLedgerRows,
 } = useLedgerStore();

 return (
    <div
     className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
     onClick={() => setShowLedgerSettingsModal(false)}
    >
     <div
      className="w-full max-w-md rounded bg-surface p-6 shadow-2xl"
      onClick={(e) => e.stopPropagation()}
     >
      <h3 className="text-lg font-semibold text-fg">{t('nav_settings')}</h3>

      <div className="mt-5 flex flex-col gap-5">
       {/* Decimal places */}
       <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('decimal_places')}</p>
        <div className="mt-2 flex overflow-hidden rounded border border-border-strong bg-surface w-fit">
         <button
          type="button"
          onClick={() => updateLedgerDecimals(Math.max(0, ledgerDecimals - 1))}
          disabled={ledgerDecimals === 0}
          className="px-3 py-1.5 text-sm font-bold text-fg-muted hover:bg-surface-hover disabled:opacity-30 transition"
         >
          -
         </button>
         <span className="border-x border-border px-3 py-1.5 text-center text-sm font-semibold text-fg">{ledgerDecimals}</span>
         <button
          type="button"
          onClick={() => updateLedgerDecimals(Math.min(6, ledgerDecimals + 1))}
          disabled={ledgerDecimals === 6}
          className="px-3 py-1.5 text-sm font-bold text-fg-muted hover:bg-surface-hover disabled:opacity-30 transition"
         >
          +
         </button>
        </div>
       </div>

       {/* Currency symbol toggle */}
       <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('currency_symbol')}</p>
        <button
         type="button"
         onClick={() => toggleLedgerCurrencySymbol()}
         aria-pressed={showLedgerCurrencySymbol}
         className={`mt-2 cursor-pointer rounded border px-3 py-1.5 text-xs font-semibold transition ${
          showLedgerCurrencySymbol ? 'border-blue-600 bg-blue-700 text-white' : 'border-border-strong bg-surface text-fg-muted hover:bg-surface-hover'
         }`}
        >
         {t('currency_symbol')}
        </button>
       </div>

       {/* Date format */}
       <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('pdf_date_format_label')}</p>
        <select
         value={ledgerDateFormat}
         onChange={(event) => updateLedgerDateFormat(event.target.value as PdfSettings['dateFormat'])}
         className="mt-2 w-full max-w-xs rounded border border-border-strong bg-surface px-3 py-2 text-sm text-fg outline-none ring-blue-300 focus:ring"
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
        <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('ledger_highlight_net_change')}</p>
        <button
         type="button"
         onClick={() => toggleLedgerHighlightNetChange()}
         aria-pressed={ledgerHighlightNetChange}
         className={`mt-2 cursor-pointer rounded border px-3 py-1.5 text-xs font-semibold transition ${
          ledgerHighlightNetChange ? 'border-blue-600 bg-blue-700 text-white' : 'border-border-strong bg-surface text-fg-muted hover:bg-surface-hover'
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
           className="h-8 w-14 cursor-pointer rounded border border-border-strong bg-surface p-0.5"
          />
          <span
           className="rounded px-3 py-1 text-xs font-semibold text-fg-muted"
           style={{ backgroundColor: ledgerNetChangeHighlightColor }}
          >
           {ledgerNetChangeHighlightColor}
          </span>
         </div>
        ) : null}
       </div>

       {/* Row highlight colour */}
       <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('ledger_row_highlight_color')}</p>
        <div className="mt-2 flex items-center gap-2">
         <input
          type="color"
          value={ledgerRowHighlightColor}
          onChange={(event) => updateLedgerRowHighlightColor(event.target.value)}
          className="h-8 w-14 cursor-pointer rounded border border-border-strong bg-surface p-0.5"
         />
         <span
          className="rounded px-3 py-1 text-xs font-semibold text-fg-muted"
          style={{ backgroundColor: ledgerRowHighlightColor }}
         >
          {ledgerRowHighlightColor}
         </span>
        </div>

        {/* 3 saved "pens" for quickly switching the active highlighter color above without
            reopening the picker each time. Click a swatch to make it active; click its pin
            badge to overwrite that slot with whatever color is active right now. */}
        <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-fg-faint">{t('ledger_highlight_presets_label')}</p>
        <div className="mt-1.5 flex items-center gap-3">
         {ledgerRowHighlightPresets.map((presetColor, index) => (
          <div key={index} className="relative">
           <button
            type="button"
            title={t('ledger_highlight_preset_select', { n: index + 1 })}
            onClick={() => selectLedgerRowHighlightPreset(index)}
            aria-pressed={ledgerRowHighlightColor === presetColor}
            className={`h-8 w-8 cursor-pointer rounded border-2 transition ${
             ledgerRowHighlightColor === presetColor ? 'border-blue-600' : 'border-border-strong hover:border-fg-faint'
            }`}
            style={{ backgroundColor: presetColor }}
           />
           <button
            type="button"
            title={t('ledger_highlight_preset_save', { n: index + 1 })}
            onClick={() => saveLedgerRowHighlightPreset(index)}
            className="absolute -bottom-1.5 -right-1.5 flex h-4.5 w-4.5 cursor-pointer items-center justify-center rounded-full border border-border-strong bg-surface text-fg-faint transition hover:bg-surface-hover hover:text-fg"
           >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
             <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
             <path d="M17 21v-8H7v8" />
             <path d="M7 3v5h8" />
            </svg>
           </button>
          </div>
         ))}
        </div>

        <button
         type="button"
         onClick={() => clearLedgerRowHighlights()}
         disabled={highlightedLedgerRows.size === 0}
         className="mt-2 cursor-pointer rounded border border-border-strong bg-surface px-3 py-1.5 text-xs font-semibold text-fg-muted transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-30"
        >
         {t('ledger_clear_row_highlights')}
        </button>
       </div>

       {/* Column visibility */}
       <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('client_ledger_columns')}</p>
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
             isVisible ? 'border-blue-600 bg-blue-700 text-white' : 'border-border-strong bg-surface text-fg-muted hover:bg-surface-hover'
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
        className="rounded border border-border-strong px-4 py-2 text-sm font-semibold text-fg-muted hover:bg-surface-hover"
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
