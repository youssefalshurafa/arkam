'use client';

import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { formatAmountInput, normalizeDecimalInput, normalizePlainDecimalInput } from '@/shared/utils/decimal';
import { ltrIsolate } from '@/shared/utils/format';
import { localDateKey } from '@/shared/utils/date';
import { useLedgerStore } from '@/features/ledger/store/ledgerStore';
import ChargesEditFields from '@/shared/components/ChargesEditFields';
import type { Client, ClientAccount, ClientAccountLedger, Currency } from '@/shared/types';

type OneSidedTransactionModalProps = {
 selectedClientLedgers: ClientAccountLedger[];
 selectedClientForLedger: Client | null;
 localizedCurrencies: Currency[];
 clientAccounts: ClientAccount[];
 currencyMap: Map<number, Currency>;
 enabledCurrencies: Currency[];
 onSubmitOneSidedTransaction: () => void;
 lockPastEditsEnabled: boolean;
};

// A regular (non-adjustment) transaction with only one real party — the client whose ledger
// this was opened from. The other side is left unset (meaning "me" personally), so there's no
// second account picker; everything else (type, rate, commission, charges, description) is the
// same field set the Transactions page's own form has. See ledgerStore.ts's
// OneSidedTransactionModalState comment for why this doesn't share state with that form.
export default function OneSidedTransactionModal({
 selectedClientLedgers,
 selectedClientForLedger,
 localizedCurrencies,
 clientAccounts,
 currencyMap,
 enabledCurrencies,
 onSubmitOneSidedTransaction,
 lockPastEditsEnabled,
}: OneSidedTransactionModalProps) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const numLocale = language === 'fr' ? 'en-US' : language;
 const modal = useLedgerStore((s) => s.oneSidedTransactionModal);
 const ledgerDecimals = useLedgerStore((s) => s.ledgerDecimals);
 const setModal = useLedgerStore((s) => s.setOneSidedTransactionModal);
 const [expensesOpen, setExpensesOpen] = useState(false);

 return (
  <>
   {modal
    ? (() => {
       const ledger = selectedClientLedgers.find((l) => l.accountId === modal.accountId);
       const account = clientAccounts.find((a) => a.id === modal.accountId);
       const clientName = selectedClientForLedger?.name ?? '';
       const selectedCurrency = modal.currencyId ? currencyMap.get(modal.currencyId) : undefined;
       const accountCurrencyCode = account?.currencyCode ?? ledger?.currencyCode ?? '';
       const needsRate = !!(selectedCurrency && accountCurrencyCode && selectedCurrency.code !== accountCurrencyCode);
       const rawRate = parseFloat(modal.exchangeRate) || 0;
       const effectiveRate = modal.exchangeRateReversed ? (rawRate ? 1 / rawRate : 0) : rawRate;
       const amountValue = parseFloat(modal.amount) || 0;
       const convertedAmount = needsRate ? amountValue * (effectiveRate || 0) : amountValue;
       const isClientFrom = modal.direction === 'client_from';

       return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
         <div
          className="w-full max-w-md rounded bg-surface p-6 shadow-2xl"
          onKeyDown={(e) => {
           // Enter submits (ignore Enter inside multi-line fields).
           if (e.key !== 'Enter') return;
           if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
           e.preventDefault();
           void onSubmitOneSidedTransaction();
          }}
         >
          <h3 className="text-lg font-semibold text-fg">{t('one_sided_transaction_add')}</h3>
          {ledger ? (
           <p className="mt-1 text-sm text-fg-faint">
            {clientName} &mdash; {ledger.currencyName}
           </p>
          ) : null}
          <p className="mt-1 text-xs text-fg-faint">{t('one_sided_transaction_hint')}</p>

          <div className="mt-5 flex flex-col gap-4">
           <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('one_sided_direction_label')}</label>
            <div dir="ltr" className="grid grid-cols-2 gap-2">
             <button
              type="button"
              onClick={() => setModal((prev) => (prev ? { ...prev, direction: 'client_from' } : prev))}
              className={`rounded border px-3 py-2 text-sm font-semibold transition ${
               isClientFrom ? 'border-accent bg-accent-weak text-accent' : 'border-border-strong bg-surface text-fg-muted hover:bg-surface-hover'
              }`}
             >
              {t('transaction_account_from')}
             </button>
             <button
              type="button"
              onClick={() => setModal((prev) => (prev ? { ...prev, direction: 'client_to' } : prev))}
              className={`rounded border px-3 py-2 text-sm font-semibold transition ${
               !isClientFrom ? 'border-accent bg-accent-weak text-accent' : 'border-border-strong bg-surface text-fg-muted hover:bg-surface-hover'
              }`}
             >
              {t('transaction_account_to')}
             </button>
            </div>
            <p className="mt-1 text-xs text-fg-faint">{isClientFrom ? t('one_sided_client_from_hint') : t('one_sided_client_to_hint')}</p>
           </div>

           <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('one_sided_counter_party')}</label>
            <input
             type="text"
             value={modal.counterParty}
             onChange={(e) => setModal((prev) => (prev ? { ...prev, counterParty: e.target.value } : prev))}
             placeholder={t('one_sided_counter_party_placeholder')}
             className="rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
            />
           </div>

           <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('transaction_type')}</label>
            <select
             value={modal.type}
             onChange={(e) => setModal((prev) => (prev ? { ...prev, type: e.target.value } : prev))}
             className="rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
            >
             <option value="buy">{t('transaction_type_buy')}</option>
             <option value="sell">{t('transaction_type_sell')}</option>
             <option value="exchange">{t('transaction_type_exchange')}</option>
             <option value="transfer">{t('transaction_type_transfer')}</option>
            </select>
           </div>

           <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('amount')}</label>
            <input
             type="text"
             inputMode="decimal"
             dir="ltr"
             value={formatAmountInput(modal.amount)}
             onChange={(e) => setModal((prev) => (prev ? { ...prev, amount: normalizeDecimalInput(e.target.value) } : prev))}
             placeholder="0"
             autoFocus
             className="rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
            />
           </div>

           <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('currency')}</label>
            <select
             value={modal.currencyId ?? ''}
             onChange={(e) => setModal((prev) => (prev ? { ...prev, currencyId: e.target.value ? Number(e.target.value) : null, exchangeRate: '', exchangeRateReversed: false } : prev))}
             className="rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
            >
             {(modal.currencyId && !enabledCurrencies.some((c) => c.id === modal.currencyId)
              ? [...enabledCurrencies, ...localizedCurrencies.filter((c) => c.id === modal.currencyId)]
              : enabledCurrencies
             ).map((currency) => (
              <option key={currency.id} value={currency.id}>
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
                setModal((prev) => {
                 if (!prev) return prev;
                 const val = parseFloat(prev.exchangeRate) || 0;
                 return { ...prev, exchangeRate: val ? String(Number((1 / val).toFixed(6))) : prev.exchangeRate, exchangeRateReversed: !prev.exchangeRateReversed };
                })
               }
               className="inline-flex items-center gap-1 rounded p-1 text-xs text-fg-faint transition hover:bg-surface-hover hover:text-fg"
              >
               <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M7 4 3 8l4 4M3 8h13.5" />
                <path d="M17 20l4-4-4-4m4 4H7.5" />
               </svg>
               {modal.exchangeRateReversed ? t('rate_division') : t('rate_multiplication')}
              </button>
             </div>
             <span className="text-xs text-fg-faint">
              {modal.exchangeRateReversed
               ? ltrIsolate(`1 ${accountCurrencyCode} = ? ${selectedCurrency?.code ?? ''}`)
               : ltrIsolate(`1 ${selectedCurrency?.code ?? ''} = ? ${accountCurrencyCode}`)}
             </span>
             <input
              type="text"
              inputMode="decimal"
              dir="ltr"
              value={modal.exchangeRate}
              onChange={(e) => setModal((prev) => (prev ? { ...prev, exchangeRate: normalizePlainDecimalInput(e.target.value) } : prev))}
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
            <label className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('commission')} (%)</label>
            <input
             type="text"
             inputMode="decimal"
             dir="ltr"
             value={modal.commission}
             onChange={(e) => setModal((prev) => (prev ? { ...prev, commission: normalizePlainDecimalInput(e.target.value) } : prev))}
             placeholder="0"
             className="rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
            />
           </div>

           <div>
            <button
             type="button"
             onClick={() => setExpensesOpen((prev) => !prev)}
             className="text-sm font-medium text-accent hover:underline"
            >
             {expensesOpen ? '▾' : '▸'} {t('extra_expenses')}
            </button>
            {expensesOpen ? (
             <div className="mt-2 rounded border border-border bg-surface-2 p-3">
              <ChargesEditFields
               t={t}
               charges={modal.charges}
               onChargesChange={(value) => setModal((prev) => (prev ? { ...prev, charges: value } : prev))}
               chargesCurrencyId={modal.chargesCurrencyId}
               onChargesCurrencyIdChange={(value) => setModal((prev) => (prev ? { ...prev, chargesCurrencyId: value } : prev))}
               chargesPayer={modal.chargesPayer}
               onChargesPayerChange={(value) => setModal((prev) => (prev ? { ...prev, chargesPayer: value } : prev))}
               chargesDescription={modal.chargesDescription}
               onChargesDescriptionChange={(value) => setModal((prev) => (prev ? { ...prev, chargesDescription: value } : prev))}
               chargesExchangeRate={modal.chargesExchangeRate}
               onChargesExchangeRateChange={(value) => setModal((prev) => (prev ? { ...prev, chargesExchangeRate: value } : prev))}
               enabledCurrencies={enabledCurrencies}
               fromLabel={isClientFrom ? clientName || t('transaction_account_from') : modal.counterParty.trim() || t('charges_payer_me')}
               toLabel={isClientFrom ? modal.counterParty.trim() || t('charges_payer_me') : clientName || t('transaction_account_to')}
               meLabel={t('charges_payer_me')}
               rateTargetCurrencyCode={accountCurrencyCode}
              />
             </div>
            ) : null}
           </div>

           <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('transaction_description')}</label>
            <textarea
             value={modal.description}
             onChange={(e) => setModal((prev) => (prev ? { ...prev, description: e.target.value } : prev))}
             placeholder={t('transaction_description_placeholder')}
             className="min-h-16 rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
            />
           </div>

           <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('date')}</label>
            <input
             type="date"
             value={modal.date}
             max={localDateKey()}
             min={lockPastEditsEnabled ? localDateKey() : undefined}
             onChange={(e) => setModal((prev) => (prev ? { ...prev, date: e.target.value > localDateKey() ? localDateKey() : e.target.value } : prev))}
             className="rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
            />
           </div>
          </div>

          <div className="mt-5 flex justify-end gap-2">
           <button
            type="button"
            onClick={() => setModal(null)}
            className="rounded border border-border-strong px-4 py-2 text-sm font-semibold text-fg-muted hover:bg-surface-hover"
           >
            {t('cancel')}
           </button>
           <button
            type="button"
            onClick={() => void onSubmitOneSidedTransaction()}
            disabled={!modal.amount || parseFloat(modal.amount) <= 0 || !modal.currencyId}
            className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-40"
           >
            {t('save_transaction')}
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
