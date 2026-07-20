'use client';

import { useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { formatAmountInput, normalizeDecimalInput, normalizePlainDecimalInput } from '@/shared/utils/decimal';
import { ltrIsolate } from '@/shared/utils/format';
import { localDateKey } from '@/shared/utils/date';
import { useLedgerStore } from '@/features/ledger/store/ledgerStore';
import type { Client, ClientAccount, ClientAccountLedger, ClientAdjustment, Currency } from '@/shared/types';

type AdjustmentModalProps = {
 selectedClientLedgers: ClientAccountLedger[];
 selectedClientForLedger: Client | null;
 localizedCurrencies: Currency[];
 clientAccounts: ClientAccount[];
 currencyMap: Map<number, Currency>;
 enabledCurrencies: Currency[];
 adjustments: ClientAdjustment[];
 onSubmitAdjustment: () => void;
 onDeleteAdjustment: (id: number) => void;
};

export default function AdjustmentModal({ selectedClientLedgers, selectedClientForLedger, localizedCurrencies, clientAccounts, currencyMap, enabledCurrencies, adjustments, onSubmitAdjustment, onDeleteAdjustment }: AdjustmentModalProps) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 // French uses 'en-US' grouping (comma thousands, period decimal) instead of the
 // official fr-FR narrow-no-break-space separator, which renders as near-invisible.
 const numLocale = language === 'fr' ? 'en-US' : language;
 const adjustmentModal = useLedgerStore((s) => s.adjustmentModal);
 const ledgerDecimals = useLedgerStore((s) => s.ledgerDecimals);
 const setAdjustmentModal = useLedgerStore((s) => s.setAdjustmentModal);

 // Distinct past expense descriptions (most recent first), offered as <datalist> suggestions
 // so recurring expenses (e.g. "Gas money") don't need retyping every time. Capped at 5 so the
 // dropdown stays short and useful instead of listing every past description ever entered.
 const descriptionSuggestions = useMemo(() => {
  const seen = new Set<string>();
  const list: string[] = [];
  for (let i = adjustments.length - 1; i >= 0 && list.length < 5; i--) {
   const desc = adjustments[i].description.trim();
   if (desc && !seen.has(desc)) {
    seen.add(desc);
    list.push(desc);
   }
  }
  return list;
 }, [adjustments]);

 return (
  <>
   {adjustmentModal
    ? (() => {
       const ledger = selectedClientLedgers.find((l) => l.accountId === adjustmentModal.accountId);
       const account = clientAccounts.find((a) => a.id === adjustmentModal.accountId);
       const selectedCurrency = adjustmentModal.currencyId ? currencyMap.get(adjustmentModal.currencyId) : undefined;
       const accountCurrencyCode = account?.currencyCode ?? ledger?.currencyCode ?? '';
       const needsRate = !!(selectedCurrency && accountCurrencyCode && selectedCurrency.code !== accountCurrencyCode);
       const rawRate = parseFloat(adjustmentModal.exchangeRate) || 0;
       const effectiveRate = adjustmentModal.exchangeRateReversed ? (rawRate ? 1 / rawRate : 0) : rawRate;
       const amountValue = parseFloat(adjustmentModal.amount) || 0;
       const convertedAmount = needsRate ? amountValue * (effectiveRate || 0) : amountValue;
       return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
         <div
          className="w-full max-w-md rounded bg-surface p-6 shadow-2xl"
          onKeyDown={(e) => {
           // Enter submits the adjustment (ignore Enter inside multi-line fields).
           if (e.key !== 'Enter') return;
           if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
           e.preventDefault();
           void onSubmitAdjustment();
          }}
         >
          <h3 className="text-lg font-semibold text-fg">{adjustmentModal.editingId ? t('adjustment_edit_title') : t('adjustment_add_title')}</h3>
          {ledger ? (
           <p className="mt-1 text-sm text-fg-faint">
            {selectedClientForLedger?.name} &mdash; {ledger.currencyName}
           </p>
          ) : null}

          <div className="mt-5 flex flex-col gap-4">
           <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('adjustment_direction')}</label>
            {/* Fixed LTR order regardless of app language — debit/credit is a universal
                accounting convention, not text, so it shouldn't mirror in Arabic (the
                colors looked "reversed" because the grid itself was flipping side). */}
            <div dir="ltr" className="grid grid-cols-2 gap-2">
             <button
              type="button"
              onClick={() => setAdjustmentModal((prev) => (prev ? { ...prev, direction: 'debit' } : prev))}
              className={`rounded border px-3 py-2 text-sm font-semibold transition ${
               adjustmentModal.direction === 'debit' ? 'border-red-500 bg-bad-bg text-bad-text' : 'border-border-strong bg-surface text-fg-muted hover:bg-surface-hover'
              }`}
             >
              {t('adjustment_direction_debit')}
             </button>
             <button
              type="button"
              onClick={() => setAdjustmentModal((prev) => (prev ? { ...prev, direction: 'credit' } : prev))}
              className={`rounded border px-3 py-2 text-sm font-semibold transition ${
               adjustmentModal.direction === 'credit' ? 'border-emerald-500 bg-good-bg text-good-text' : 'border-border-strong bg-surface text-fg-muted hover:bg-surface-hover'
              }`}
             >
              {t('adjustment_direction_credit')}
             </button>
            </div>
            <p className="mt-1 text-xs text-fg-faint">{adjustmentModal.direction === 'debit' ? t('adjustment_debit_hint') : t('adjustment_credit_hint')}</p>
           </div>

           <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('amount')}</label>
            <input
             type="text"
             inputMode="decimal"
             dir="ltr"
             value={formatAmountInput(adjustmentModal.amount)}
             onChange={(e) => setAdjustmentModal((prev) => (prev ? { ...prev, amount: normalizeDecimalInput(e.target.value) } : prev))}
             placeholder="0"
             autoFocus
             className="rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
            />
           </div>

           <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('currency')}</label>
            <select
             value={adjustmentModal.currencyId ?? ''}
             onChange={(e) =>
              setAdjustmentModal((prev) => (prev ? { ...prev, currencyId: e.target.value ? Number(e.target.value) : null, exchangeRate: '', exchangeRateReversed: false } : prev))
             }
             className="rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
            >
             {(adjustmentModal.currencyId && !enabledCurrencies.some((c) => c.id === adjustmentModal.currencyId)
              ? [...enabledCurrencies, ...localizedCurrencies.filter((c) => c.id === adjustmentModal.currencyId)]
              : enabledCurrencies
             ).map((currency) => (
              <option
               key={currency.id}
               value={currency.id}
              >
               {currency.code} {currency.symbol ? `(${currency.symbol})` : ''} · {currency.name}
              </option>
             ))}
            </select>
           </div>

           {needsRate ? (
            <div className="flex flex-col gap-1">
             <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('exchange_rate')}</label>
              <button
               type="button"
               title={t('reverse_rate')}
               onClick={() =>
                setAdjustmentModal((prev) => {
                 if (!prev) return prev;
                 const val = parseFloat(prev.exchangeRate) || 0;
                 return {
                  ...prev,
                  exchangeRate: val ? String(Number((1 / val).toFixed(6))) : prev.exchangeRate,
                  exchangeRateReversed: !prev.exchangeRateReversed,
                 };
                })
               }
               className="inline-flex items-center gap-1 rounded p-1 text-xs text-fg-faint transition hover:bg-surface-hover hover:text-fg"
              >
               <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
               >
                <path d="M7 4 3 8l4 4M3 8h13.5" />
                <path d="M17 20l4-4-4-4m4 4H7.5" />
               </svg>
               {adjustmentModal.exchangeRateReversed ? t('rate_division') : t('rate_multiplication')}
              </button>
             </div>
             <span className="text-xs text-fg-faint">
              {adjustmentModal.exchangeRateReversed
               ? ltrIsolate(`1 ${accountCurrencyCode} = ? ${selectedCurrency?.code ?? ''}`)
               : ltrIsolate(`1 ${selectedCurrency?.code ?? ''} = ? ${accountCurrencyCode}`)}
             </span>
             <input
              type="text"
              inputMode="decimal"
              dir="ltr"
              value={adjustmentModal.exchangeRate}
              onChange={(e) => setAdjustmentModal((prev) => (prev ? { ...prev, exchangeRate: normalizePlainDecimalInput(e.target.value) } : prev))}
              placeholder="0"
              className="rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
             />
             {amountValue > 0 && effectiveRate > 0 ? (
              <span className="text-xs text-fg-faint">
               = {convertedAmount.toLocaleString(numLocale, { maximumFractionDigits: ledgerDecimals })} {accountCurrencyCode}
              </span>
             ) : null}
            </div>
           ) : null}

           <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('adjustment_description')}</label>
            <input
             type="text"
             list="adjustment-description-suggestions"
             value={adjustmentModal.description}
             onChange={(e) => setAdjustmentModal((prev) => (prev ? { ...prev, description: e.target.value } : prev))}
             placeholder={t('adjustment_description_placeholder')}
             className="rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
            />
            <datalist id="adjustment-description-suggestions">
             {descriptionSuggestions.map((desc) => (
              <option
               key={desc}
               value={desc}
              />
             ))}
            </datalist>
           </div>

           <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('date')}</label>
            <input
             type="date"
             value={adjustmentModal.date}
             max={localDateKey()}
             onChange={(e) =>
              setAdjustmentModal((prev) => (prev ? { ...prev, date: e.target.value > localDateKey() ? localDateKey() : e.target.value } : prev))
             }
             className="rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
            />
           </div>
          </div>

          <div className="mt-5 flex justify-end gap-2">
           <button
            type="button"
            onClick={() => setAdjustmentModal(null)}
            className="rounded border border-border-strong px-4 py-2 text-sm font-semibold text-fg-muted hover:bg-surface-hover"
           >
            {t('cancel')}
           </button>
           <button
            type="button"
            onClick={() => void onSubmitAdjustment()}
            disabled={!adjustmentModal.amount || parseFloat(adjustmentModal.amount) <= 0}
            className="rounded bg-purple-700 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-800 disabled:cursor-not-allowed disabled:opacity-40"
           >
            {adjustmentModal.editingId ? t('save_changes') : t('adjustment_add')}
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
