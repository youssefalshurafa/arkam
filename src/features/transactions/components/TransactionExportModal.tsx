'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useTransactionsStore } from '@/features/transactions/store/transactionsStore';

type Props = {
 onExportTransactionsPdf: () => void;
 onExportTransactionsExcel: () => void;
 closeTransactionExportModal: () => void;
 buildTransactionExportData: (fromDate: string, toDate: string) => { headers: string[]; rows: string[][]; count: number };
};

export default function TransactionExportModal({ onExportTransactionsPdf, onExportTransactionsExcel, closeTransactionExportModal, buildTransactionExportData }: Props) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const showTransactionExportModal = useTransactionsStore((s) => s.showTransactionExportModal);
 const setShowTransactionExportModal = useTransactionsStore((s) => s.setShowTransactionExportModal);
 const transactionExportFrom = useTransactionsStore((s) => s.transactionExportFrom);
 const setTransactionExportFrom = useTransactionsStore((s) => s.setTransactionExportFrom);
 const transactionExportTo = useTransactionsStore((s) => s.transactionExportTo);
 const setTransactionExportTo = useTransactionsStore((s) => s.setTransactionExportTo);
 const isExportingTransactions = useTransactionsStore((s) => s.isExportingTransactions);

 return (
    <div
     className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
     onClick={closeTransactionExportModal}
    >
     <div
      className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
      onClick={(event) => event.stopPropagation()}
     >
      <h2 className="text-lg font-semibold text-slate-900">{t('transactions_export_title')}</h2>
      <p className="mt-1 text-sm text-slate-500">{t('transactions_export_hint')}</p>

      <div className="mt-5 grid grid-cols-2 gap-4">
       <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{t('transactions_export_from')}</label>
        <input
         type="date"
         value={transactionExportFrom}
         max={transactionExportTo || undefined}
         onChange={(event) => setTransactionExportFrom(event.target.value)}
         className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
        />
       </div>
       <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{t('transactions_export_to')}</label>
        <input
         type="date"
         value={transactionExportTo}
         min={transactionExportFrom || undefined}
         onChange={(event) => setTransactionExportTo(event.target.value)}
         className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
        />
       </div>
      </div>

      <p className="mt-3 text-xs text-slate-500">
       {t('transactions_export_count').replace('{count}', String(buildTransactionExportData(transactionExportFrom, transactionExportTo).count))}
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3">
       <button
        type="button"
        onClick={() => void onExportTransactionsPdf()}
        disabled={isExportingTransactions}
        className="flex items-center justify-center gap-2 rounded border border-red-600 bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
       >
        <svg
         width="16"
         height="16"
         viewBox="0 0 24 24"
         fill="none"
         stroke="currentColor"
         strokeWidth="1.8"
         strokeLinecap="round"
         strokeLinejoin="round"
         aria-hidden
        >
         <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
         <polyline points="14 2 14 8 20 8" />
        </svg>
        {t('transactions_export_pdf')}
       </button>
       <button
        type="button"
        onClick={() => void onExportTransactionsExcel()}
        disabled={isExportingTransactions}
        className="flex items-center justify-center gap-2 rounded border border-emerald-600 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
       >
        <svg
         width="16"
         height="16"
         viewBox="0 0 24 24"
         fill="none"
         stroke="currentColor"
         strokeWidth="1.8"
         strokeLinecap="round"
         strokeLinejoin="round"
         aria-hidden
        >
         <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
         <polyline points="14 2 14 8 20 8" />
         <path d="M9 13l6 5M15 13l-6 5" />
        </svg>
        {t('transactions_export_excel')}
       </button>
      </div>

      <div className="mt-4 flex justify-end">
       <button
        type="button"
        onClick={closeTransactionExportModal}
        disabled={isExportingTransactions}
        className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
       >
        {t('cancel')}
       </button>
      </div>
     </div>
    </div>
 );
}
