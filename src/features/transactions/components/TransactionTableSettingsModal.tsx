'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useTransactionsStore } from '@/features/transactions/store/transactionsStore';
import type { Section, TransactionColumnKey, TransactionTableSettings } from '@/shared/types';

type Props = {
 section: Section;
 closeTransactionTableSettingsModal: () => void;
 saveTransactionTableSettingsModal: () => void;
 txRowHighlightColor: string;
 updateTxRowHighlightColor: (next: string) => void;
};

export default function TransactionTableSettingsModal({ section, closeTransactionTableSettingsModal, saveTransactionTableSettingsModal, txRowHighlightColor, updateTxRowHighlightColor }: Props) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const setShowTransactionTableSettingsModal = useTransactionsStore((s) => s.setShowTransactionTableSettingsModal);
 // Archive and Transactions keep separate column-visibility drafts (see transactionsStore.ts) —
 // this modal edits whichever one matches the section it was opened from.
 const transactionTableSettingsDraft = useTransactionsStore((s) => (section === 'archive' ? s.archiveTableSettingsDraft : s.transactionTableSettingsDraft));
 const setTransactionTableSettingsDraft = useTransactionsStore((s) => (section === 'archive' ? s.setArchiveTableSettingsDraft : s.setTransactionTableSettingsDraft));

 return (
    <div
     className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
     onClick={closeTransactionTableSettingsModal}
    >
     <div
      className="w-full max-w-lg rounded-xl border border-border bg-surface p-6 shadow-xl"
      onClick={(event) => event.stopPropagation()}
     >
      <h2 className="text-lg font-semibold text-fg">{t('transactions_table_settings_title')}</h2>
      <div className="mt-5 space-y-5">
       <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('client_ledger_columns')}</p>
        <div className="mt-2 flex flex-wrap gap-2">
         {(
          [
           { key: 'created', label: t('date') },
           { key: 'description', label: t('transaction_description') },
           { key: 'accountFrom', label: t('transaction_account_from') },
           { key: 'accountTo', label: t('transaction_account_to') },
           { key: 'amount', label: t('transaction_amount') },
           { key: 'charges', label: t('charges') },
           { key: 'commission', label: t('commission') },
          ] as Array<{ key: TransactionColumnKey; label: string }>
         ).map((column) => {
          const isVisible = transactionTableSettingsDraft.columns[column.key];
          return (
           <button
            key={column.key}
            type="button"
            onClick={() =>
             setTransactionTableSettingsDraft((current) => ({
              ...current,
              columns: { ...current.columns, [column.key]: !current.columns[column.key] },
             }))
            }
            className={`rounded border px-3 py-1.5 text-xs font-semibold transition ${
             isVisible ? 'border-blue-600 bg-blue-700 text-white' : 'border-border-strong bg-surface text-fg-muted hover:bg-surface-hover'
            }`}
           >
            {column.label}
           </button>
          );
         })}
        </div>
       </div>

       <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('transactions_more_settings')}</p>
        <div className="mt-2 space-y-4">
         <label className="flex items-center justify-between gap-3 rounded border border-border px-4 py-3 text-sm text-fg-muted">
          <span>{t('transactions_show_exchange_rate')}</span>
          <input
           type="checkbox"
           checked={transactionTableSettingsDraft.showExchangeRate}
           onChange={() => setTransactionTableSettingsDraft((current) => ({ ...current, showExchangeRate: !current.showExchangeRate }))}
           className="h-4 w-4 cursor-pointer rounded border-border-strong text-accent focus:ring-blue-500"
          />
         </label>

         <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('pdf_date_format_label')}</label>
          <select
           value={transactionTableSettingsDraft.dateFormat}
           onChange={(event) => setTransactionTableSettingsDraft((current) => ({ ...current, dateFormat: event.target.value as TransactionTableSettings['dateFormat'] }))}
           className="mt-2 w-full rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
          >
           <option value="full">YYYY-MM-DD</option>
           <option value="day-month">DD/MM</option>
           <option value="month-year">MM/YYYY</option>
           <option value="day-month-year-2">DD/MM/YY</option>
           <option value="month-day">MM/DD</option>
          </select>
         </div>
        </div>
       </div>

       <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('ledger_row_highlight_color')}</p>
        <div className="mt-2 flex items-center gap-2">
         <input
          type="color"
          value={txRowHighlightColor}
          onChange={(event) => updateTxRowHighlightColor(event.target.value)}
          className="h-8 w-14 cursor-pointer rounded border border-border-strong bg-surface p-0.5"
         />
         <span
          className="rounded px-3 py-1 text-xs font-semibold text-fg-muted"
          style={{ backgroundColor: txRowHighlightColor }}
         >
          {txRowHighlightColor}
         </span>
        </div>
       </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
       <button
        type="button"
        onClick={closeTransactionTableSettingsModal}
        className="rounded border border-border-strong px-4 py-2 text-sm font-semibold text-fg-muted hover:bg-surface-hover"
       >
        {t('cancel')}
       </button>
       <button
        type="button"
        onClick={saveTransactionTableSettingsModal}
        className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
       >
        {t('save_changes')}
       </button>
      </div>
     </div>
    </div>
 );
}
