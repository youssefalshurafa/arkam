'use client';

import { useMemo, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { accountingApi } from '@/lib/accountingApi';
import { useAppStatusStore } from '@/shared/store/appStatusStore';
import { panelClassName } from '@/shared/styles';
import { normalizeDecimalInput, formatAmountInput, normalizePlainDecimalInput } from '@/shared/utils/decimal';
import { formatRateValue } from '@/shared/utils/format';
import { localDateKey } from '@/shared/utils/date';
import { nextCreatedAtForDate } from '@/shared/utils/createdAt';
import { filterRealClientAccounts, cashboxOwnerName } from '@/shared/utils/systemAccounts';
import AccountSearchSelect from '@/features/transactions/components/AccountSearchSelect';
import type { ClientAccount, ClientAdjustment, Currency, SystemClient, Transaction } from '@/shared/types';

type Direction = 'pays' | 'receives';
type CounterpartyKind = 'client' | 'transfer';

type SystemEntryFormProps = {
 mode: 'treasury' | 'cashbox';
 fixedSystemClient: SystemClient;
 clientAccounts: ClientAccount[];
 systemClients: SystemClient[];
 enabledCurrencies: Currency[];
 transactions: Transaction[];
 adjustments: ClientAdjustment[];
 lockPastEditsEnabled: boolean;
 isRTL: boolean;
 onSubmitted: () => void;
};

export default function SystemEntryForm({
 mode,
 fixedSystemClient,
 clientAccounts,
 systemClients,
 enabledCurrencies,
 transactions,
 adjustments,
 lockPastEditsEnabled,
 isRTL,
 onSubmitted,
}: SystemEntryFormProps) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const setError = useAppStatusStore((s) => s.setError);
 const showToast = useAppStatusStore((s) => s.showToast);

 const mainCurrency = useMemo(() => enabledCurrencies.find((c) => c.isMain === 1) ?? null, [enabledCurrencies]);
 const realClientAccounts = useMemo(() => filterRealClientAccounts(clientAccounts), [clientAccounts]);
 // In treasury mode, the only transfer counterparty is a cashbox; in cashbox mode, the only
 // transfer counterparty is Treasury itself — cashbox<->cashbox transfers are out of scope.
 const transferTargets = useMemo(
  () => (mode === 'treasury' ? systemClients.filter((c) => c.systemKind === 'cashbox') : systemClients.filter((c) => c.systemKind === 'treasury')),
  [mode, systemClients],
 );

 const [direction, setDirection] = useState<Direction>('receives');
 const [counterpartyKind, setCounterpartyKind] = useState<CounterpartyKind>('client');
 const [counterpartyAccountId, setCounterpartyAccountId] = useState<number | null>(null);
 const [transferTargetId, setTransferTargetId] = useState<number | null>(null);
 // Only used in cashbox mode — which of this cashbox's currency buckets this entry affects.
 // Treasury mode has no picker: it always operates in the workspace's single main currency.
 const [currencyId, setCurrencyId] = useState<number | null>(null);
 const [amount, setAmount] = useState('');
 const [rate, setRate] = useState('1.00');
 const [rateReversed, setRateReversed] = useState(false);
 const [description, setDescription] = useState('');
 const [date, setDate] = useState(() => localDateKey());
 const [isSubmitting, setIsSubmitting] = useState(false);

 const counterpartyAccount = counterpartyAccountId != null ? (realClientAccounts.find((a) => a.id === counterpartyAccountId) ?? null) : null;

 // The currency this entry is denominated in: the cashbox's chosen bucket, or Treasury's
 // single main currency (never user-selectable in treasury mode).
 const effectiveCurrencyId = mode === 'treasury' ? (mainCurrency?.id ?? null) : (currencyId ?? counterpartyAccount?.currencyId ?? mainCurrency?.id ?? null);

 // The counterparty's own currency — only relevant to decide whether a conversion rate is
 // needed; the fixed (Treasury/this cashbox) side's rate is always 1 by construction, since
 // effectiveCurrencyId is defined to already match its account.
 const counterpartyCurrencyId =
  counterpartyKind === 'client' ? (counterpartyAccount?.currencyId ?? null) : mode === 'cashbox' ? (mainCurrency?.id ?? null) : effectiveCurrencyId;

 const needsRate = effectiveCurrencyId != null && counterpartyCurrencyId != null && effectiveCurrencyId !== counterpartyCurrencyId;

 const canSubmit =
  effectiveCurrencyId != null &&
  Number(normalizeDecimalInput(amount)) > 0 &&
  (counterpartyKind === 'client' ? counterpartyAccountId != null : transferTargetId != null) &&
  (!needsRate || Number(normalizePlainDecimalInput(rate)) > 0) &&
  !isSubmitting;

 const resetForm = () => {
  setDirection('receives');
  setCounterpartyKind('client');
  setCounterpartyAccountId(null);
  setTransferTargetId(null);
  setCurrencyId(null);
  setAmount('');
  setRate('1.00');
  setRateReversed(false);
  setDescription('');
  setDate(localDateKey());
 };

 const onSubmit = async () => {
  if (!canSubmit || effectiveCurrencyId == null) return;
  setIsSubmitting(true);
  try {
   const fixedAccount = await accountingApi.ensureSystemAccount({ systemClientId: fixedSystemClient.id, currencyId: effectiveCurrencyId });

   let counterpartyResolvedAccountId: number | null = null;
   if (counterpartyKind === 'client') {
    counterpartyResolvedAccountId = counterpartyAccountId;
   } else if (transferTargetId != null && counterpartyCurrencyId != null) {
    const counterpartyAccountResult = await accountingApi.ensureSystemAccount({ systemClientId: transferTargetId, currencyId: counterpartyCurrencyId });
    counterpartyResolvedAccountId = counterpartyAccountResult.accountId;
   }
   if (counterpartyResolvedAccountId == null) {
    setError(t('treasury_entry_counterparty_client'));
    return;
   }

   const amountValue = Number(normalizeDecimalInput(amount)) || 0;
   const rawRate = Number(normalizePlainDecimalInput(rate)) || 1;
   const counterpartyRate = needsRate ? (rateReversed ? 1 / rawRate : rawRate) : 1;

   const accountFromId = direction === 'pays' ? fixedAccount.accountId : counterpartyResolvedAccountId;
   const accountToId = direction === 'pays' ? counterpartyResolvedAccountId : fixedAccount.accountId;
   const exchangeRateFrom = direction === 'pays' ? 1 : counterpartyRate;
   const exchangeRateTo = direction === 'pays' ? counterpartyRate : 1;
   const exchangeRateFromReversed = direction === 'receives' && needsRate && rateReversed;
   const exchangeRateToReversed = direction === 'pays' && needsRate && rateReversed;

   const createdAt = nextCreatedAtForDate(date, transactions, adjustments);

   await accountingApi.createTransaction({
    accountFromId,
    accountToId,
    currencyId: effectiveCurrencyId,
    amount: amountValue,
    type: 'transfer',
    exchangeRateFrom,
    exchangeRateTo,
    exchangeRateFromReversed,
    exchangeRateToReversed,
    commissionFrom: 0,
    commissionTo: 0,
    charges: 0,
    chargesCurrencyId: null,
    chargesPayer: '',
    chargesExchangeRate: 1,
    chargesDescription: '',
    description: description.trim(),
    createdAt,
   });

   showToast(t('toast_transaction_updated'));
   resetForm();
   onSubmitted();
  } catch (error) {
   setError(error instanceof Error ? error.message : t('error_failed_save'));
  } finally {
   setIsSubmitting(false);
  }
 };

 return (
  <div className={`${panelClassName} flex flex-col gap-4`}>
   <div className="flex flex-wrap items-center gap-2">
    <button
     type="button"
     onClick={() => setDirection('receives')}
     className={`rounded px-3 py-1.5 text-sm font-medium transition ${direction === 'receives' ? 'bg-good-bg text-good-text' : 'bg-surface-2 text-fg-muted hover:bg-surface-hover'}`}
    >
     {t('treasury_entry_direction_receives')}
    </button>
    <button
     type="button"
     onClick={() => setDirection('pays')}
     className={`rounded px-3 py-1.5 text-sm font-medium transition ${direction === 'pays' ? 'bg-bad-bg text-bad-text' : 'bg-surface-2 text-fg-muted hover:bg-surface-hover'}`}
    >
     {t('treasury_entry_direction_pays')}
    </button>
   </div>

   <div className="flex flex-wrap items-center gap-2">
    <button
     type="button"
     onClick={() => {
      setCounterpartyKind('client');
      setTransferTargetId(null);
     }}
     className={`rounded px-3 py-1.5 text-sm font-medium transition ${counterpartyKind === 'client' ? 'bg-accent-weak text-accent' : 'bg-surface-2 text-fg-muted hover:bg-surface-hover'}`}
    >
     {t('treasury_entry_counterparty_client')}
    </button>
    {transferTargets.length > 0 ? (
     <button
      type="button"
      onClick={() => {
       setCounterpartyKind('transfer');
       setCounterpartyAccountId(null);
       if (transferTargets.length === 1) setTransferTargetId(transferTargets[0].id);
      }}
      className={`rounded px-3 py-1.5 text-sm font-medium transition ${counterpartyKind === 'transfer' ? 'bg-accent-weak text-accent' : 'bg-surface-2 text-fg-muted hover:bg-surface-hover'}`}
     >
      {mode === 'cashbox' ? t('treasury_entry_counterparty_treasury') : t('treasury_entry_counterparty_cashbox')}
     </button>
    ) : null}
   </div>

   {counterpartyKind === 'client' ? (
    <label className="flex flex-col gap-1 text-sm text-fg-muted">
     {t('treasury_entry_counterparty_client')}
     <AccountSearchSelect
      accounts={realClientAccounts}
      value={counterpartyAccountId}
      onChange={setCounterpartyAccountId}
      placeholder={t('transaction_account_placeholder')}
      clearLabel={t('clear_selection')}
      isRTL={isRTL}
     />
    </label>
   ) : transferTargets.length > 1 ? (
    <label className="flex flex-col gap-1 text-sm text-fg-muted">
     {t('treasury_entry_counterparty_cashbox')}
     <select
      value={transferTargetId ?? ''}
      onChange={(event) => setTransferTargetId(event.target.value ? Number(event.target.value) : null)}
      className="rounded border border-border-strong bg-surface px-2 py-1.5 text-sm text-fg outline-none focus:ring-1 focus:ring-accent"
     >
      <option value="">{t('transaction_account_placeholder')}</option>
      {transferTargets.map((target) => (
       <option
        key={target.id}
        value={target.id}
       >
        {target.systemKind === 'treasury' ? t('treasury_tab_treasury') : t('treasury_cashbox_of', { name: cashboxOwnerName(target) })}
       </option>
      ))}
     </select>
    </label>
   ) : null}

   <div className="grid grid-cols-2 gap-3">
    <label className="flex flex-col gap-1 text-sm text-fg-muted">
     {t('treasury_entry_amount')}
     <input
      type="text"
      inputMode="decimal"
      value={formatAmountInput(amount)}
      onChange={(event) => setAmount(normalizeDecimalInput(event.target.value))}
      className="rounded border border-border-strong bg-surface px-2 py-1.5 text-sm text-fg outline-none focus:ring-1 focus:ring-accent"
     />
    </label>
    <label className="flex flex-col gap-1 text-sm text-fg-muted">
     {t('treasury_entry_currency')}
     {mode === 'treasury' ? (
      <span className="rounded border border-border-strong bg-surface-2 px-2 py-1.5 text-sm text-fg-muted">{mainCurrency?.code ?? '-'}</span>
     ) : (
      <select
       value={currencyId ?? ''}
       onChange={(event) => setCurrencyId(event.target.value ? Number(event.target.value) : null)}
       className="rounded border border-border-strong bg-surface px-2 py-1.5 text-sm text-fg outline-none focus:ring-1 focus:ring-accent"
      >
       <option value="">{t('treasury_entry_currency')}</option>
       {enabledCurrencies.map((currency) => (
        <option
         key={currency.id}
         value={currency.id}
        >
         {currency.code}
        </option>
       ))}
      </select>
     )}
    </label>
   </div>

   {needsRate ? (
    <div className="flex items-end gap-2">
     <label className="flex flex-1 flex-col gap-1 text-sm text-fg-muted">
      {t('exchange_rate')}
      <input
       type="text"
       inputMode="decimal"
       value={rate}
       onChange={(event) => setRate(normalizePlainDecimalInput(event.target.value))}
       onBlur={() => setRate(formatRateValue(Number(rate) || 1))}
       className="rounded border border-border-strong bg-surface px-2 py-1.5 text-sm text-fg outline-none focus:ring-1 focus:ring-accent"
      />
     </label>
     <button
      type="button"
      onClick={() => setRateReversed((prev) => !prev)}
      title={rateReversed ? '÷' : '×'}
      className="rounded border border-border-strong bg-surface-2 px-3 py-1.5 text-sm font-semibold text-fg-muted hover:bg-surface-hover"
     >
      {rateReversed ? '÷' : '×'}
     </button>
    </div>
   ) : null}

   <label className="flex flex-col gap-1 text-sm text-fg-muted">
    {t('treasury_entry_description')}
    <input
     type="text"
     value={description}
     onChange={(event) => setDescription(event.target.value)}
     className="rounded border border-border-strong bg-surface px-2 py-1.5 text-sm text-fg outline-none focus:ring-1 focus:ring-accent"
    />
   </label>

   <label className="flex flex-col gap-1 text-sm text-fg-muted">
    {t('treasury_entry_date')}
    <input
     type="date"
     value={date}
     max={localDateKey()}
     min={lockPastEditsEnabled ? localDateKey() : undefined}
     onChange={(event) => setDate(event.target.value)}
     className="rounded border border-border-strong bg-surface px-2 py-1.5 text-sm text-fg outline-none focus:ring-1 focus:ring-accent"
    />
   </label>

   <button
    type="button"
    disabled={!canSubmit}
    onClick={() => void onSubmit()}
    className="rounded bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
   >
    {t('treasury_entry_submit')}
   </button>
  </div>
 );
}
