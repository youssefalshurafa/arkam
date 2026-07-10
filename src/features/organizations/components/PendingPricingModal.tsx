'use client';

import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { formatDateValue } from '@/shared/utils/date';
import type { PdfSettings } from '@/shared/types';
import type { PendingPricingEntry } from '@/features/clients/utils/clientBalances';

type PendingPricingModalProps = {
 clientName: string | null;
 entries: PendingPricingEntry[];
 numLocale: string;
 ledgerDecimals: number;
 ledgerDateFormat: PdfSettings['dateFormat'];
 onClose: () => void;
 // Persists a rate for one pending entry. Resolves true on success (parent reloads,
 // dropping the now-priced entry from the list). The rate means "1 <entry currency> =
 // rate <account currency>".
 onSaveRate: (entry: PendingPricingEntry, rate: string) => Promise<boolean>;
};

// Organization-page popup listing a client's cross-currency rows that still have no
// exchange rate (excluded from the balance until priced). Each row now carries an inline
// rate field so the pricing can be done here, instead of only in the client ledger.
export default function PendingPricingModal({
 clientName,
 entries,
 numLocale,
 ledgerDecimals,
 ledgerDateFormat,
 onClose,
 onSaveRate,
}: PendingPricingModalProps) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);

 const [rateInputs, setRateInputs] = useState<Record<string, string>>({});
 const [savingKey, setSavingKey] = useState<string | null>(null);

 const saveEntry = async (entry: PendingPricingEntry) => {
  const value = (rateInputs[entry.key] ?? '').trim();
  if (!value) return;
  setSavingKey(entry.key);
  try {
   const ok = await onSaveRate(entry, value);
   if (ok) {
    setRateInputs((current) => {
     const next = { ...current };
     delete next[entry.key];
     return next;
    });
   }
  } finally {
   setSavingKey(null);
  }
 };

 return (
  <div
   className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
   onClick={onClose}
  >
   <div
    className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-slate-200 bg-white shadow-xl"
    onClick={(e) => e.stopPropagation()}
   >
    <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
     <div>
      <h2 className="text-lg font-semibold text-slate-900">{t('pending_pricing_modal_title')}</h2>
      {clientName ? <p className="mt-0.5 text-sm text-slate-500">{clientName}</p> : null}
     </div>
     <button
      type="button"
      onClick={onClose}
      className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
      aria-label={t('close')}
     >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
       <path d="M18 6 6 18M6 6l12 12" />
      </svg>
     </button>
    </div>
    <div className="overflow-y-auto px-5 py-4">
     {entries.length === 0 ? (
      <p className="text-sm text-slate-500">{t('client_page_no_transactions')}</p>
     ) : (
      <ul className="space-y-2 text-sm text-slate-700">
       {entries.map((entry) => {
        const rateValue = rateInputs[entry.key] ?? '';
        const isSaving = savingKey === entry.key;
        return (
         <li
          key={entry.key}
          className="rounded border border-amber-200 bg-amber-50 px-2.5 py-2"
         >
          <div className="flex items-center gap-2 whitespace-nowrap">
           <span className="shrink-0 text-slate-500">{formatDateValue(entry.createdAt, ledgerDateFormat)}</span>
           {entry.counterpartyName ? <span className="shrink-0 font-medium">{entry.counterpartyName}</span> : null}
           <span className="min-w-0 flex-1 truncate italic text-slate-400" title={entry.description}>
            {entry.description}
           </span>
           <span className="shrink-0 font-semibold">
            {entry.amount.toLocaleString(numLocale, { maximumFractionDigits: ledgerDecimals })} {entry.currencySymbol || entry.currencyCode}
           </span>
          </div>
          <div className="mt-2 flex items-center gap-2">
           <span className="shrink-0 text-xs text-slate-500">{t('pending_pricing_rate_hint', { from: entry.currencyCode, to: entry.accountCurrencyCode })}</span>
           <input
            type="text"
            inputMode="decimal"
            value={rateValue}
            onChange={(e) => setRateInputs((current) => ({ ...current, [entry.key]: e.target.value }))}
            onKeyDown={(e) => {
             if (e.key === 'Enter') {
              e.preventDefault();
              void saveEntry(entry);
             }
            }}
            placeholder={t('pending_pricing_rate_placeholder')}
            disabled={isSaving}
            className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 disabled:opacity-50"
           />
           <button
            type="button"
            onClick={() => void saveEntry(entry)}
            disabled={isSaving || !rateValue.trim()}
            className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50"
           >
            {isSaving ? t('saving') : t('pending_pricing_set_rate')}
           </button>
          </div>
         </li>
        );
       })}
      </ul>
     )}
    </div>
   </div>
  </div>
 );
}
