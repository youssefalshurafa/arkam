'use client';

import { useMemo, useState } from 'react';
import type { FormEvent, KeyboardEvent, RefObject } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useStableSession } from '@/hooks/useStableSession';
import { useTranslation } from '@/hooks/useTranslation';
import { getStoredExchangeSettings } from '@/shared/lib/localStorage';
import { formatAmountInput, normalizeDecimalInput, normalizePlainDecimalInput } from '@/shared/utils/decimal';
import { parseChargesPayer, combineChargesPayer, type ChargesPayerParty } from '@/shared/utils/commission';
import { ltrIsolate } from '@/shared/utils/format';
import { localDateKey } from '@/shared/utils/date';
import ChargesPayerSelects from '@/shared/components/ChargesPayerSelects';
import { useTransactionsStore } from '@/features/transactions/store/transactionsStore';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { useAiParseTransaction } from '@/features/transactions/hooks/useAiParseTransaction';
import { useSpeechToText } from '@/shared/hooks/useSpeechToText';
import { useDescriptionSuggestions } from '@/shared/hooks/useDescriptionSuggestions';
import { DescriptionSuggestField } from '@/shared/components/DescriptionSuggestField';
import AccountSearchSelect from '@/features/transactions/components/AccountSearchSelect';
import { buildAccountOptions, type AccountOption } from '@/features/transactions/utils/accountOptions';
import { filterRealClientAccounts } from '@/shared/utils/systemAccounts';
import type { ClientAccount, Currency, Section, Transaction } from '@/shared/types';

type NewTransactionFormProps = {
 clientAccounts: ClientAccount[];
 clientAccountMap: Map<number, ClientAccount>;
 enabledCurrencies: Currency[];
 currencyMap: Map<number, Currency>;
 transactions: Transaction[];
 // Only the `!== 'archive'` check matters here (hides the "adjustment" type option and swaps
 // the exchange "actual amount" block for the plain Extra Expenses one) — any non-archive
 // section value behaves identically, so the ledger modal just passes 'client-ledger'.
 section: Section;
 lockPastEditsEnabled: boolean;
 onTransactionSubmit: (event: FormEvent<HTMLFormElement>, onCreated?: () => void) => void;
 // Only needed by TransactionsSection's own header "save" icon button, which submits the form
 // via ref instead of scrolling down to the submit button. The ledger modal has no such shortcut.
 formRef?: RefObject<HTMLFormElement | null>;
 // Ledger-modal only: when set, a new (non-edit) save offers two submit buttons — one keeps the
 // form open for another entry (the existing default behavior), the other calls this to close
 // the modal after a successful save. Omitted elsewhere (Transactions page), which keeps the
 // single always-stays-open button unchanged.
 onSaveAndClose?: () => void;
};

/**
 * The create/update-transaction form: type, date, amount+currency, both account pickers (or the
 * one-sided direction-toggle variant for "adjustment"), rate/commission, charges, description.
 * Shared between the Transactions page's inline panel and the client ledger's "New Transaction"
 * modal — its data lives entirely in useTransactionsStore (transactionForm and friends), so any
 * mount of this component reads/writes the same in-progress draft.
 */
export default function NewTransactionForm({ clientAccounts, clientAccountMap, enabledCurrencies, currencyMap, transactions, section, lockPastEditsEnabled, onTransactionSubmit, formRef, onSaveAndClose }: NewTransactionFormProps) {
 const { language, isRTL } = useLanguage();
 const { t } = useTranslation(language);

 const transactionForm = useTransactionsStore((s) => s.transactionForm);
 const setTransactionForm = useTransactionsStore((s) => s.setTransactionForm);
 const isSubmittingTransaction = useTransactionsStore((s) => s.isSubmittingTransaction);
 const txSplitDescription = useTransactionsStore((s) => s.txSplitDescription);
 const setTxSplitDescription = useTransactionsStore((s) => s.setTxSplitDescription);
 const newTransactionDate = useTransactionsStore((s) => s.newTransactionDate);
 const setNewTransactionDate = useTransactionsStore((s) => s.setNewTransactionDate);
 const editingTransaction = useTransactionsStore((s) => s.editingTransaction);
 const txFromQuery = useTransactionsStore((s) => s.txFromQuery);
 const setTxFromQuery = useTransactionsStore((s) => s.setTxFromQuery);
 const txFromOpen = useTransactionsStore((s) => s.txFromOpen);
 const setTxFromOpen = useTransactionsStore((s) => s.setTxFromOpen);
 const txFromExpandedClient = useTransactionsStore((s) => s.txFromExpandedClient);
 const setTxFromExpandedClient = useTransactionsStore((s) => s.setTxFromExpandedClient);
 const txToQuery = useTransactionsStore((s) => s.txToQuery);
 const setTxToQuery = useTransactionsStore((s) => s.setTxToQuery);
 const txToOpen = useTransactionsStore((s) => s.txToOpen);
 const setTxToOpen = useTransactionsStore((s) => s.setTxToOpen);
 const txToExpandedClient = useTransactionsStore((s) => s.txToExpandedClient);
 const setTxToExpandedClient = useTransactionsStore((s) => s.setTxToExpandedClient);
 const txFromRateReversed = useTransactionsStore((s) => s.txFromRateReversed);
 const setTxFromRateReversed = useTransactionsStore((s) => s.setTxFromRateReversed);
 const txToRateReversed = useTransactionsStore((s) => s.txToRateReversed);
 const setTxToRateReversed = useTransactionsStore((s) => s.setTxToRateReversed);
 const isNewTransactionExpensesOpen = useTransactionsStore((s) => s.isNewTransactionExpensesOpen);
 const setIsNewTransactionExpensesOpen = useTransactionsStore((s) => s.setIsNewTransactionExpensesOpen);

 // Exchange (صرف) transactions get the الفعلي (actual settled destination amount) section in
 // place of the "Extra Expenses" block. Archive-only records never touch a ledger, so they keep
 // the plain Extra Expenses behaviour.
 const isExchangeTransaction = section !== 'archive' && transactionForm.type === 'exchange';

 const transactionSelectedCurrencyCode = transactionForm.currencyId ? currencyMap.get(transactionForm.currencyId)?.code : undefined;
 const transactionAccountFromCurrencyCode = transactionForm.accountFromId ? clientAccountMap.get(transactionForm.accountFromId)?.currencyCode : undefined;
 const transactionAccountToCurrencyCode = transactionForm.accountToId ? clientAccountMap.get(transactionForm.accountToId)?.currencyCode : undefined;
 const showExchangeRateFrom = !(transactionSelectedCurrencyCode && transactionAccountFromCurrencyCode && transactionSelectedCurrencyCode === transactionAccountFromCurrencyCode);
 const showExchangeRateTo = !(transactionSelectedCurrencyCode && transactionAccountToCurrencyCode && transactionSelectedCurrencyCode === transactionAccountToCurrencyCode);

 // Natural-language "fill from text" affordance on the new-transaction form (AI features only,
 // hidden otherwise). Never submits anything itself — it only pre-fills the same draft form the
 // user would otherwise fill by hand, so the existing Save button is still the human review step.
 const aiSettings = useSettingsStore((s) => s.aiSettings);
 const { data: authSession } = useStableSession();
 const aiFeatureAccess = aiSettings.enabled && authSession?.user?.aiEnabled === true;
 const { parseTransactionText, stop: stopAiParse } = useAiParseTransaction();
 const [aiParseText, setAiParseText] = useState('');
 const [isParsingWithAi, setIsParsingWithAi] = useState(false);
 const onFillFromText = async (overrideText?: string) => {
  const text = (overrideText ?? aiParseText).trim();
  if (!text) return;
  setIsParsingWithAi(true);
  try {
   const parsed = await parseTransactionText(text, clientAccounts, enabledCurrencies, newTransactionDate);
   if (!parsed) return;
   setTransactionForm((current) => ({
    ...current,
    ...(parsed.type != null ? { type: parsed.type } : {}),
    ...(parsed.accountFromId != null ? { accountFromId: parsed.accountFromId } : {}),
    ...(parsed.accountToId != null ? { accountToId: parsed.accountToId } : {}),
    ...(parsed.currencyId != null ? { currencyId: parsed.currencyId } : {}),
    ...(parsed.amount != null ? { amount: String(parsed.amount) } : {}),
    ...(parsed.exchangeRateFrom != null ? { exchangeRateFrom: String(parsed.exchangeRateFrom) } : {}),
    ...(parsed.commissionFrom != null ? { commissionFrom: String(parsed.commissionFrom) } : {}),
    ...(parsed.exchangeRateTo != null ? { exchangeRateTo: String(parsed.exchangeRateTo) } : {}),
    ...(parsed.commissionTo != null ? { commissionTo: String(parsed.commissionTo) } : {}),
    ...(parsed.description != null ? { description: parsed.description } : {}),
    ...(parsed.charges != null ? { charges: String(parsed.charges) } : {}),
    ...(parsed.chargesCurrencyId != null ? { chargesCurrencyId: parsed.chargesCurrencyId } : {}),
    ...(parsed.chargesDescription != null ? { chargesDescription: parsed.chargesDescription } : {}),
    ...(parsed.chargesPayer != null ? { chargesPayer: parsed.chargesPayer } : {}),
   }));
   if (parsed.date) setNewTransactionDate(parsed.date);
   setAiParseText('');
  } finally {
   setIsParsingWithAi(false);
  }
 };
 const speechLang = language === 'ar' ? 'ar-SA' : language === 'fr' ? 'fr-FR' : 'en-US';
 const {
  isSupported: isSpeechSupported,
  isListening,
  isUnsupportedEnv: isSpeechUnsupportedEnv,
  start: startListening,
  stop: stopListening,
 } = useSpeechToText(speechLang, (transcript) => {
  if (!transcript) return;
  // Auto-submit once voice input ends, same as pressing Enter would — this only runs the
  // (reviewable, non-destructive) parse step, not a save, so nothing is written automatically.
  const combined = aiParseText.trim() ? `${aiParseText.trim()} ${transcript}` : transcript;
  setAiParseText(combined);
  void onFillFromText(combined);
 });

 // Keyboard navigation for the From/To account pickers: the highlighted index tracks the row
 // that ↑/↓ move through and Enter activates. The option lists are flattened from the same
 // grouping the dropdowns render, so index N always points at the Nth rendered row.
 const [txFromHighlight, setTxFromHighlight] = useState(0);
 const [txToHighlight, setTxToHighlight] = useState(0);
 // Max allowed deviation (in the destination currency) between the entered الفعلي actual amount
 // and the computed amount × rate. Enforced authoritatively at submit; used here for the live hint.
 const [exchangeTolerance] = useState(() => getStoredExchangeSettings().tolerance);
 // Treasury/Cashbox accounts are ordinary client_accounts rows (see ClientAccount.isSystem) and
 // must never appear as a selectable "real client" in this ordinary transaction form's pickers.
 const realClientAccounts = useMemo(() => filterRealClientAccounts(clientAccounts), [clientAccounts]);
 const txFromOptions = useMemo(() => buildAccountOptions(realClientAccounts, txFromQuery, txFromExpandedClient), [realClientAccounts, txFromQuery, txFromExpandedClient]);
 const txToOptions = useMemo(() => buildAccountOptions(realClientAccounts, txToQuery, txToExpandedClient), [realClientAccounts, txToQuery, txToExpandedClient]);

 const { suggestions: descriptionSuggestions, excludeSuggestion: excludeDescriptionSuggestion } = useDescriptionSuggestions({
  transactions,
  query: transactionForm.description,
  accountIds: [transactionForm.accountFromId, transactionForm.accountToId],
 });

 // Defaults the amount's currency to the first account picked (unless the user already chose
 // one), so the "1 X = ? Y" rate hint and reverse icon show up right away instead of staying on
 // the generic placeholder label until a separate, easy-to-miss currency pick.
 const defaultCurrencyIdForAccount = (id: number) => {
  const currencyId = clientAccountMap.get(id)?.currencyId;
  return currencyId != null && enabledCurrencies.some((c) => c.id === currencyId) ? currencyId : null;
 };
 const selectFromAccount = (id: number) => {
  const defaultCurrencyId = defaultCurrencyIdForAccount(id);
  setTransactionForm((current) => ({ ...current, accountFromId: id, currencyId: current.currencyId ?? defaultCurrencyId }));
  setTxFromQuery('');
  setTxFromOpen(false);
  setTxFromExpandedClient(null);
 };
 const selectToAccount = (id: number) => {
  const defaultCurrencyId = defaultCurrencyIdForAccount(id);
  setTransactionForm((current) => ({ ...current, accountToId: id, currencyId: current.currencyId ?? defaultCurrencyId }));
  setTxToQuery('');
  setTxToOpen(false);
  setTxToExpandedClient(null);
 };

 // Swaps the two parties: everything that's tracked per-side (the account, its rate,
 // commission, description, rate-reversed flag, and whichever end of chargesPayer points at
 // "from"/"to") moves together so the swap reads as "these two traded places", not just the
 // account picks. Search/dropdown state is transient UI, not data, so it's cleared instead of
 // swapped.
 const swapFromToParties = () => {
  const flipParty = (party: ChargesPayerParty): ChargesPayerParty => (party === 'from' ? 'to' : party === 'to' ? 'from' : party);
  setTransactionForm((current) => {
   const { payer, payee } = parseChargesPayer(current.chargesPayer);
   return {
    ...current,
    accountFromId: current.accountToId,
    accountToId: current.accountFromId,
    exchangeRateFrom: current.exchangeRateTo,
    exchangeRateTo: current.exchangeRateFrom,
    commissionFrom: current.commissionTo,
    commissionTo: current.commissionFrom,
    descriptionFrom: current.descriptionTo,
    descriptionTo: current.descriptionFrom,
    chargesPayer: combineChargesPayer(flipParty(payer), flipParty(payee)),
   };
  });
  setTxFromRateReversed(txToRateReversed);
  setTxToRateReversed(txFromRateReversed);
  setTxFromQuery('');
  setTxToQuery('');
  setTxFromOpen(false);
  setTxToOpen(false);
 };

 // "Adjustment" transactions are one-sided: exactly one of accountFromId/accountToId holds the
 // picked client account (the other stays null, meaning "the counterparty text field instead").
 // Direction is derived from which side is populated rather than tracked as separate state,
 // defaulting to accountFromId (creditor/دائن) until the user explicitly toggles it.
 const oneSidedDirection: 'client_from' | 'client_to' = transactionForm.accountToId != null && transactionForm.accountFromId == null ? 'client_to' : 'client_from';
 const oneSidedAccountId = oneSidedDirection === 'client_to' ? transactionForm.accountToId : transactionForm.accountFromId;
 const setOneSidedDirection = (direction: 'client_from' | 'client_to') => {
  setTransactionForm((current) => {
   const activeId = current.accountFromId ?? current.accountToId;
   return direction === 'client_from' ? { ...current, accountFromId: activeId, accountToId: null } : { ...current, accountFromId: null, accountToId: activeId };
  });
 };
 const selectOneSidedAccount = (id: number | null) => {
  const defaultCurrencyId = id != null ? defaultCurrencyIdForAccount(id) : null;
  setTransactionForm((current) => ({
   ...current,
   accountFromId: oneSidedDirection === 'client_from' ? id : null,
   accountToId: oneSidedDirection === 'client_to' ? id : null,
   currencyId: current.currencyId ?? defaultCurrencyId,
  }));
 };

 // Shared arrow/Enter/Escape behaviour for both pickers. Enter on a group header expands or
 // collapses it (keeping the highlight put so the user can arrow into its accounts); Enter on
 // an account selects it.
 const handleAccountPickerKeyDown = (
  event: KeyboardEvent<HTMLInputElement>,
  isOpen: boolean,
  options: AccountOption[],
  highlight: number,
  setHighlight: (updater: (h: number) => number) => void,
  toggleExpanded: (clientId: number, expanded: boolean) => void,
  selectAccount: (id: number) => void,
  close: () => void,
 ) => {
  // Dropdown closed → let the keystroke do its normal thing (e.g. Enter submits the form).
  if (!isOpen) return;
  if (event.key === 'ArrowDown') {
   event.preventDefault();
   setHighlight((h) => (options.length ? (h + 1) % options.length : 0));
  } else if (event.key === 'ArrowUp') {
   event.preventDefault();
   setHighlight((h) => (options.length ? (h - 1 + options.length) % options.length : 0));
  } else if (event.key === 'Enter') {
   const option = options[highlight];
   if (!option) return;
   event.preventDefault();
   if (option.kind === 'group') toggleExpanded(option.clientId, option.expanded);
   else selectAccount(option.account.id);
  } else if (event.key === 'Escape') {
   close();
  }
 };

 // Which button triggered the submit — read from the native SubmitEvent's `submitter` so the
 // two ledger-modal buttons (see below) can share one <form onSubmit> instead of needing
 // separate handlers. Only the "close" button's value carries `onSaveAndClose` through; the
 // "keep open" button (and the Transactions page's single button) passes nothing, so the
 // handler falls back to its existing "stay open" behavior.
 const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
  const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
  const closeAfter = onSaveAndClose && submitter?.value === 'close' ? onSaveAndClose : undefined;
  onTransactionSubmit(event, closeAfter);
 };

 return (
           <form
            ref={formRef}
            onSubmit={handleFormSubmit}
            className="mt-5 max-w-md"
           >
            {aiFeatureAccess ? (
             <div className="mb-4 rounded border border-border-strong bg-surface-2 p-3">
              <label className="block text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('ai_fill_label')}</label>
              {isSpeechUnsupportedEnv ? <p className="mt-1 text-xs text-fg-faint">{t('ai_fill_voice_unsupported')}</p> : null}
              {isParsingWithAi ? <p className="mt-1 animate-pulse text-xs text-fg-faint">{t('ai_processing')}</p> : null}
              <div className="mt-2 flex gap-2">
               <input
                type="text"
                value={aiParseText}
                onChange={(event) => setAiParseText(event.target.value)}
                onKeyDown={(event) => {
                 if (event.key === 'Enter') {
                  event.preventDefault();
                  void onFillFromText();
                 }
                }}
                placeholder={t('ai_fill_placeholder')}
                className="min-w-0 flex-1 rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
               />
               {isSpeechSupported ? (
                <button
                 type="button"
                 title={isListening ? t('ai_fill_voice_listening') : t('ai_fill_voice_button')}
                 aria-label={isListening ? t('ai_fill_voice_listening') : t('ai_fill_voice_button')}
                 onClick={() => (isListening ? stopListening() : startListening())}
                 className={`shrink-0 rounded border px-3 py-2 text-sm transition ${
                  isListening ? 'animate-pulse border-red-500 bg-bad-bg text-bad-text' : 'border-border-strong bg-surface text-fg-muted hover:bg-surface-hover'
                 }`}
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
                  <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
                  <path d="M12 18v4M9 22h6" />
                 </svg>
                </button>
               ) : null}
               {isParsingWithAi ? (
                <button
                 type="button"
                 onClick={() => stopAiParse()}
                 title={t('ai_stop')}
                 aria-label={t('ai_stop')}
                 className="shrink-0 rounded border border-bad-text bg-bad-bg px-3 py-2 text-bad-text transition hover:opacity-80"
                >
                 <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                 </svg>
                </button>
               ) : (
                <button
                 type="button"
                 disabled={!aiParseText.trim()}
                 onClick={() => void onFillFromText()}
                 className="shrink-0 rounded border border-border-strong bg-surface px-3 py-2 text-sm font-semibold text-fg-muted transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
                >
                 {t('ai_fill_button')}
                </button>
               )}
              </div>
             </div>
            ) : null}

            <label className="block text-sm font-medium">{t('transaction_type')}</label>
            <select
             value={transactionForm.type}
             onChange={(event) => setTransactionForm((current) => ({ ...current, type: event.target.value }))}
             className="mt-2 w-full rounded border border-border-strong px-3 py-2 outline-none ring-blue-300 focus:ring"
            >
             <option value="exchange">{t('transaction_type_exchange')}</option>
             <option value="transfer">{t('transaction_type_transfer')}</option>
             {section === 'archive' ? null : <option value="adjustment">{t('transaction_type_adjustment')}</option>}
            </select>

            <label className="mt-4 block text-sm font-medium">{t('date')}</label>
            <input
             type="date"
             value={newTransactionDate}
             max={localDateKey()}
             min={lockPastEditsEnabled && section !== 'archive' ? localDateKey() : undefined}
             onChange={(event) => setNewTransactionDate(event.target.value > localDateKey() ? localDateKey() : event.target.value)}
             className="mt-2 w-full rounded border border-border-strong px-3 py-2 outline-none ring-blue-300 focus:ring"
            />

            <label className="mt-4 block text-sm font-medium">{t('transaction_amount')}</label>
            <div className="mt-2 flex gap-2">
             <input
              type="text"
              inputMode="decimal"
              dir="ltr"
              value={transactionForm.amount}
              onChange={(event) => setTransactionForm((current) => ({ ...current, amount: formatAmountInput(event.target.value) }))}
              className="min-w-0 flex-1 rounded border border-border-strong px-3 py-2 outline-none ring-blue-300 focus:ring"
              placeholder="0.00"
              required
             />
             <select
              value={transactionForm.currencyId ?? ''}
              onChange={(event) =>
               setTransactionForm((current) => ({
                ...current,
                currencyId: event.target.value ? Number(event.target.value) : null,
               }))
              }
              className="w-28 rounded border border-border-strong px-2 py-2 text-sm outline-none ring-blue-300 focus:ring"
              required
             >
              <option value="">{t('transaction_currency_placeholder')}</option>
              {enabledCurrencies.map((cur) => (
               <option
                key={cur.id}
                value={cur.id}
               >
                {cur.code}
               </option>
              ))}
             </select>
            </div>

            {transactionForm.type === 'adjustment' ? (
             <>
              <label className="mt-4 block text-sm font-medium">{t('one_sided_direction_label')}</label>
              <div dir="ltr" className="mt-2 grid grid-cols-2 gap-2">
               <button
                type="button"
                onClick={() => setOneSidedDirection('client_from')}
                className={`rounded border px-3 py-2 text-sm font-semibold transition ${
                 oneSidedDirection === 'client_from' ? 'border-accent bg-accent-weak text-accent' : 'border-border-strong bg-surface text-fg-muted hover:bg-surface-hover'
                }`}
               >
                {t('transaction_account_from')}
               </button>
               <button
                type="button"
                onClick={() => setOneSidedDirection('client_to')}
                className={`rounded border px-3 py-2 text-sm font-semibold transition ${
                 oneSidedDirection === 'client_to' ? 'border-accent bg-accent-weak text-accent' : 'border-border-strong bg-surface text-fg-muted hover:bg-surface-hover'
                }`}
               >
                {t('transaction_account_to')}
               </button>
              </div>
              <p className="mt-1 text-xs text-fg-faint">{oneSidedDirection === 'client_from' ? t('one_sided_client_from_hint') : t('one_sided_client_to_hint')}</p>

              <label className="mt-4 block text-sm font-medium">{oneSidedDirection === 'client_from' ? t('transaction_account_from') : t('transaction_account_to')}</label>
              <div className="mt-2">
               <AccountSearchSelect
                accounts={realClientAccounts}
                value={oneSidedAccountId}
                onChange={selectOneSidedAccount}
                placeholder={t('transaction_account_placeholder')}
                clearLabel={t('clear_selection')}
                isRTL={isRTL}
               />
              </div>

              <label className="mt-4 block text-sm font-medium">{t('adjustment_counter_party')}</label>
              <input
               type="text"
               value={transactionForm.counterParty}
               onChange={(event) => setTransactionForm((current) => ({ ...current, counterParty: event.target.value }))}
               placeholder={t('adjustment_counter_party_placeholder')}
               className="mt-2 w-full rounded border border-border-strong px-3 py-2 outline-none ring-blue-300 focus:ring"
              />
             </>
            ) : (
             <>
            <label className="mt-4 block text-sm font-medium">{transactionForm.type === 'exchange' ? t('transaction_seller') : t('transaction_account_from')}</label>
            <div className="relative mt-2">
             <input
              type="text"
              value={
               txFromOpen
                ? txFromQuery
                : transactionForm.accountFromId
                  ? (clientAccounts.find((a) => a.id === transactionForm.accountFromId)?.clientName ?? '') +
                    ' · ' +
                    (clientAccounts.find((a) => a.id === transactionForm.accountFromId)?.currencyCode ?? '')
                  : ''
              }
              onChange={(event) => {
               setTxFromQuery(event.target.value);
               setTxFromOpen(true);
               setTxFromHighlight(0);
              }}
              onFocus={() => {
               setTxFromQuery('');
               setTxFromOpen(true);
               setTxFromHighlight(0);
              }}
              onBlur={() => setTimeout(() => setTxFromOpen(false), 150)}
              onKeyDown={(event) =>
               handleAccountPickerKeyDown(
                event,
                txFromOpen,
                txFromOptions,
                txFromHighlight,
                setTxFromHighlight,
                (clientId, expanded) => setTxFromExpandedClient(expanded && !txFromQuery.trim() ? null : clientId),
                selectFromAccount,
                () => setTxFromOpen(false),
               )
              }
              placeholder={t('transaction_account_placeholder')}
              className={`w-full rounded border border-border-strong px-3 py-2 outline-none ring-blue-300 focus:ring ${isRTL ? 'pl-9' : 'pr-9'}`}
              autoComplete="off"
             />
             {transactionForm.accountFromId && !txFromOpen ? (
              <button
               type="button"
               onMouseDown={(event) => {
                event.preventDefault();
                setTransactionForm((current) => ({ ...current, accountFromId: null }));
                setTxFromQuery('');
                setTxFromOpen(false);
               }}
               title={t('clear_selection')}
               aria-label={t('clear_selection')}
               className={`absolute inset-y-0 my-auto flex h-6 w-6 items-center justify-center rounded text-fg-faint hover:bg-surface-hover hover:text-fg-muted ${isRTL ? 'left-2' : 'right-2'}`}
              >
               <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
               >
                <line
                 x1="18"
                 y1="6"
                 x2="6"
                 y2="18"
                />
                <line
                 x1="6"
                 y1="6"
                 x2="18"
                 y2="18"
                />
               </svg>
              </button>
             ) : null}
             {txFromOpen && (
              <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded border border-border bg-surface shadow-lg">
               {txFromOptions.length === 0 ? (
                <li className="px-3 py-2 text-sm text-fg-faint">{t('transaction_account_placeholder')}</li>
               ) : (
                txFromOptions.map((option, index) => {
                 const highlighted = index === txFromHighlight;
                 // Keeps the keyboard-highlighted row scrolled into view as ↑/↓ move past the fold.
                 const highlightRef = highlighted ? (el: HTMLLIElement | null) => el?.scrollIntoView({ block: 'nearest' }) : undefined;
                 if (option.kind === 'single') {
                  const account = option.account;
                  const selected = transactionForm.accountFromId === account.id;
                  return (
                   <li
                    key={`s${account.id}`}
                    ref={highlightRef}
                    onMouseDown={() => selectFromAccount(account.id)}
                    onMouseEnter={() => setTxFromHighlight(index)}
                    className={`cursor-pointer px-3 py-2 text-sm ${highlighted ? 'bg-accent-weak' : selected ? 'bg-accent-weak' : ''} ${selected ? 'font-medium text-accent' : 'text-fg'}`}
                   >
                    {account.clientName} · {account.currencyCode}
                   </li>
                  );
                 }
                 if (option.kind === 'group') {
                  const groupHasSelected = clientAccounts.some((a) => a.clientId === option.clientId && a.id === transactionForm.accountFromId);
                  return (
                   <li
                    key={`g${option.clientId}`}
                    ref={highlightRef}
                    onMouseDown={(e) => {
                     e.preventDefault();
                     setTxFromExpandedClient(option.expanded && !txFromQuery.trim() ? null : option.clientId);
                    }}
                    onMouseEnter={() => setTxFromHighlight(index)}
                    className={`flex cursor-pointer items-center justify-between px-3 py-2 text-sm ${highlighted ? 'bg-accent-weak' : ''} ${groupHasSelected ? 'font-medium text-accent' : 'text-fg'}`}
                   >
                    <span>
                     {option.clientName} <span className="text-fg-faint">({option.count})</span>
                    </span>
                    <svg
                     width="12"
                     height="12"
                     viewBox="0 0 24 24"
                     fill="none"
                     stroke="currentColor"
                     strokeWidth="2"
                     strokeLinecap="round"
                     strokeLinejoin="round"
                     className={`text-fg-faint transition-transform ${option.expanded ? 'rotate-180' : ''}`}
                     aria-hidden
                    >
                     <path d="m6 9 6 6 6-6" />
                    </svg>
                   </li>
                  );
                 }
                 const account = option.account;
                 const selected = transactionForm.accountFromId === account.id;
                 return (
                  <li
                   key={`c${account.id}`}
                   ref={highlightRef}
                   onMouseDown={() => selectFromAccount(account.id)}
                   onMouseEnter={() => setTxFromHighlight(index)}
                   className={`cursor-pointer py-2 pl-8 pr-3 text-sm ${highlighted ? 'bg-accent-weak' : selected ? 'bg-accent-weak' : ''} ${selected ? 'font-medium text-accent' : 'text-fg-muted'}`}
                  >
                   {account.currencyCode}
                   {account.currencySymbol ? ` (${account.currencySymbol})` : ''}
                  </li>
                 );
                })
               )}
              </ul>
             )}
            </div>

            <div className="mt-2 -mb-2 flex justify-center">
             <button
              type="button"
              onClick={swapFromToParties}
              title={t('swap_parties_action')}
              aria-label={t('swap_parties_action')}
              className="inline-flex items-center justify-center rounded p-0 text-fg-faint transition hover:bg-surface-hover hover:text-accent"
             >
              <svg
               width="12"
               height="12"
               viewBox="0 0 24 24"
               fill="none"
               stroke="currentColor"
               strokeWidth="2.5"
               strokeLinecap="round"
               strokeLinejoin="round"
               aria-hidden
              >
               <path d="M8 3v18" />
               <path d="M4 7l4-4 4 4" />
               <path d="M16 21V3" />
               <path d="M12 17l4 4 4-4" />
              </svg>
             </button>
            </div>

            <>
              <label className="block text-sm font-medium">{transactionForm.type === 'exchange' ? t('transaction_buyer') : t('transaction_account_to')}</label>
              <div className="relative mt-2">
               <input
                type="text"
                value={
                 txToOpen
                  ? txToQuery
                  : transactionForm.accountToId
                    ? (clientAccounts.find((a) => a.id === transactionForm.accountToId)?.clientName ?? '') +
                      ' · ' +
                      (clientAccounts.find((a) => a.id === transactionForm.accountToId)?.currencyCode ?? '')
                    : ''
                }
                onChange={(event) => {
                 setTxToQuery(event.target.value);
                 setTxToOpen(true);
                 setTxToHighlight(0);
                }}
                onFocus={() => {
                 setTxToQuery('');
                 setTxToOpen(true);
                 setTxToHighlight(0);
                }}
                onBlur={() => setTimeout(() => setTxToOpen(false), 150)}
                onKeyDown={(event) =>
                 handleAccountPickerKeyDown(
                  event,
                  txToOpen,
                  txToOptions,
                  txToHighlight,
                  setTxToHighlight,
                  (clientId, expanded) => setTxToExpandedClient(expanded && !txToQuery.trim() ? null : clientId),
                  selectToAccount,
                  () => setTxToOpen(false),
                 )
                }
                placeholder={t('transaction_account_placeholder')}
                className={`w-full rounded border border-border-strong px-3 py-2 outline-none ring-blue-300 focus:ring ${isRTL ? 'pl-9' : 'pr-9'}`}
                autoComplete="off"
               />
               {transactionForm.accountToId && !txToOpen ? (
                <button
                 type="button"
                 onMouseDown={(event) => {
                  event.preventDefault();
                  setTransactionForm((current) => ({ ...current, accountToId: null }));
                  setTxToQuery('');
                  setTxToOpen(false);
                 }}
                 title={t('clear_selection')}
                 aria-label={t('clear_selection')}
                 className={`absolute inset-y-0 my-auto flex h-6 w-6 items-center justify-center rounded text-fg-faint hover:bg-surface-hover hover:text-fg-muted ${isRTL ? 'left-2' : 'right-2'}`}
                >
                 <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                 >
                  <line
                   x1="18"
                   y1="6"
                   x2="6"
                   y2="18"
                  />
                  <line
                   x1="6"
                   y1="6"
                   x2="18"
                   y2="18"
                  />
                 </svg>
                </button>
               ) : null}
               {txToOpen && (
                <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded border border-border bg-surface shadow-lg">
                 {txToOptions.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-fg-faint">{t('transaction_account_placeholder')}</li>
                 ) : (
                  txToOptions.map((option, index) => {
                   const highlighted = index === txToHighlight;
                   const highlightRef = highlighted ? (el: HTMLLIElement | null) => el?.scrollIntoView({ block: 'nearest' }) : undefined;
                   if (option.kind === 'single') {
                    const account = option.account;
                    const selected = transactionForm.accountToId === account.id;
                    return (
                     <li
                      key={`s${account.id}`}
                      ref={highlightRef}
                      onMouseDown={() => selectToAccount(account.id)}
                      onMouseEnter={() => setTxToHighlight(index)}
                      className={`cursor-pointer px-3 py-2 text-sm ${highlighted ? 'bg-accent-weak' : selected ? 'bg-accent-weak' : ''} ${selected ? 'font-medium text-accent' : 'text-fg'}`}
                     >
                      {account.clientName} · {account.currencyCode}
                     </li>
                    );
                   }
                   if (option.kind === 'group') {
                    const groupHasSelected = clientAccounts.some((a) => a.clientId === option.clientId && a.id === transactionForm.accountToId);
                    return (
                     <li
                      key={`g${option.clientId}`}
                      ref={highlightRef}
                      onMouseDown={(e) => {
                       e.preventDefault();
                       setTxToExpandedClient(option.expanded && !txToQuery.trim() ? null : option.clientId);
                      }}
                      onMouseEnter={() => setTxToHighlight(index)}
                      className={`flex cursor-pointer items-center justify-between px-3 py-2 text-sm ${highlighted ? 'bg-accent-weak' : ''} ${groupHasSelected ? 'font-medium text-accent' : 'text-fg'}`}
                     >
                      <span>{option.clientName}</span>
                      <span className="flex items-center gap-1 text-xs text-fg-faint">
                       {option.count}
                       <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={`transition-transform ${option.expanded ? 'rotate-180' : ''}`}
                        aria-hidden
                       >
                        <path d="m6 9 6 6 6-6" />
                       </svg>
                      </span>
                     </li>
                    );
                   }
                   const account = option.account;
                   const selected = transactionForm.accountToId === account.id;
                   return (
                    <li
                     key={`c${account.id}`}
                     ref={highlightRef}
                     onMouseDown={() => selectToAccount(account.id)}
                     onMouseEnter={() => setTxToHighlight(index)}
                     className={`cursor-pointer py-2 pl-8 pr-3 text-sm ${highlighted ? 'bg-accent-weak' : selected ? 'bg-accent-weak' : ''} ${selected ? 'font-medium text-accent' : 'text-fg-muted'}`}
                    >
                     {account.currencyCode}
                     {account.currencySymbol ? ` (${account.currencySymbol})` : ''}
                    </li>
                   );
                  })
                 )}
                </ul>
               )}
              </div>
             </>
             </>
            )}

            {transactionForm.type !== 'adjustment' || transactionForm.accountFromId ? (
            <div className="mt-4 rounded border border-border bg-surface-2 p-4">
             <h3 className="text-sm font-semibold text-fg-muted">
              {transactionForm.type === 'exchange' ? t('transaction_seller') : t('transaction_account_from')}
              {transactionForm.accountFromId && clientAccountMap.get(transactionForm.accountFromId)?.clientName ? (
               <span className="ml-1.5 font-normal text-fg-faint">
                — {clientAccountMap.get(transactionForm.accountFromId)!.clientName}
                {clientAccountMap.get(transactionForm.accountFromId)!.currencyCode ? ` · ${clientAccountMap.get(transactionForm.accountFromId)!.currencyCode}` : ''}
               </span>
              ) : null}
             </h3>
             <div className={`mt-2 grid gap-2 ${showExchangeRateFrom ? 'sm:grid-cols-2' : ''}`}>
              {showExchangeRateFrom && (
               <div>
                <div className="flex items-center justify-between">
                 <label className="block text-xs font-medium text-fg-faint">
                  {transactionSelectedCurrencyCode && transactionAccountFromCurrencyCode
                   ? txFromRateReversed
                     ? ltrIsolate(`1 ${transactionAccountFromCurrencyCode} = ? ${transactionSelectedCurrencyCode}`)
                     : ltrIsolate(`1 ${transactionSelectedCurrencyCode} = ? ${transactionAccountFromCurrencyCode}`)
                   : t('transaction_exchange_rate_from')}
                 </label>
                 {transactionSelectedCurrencyCode && transactionAccountFromCurrencyCode && transactionSelectedCurrencyCode !== transactionAccountFromCurrencyCode && (
                  <button
                   type="button"
                   title="Reverse rate direction"
                   onClick={() => {
                    const val = parseFloat(transactionForm.exchangeRateFrom) || 1;
                    setTransactionForm((c) => ({ ...c, exchangeRateFrom: (1 / val).toFixed(6).replace(/\.?0+$/, '') }));
                    setTxFromRateReversed((r) => !r);
                   }}
                   className="ml-1 inline-flex items-center gap-0.5 rounded p-0.5 text-fg-faint hover:text-fg-muted"
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
                   <span className="text-xs font-semibold" aria-hidden>
                    {txFromRateReversed ? '÷' : '×'}
                   </span>
                  </button>
                 )}
                </div>
                <input
                 type="text"
                 inputMode="decimal"
                 dir="ltr"
                 value={transactionForm.exchangeRateFrom}
                 onChange={(event) => setTransactionForm((current) => ({ ...current, exchangeRateFrom: normalizePlainDecimalInput(event.target.value) }))}
                 className="mt-1 w-full rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                 placeholder="1"
                />
               </div>
              )}
              <div>
               <label className="block text-xs font-medium text-fg-faint">{t('transaction_commission_from')} (%)</label>
               <input
                type="text"
                inputMode="decimal"
                dir="ltr"
                value={transactionForm.commissionFrom}
                onChange={(event) => setTransactionForm((current) => ({ ...current, commissionFrom: normalizePlainDecimalInput(event.target.value) }))}
                className="mt-1 w-full rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                placeholder="0"
               />
              </div>
             </div>
            </div>
            ) : null}

            {transactionForm.type !== 'adjustment' || transactionForm.accountToId ? (
            <div className="mt-3 rounded border border-border bg-surface-2 p-4">
              <h3 className="text-sm font-semibold text-fg-muted">
               {transactionForm.type === 'exchange' ? t('transaction_buyer') : t('transaction_account_to')}
               {transactionForm.accountToId && clientAccountMap.get(transactionForm.accountToId)?.clientName ? (
                <span className="ml-1.5 font-normal text-fg-faint">
                 — {clientAccountMap.get(transactionForm.accountToId)!.clientName}
                 {clientAccountMap.get(transactionForm.accountToId)!.currencyCode ? ` · ${clientAccountMap.get(transactionForm.accountToId)!.currencyCode}` : ''}
                </span>
               ) : null}
              </h3>
              <div className={`mt-2 grid gap-2 ${showExchangeRateTo ? 'sm:grid-cols-2' : ''}`}>
               {showExchangeRateTo && (
                <div>
                 <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-fg-faint">
                   {transactionSelectedCurrencyCode && transactionAccountToCurrencyCode
                    ? txToRateReversed
                      ? ltrIsolate(`1 ${transactionAccountToCurrencyCode} = ? ${transactionSelectedCurrencyCode}`)
                      : ltrIsolate(`1 ${transactionSelectedCurrencyCode} = ? ${transactionAccountToCurrencyCode}`)
                    : t('transaction_exchange_rate_to')}
                  </label>
                  {transactionSelectedCurrencyCode && transactionAccountToCurrencyCode && transactionSelectedCurrencyCode !== transactionAccountToCurrencyCode && (
                   <button
                    type="button"
                    title="Reverse rate direction"
                    onClick={() => {
                     const val = parseFloat(transactionForm.exchangeRateTo) || 1;
                     setTransactionForm((c) => ({ ...c, exchangeRateTo: (1 / val).toFixed(6).replace(/\.?0+$/, '') }));
                     setTxToRateReversed((r) => !r);
                    }}
                    className="ml-1 inline-flex items-center gap-0.5 rounded p-0.5 text-fg-faint hover:text-fg-muted"
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
                    <span className="text-xs font-semibold" aria-hidden>
                     {txToRateReversed ? '÷' : '×'}
                    </span>
                   </button>
                  )}
                 </div>
                 <input
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  value={transactionForm.exchangeRateTo}
                  onChange={(event) => setTransactionForm((current) => ({ ...current, exchangeRateTo: normalizePlainDecimalInput(event.target.value) }))}
                  className="mt-1 w-full rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                  placeholder="1"
                 />
                </div>
               )}
               <div>
                <label className="block text-xs font-medium text-fg-faint">{t('transaction_commission_to')} (%)</label>
                <input
                 type="text"
                 inputMode="decimal"
                 dir="ltr"
                 value={transactionForm.commissionTo}
                 onChange={(event) => setTransactionForm((current) => ({ ...current, commissionTo: normalizePlainDecimalInput(event.target.value) }))}
                 className="mt-1 w-full rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                 placeholder="0"
                />
               </div>
              </div>
             </div>
            ) : null}

            {isExchangeTransaction
             ? (() => {
                const amountNum = parseFloat(normalizeDecimalInput(transactionForm.amount));
                const rateRaw = parseFloat(transactionForm.exchangeRateTo);
                const effRateTo =
                 showExchangeRateTo && transactionAccountToCurrencyCode
                  ? Number.isFinite(rateRaw) && rateRaw > 0
                    ? txToRateReversed
                      ? 1 / rateRaw
                      : rateRaw
                    : null
                  : 1;
                const computed = Number.isFinite(amountNum) && effRateTo != null ? amountNum * effRateTo : null;
                const actualRaw = transactionForm.exchangeActualAmount.trim();
                const actualNum = parseFloat(normalizeDecimalInput(actualRaw));
                const hasActual = actualRaw !== '' && Number.isFinite(actualNum);
                const diff = computed != null && hasActual ? computed - actualNum : null;
                const outOfTolerance = diff != null && Math.abs(diff) > exchangeTolerance;
                const toCode = transactionAccountToCurrencyCode ?? '';
                return (
                 <div className="mt-4 rounded border border-border bg-surface-2 p-4">
                  <h3 className="text-sm font-semibold text-fg-muted">{t('exchange_actual_label')}</h3>
                  {computed != null ? (
                   <p className="mt-1 text-xs text-fg-faint">
                    {t('exchange_actual_computed_hint', { value: ltrIsolate(`${formatAmountInput(String(computed.toFixed(2)))} ${toCode}`.trim()) })}
                   </p>
                  ) : null}
                  <input
                   type="text"
                   inputMode="decimal"
                   dir="ltr"
                   value={formatAmountInput(transactionForm.exchangeActualAmount)}
                   onChange={(event) => setTransactionForm((current) => ({ ...current, exchangeActualAmount: normalizeDecimalInput(event.target.value) }))}
                   className={`mt-2 w-full rounded border bg-surface px-3 py-2 outline-none ring-blue-300 focus:ring ${outOfTolerance ? 'border-red-400' : 'border-border-strong'}`}
                   placeholder={computed != null ? computed.toFixed(2) : '0.00'}
                  />
                  {diff != null && Math.abs(diff) > 1e-9 ? (
                   <p className={`mt-1 text-xs ${outOfTolerance ? 'text-bad-text' : 'text-fg-faint'}`}>
                    {outOfTolerance
                     ? t('exchange_actual_out_of_tolerance', { max: String(exchangeTolerance) })
                     : t('exchange_actual_difference', { value: ltrIsolate(`${diff > 0 ? '+' : ''}${diff.toFixed(2)} ${toCode}`.trim()) })}
                   </p>
                  ) : null}
                 </div>
                );
               })()
             : null}

            {!isExchangeTransaction ? (
             <div className="mt-4">
              <button
               type="button"
               onClick={() => setIsNewTransactionExpensesOpen((prev) => !prev)}
               className="flex items-center gap-1 text-sm font-medium text-accent hover:underline"
              >
               <span>{isNewTransactionExpensesOpen ? '?' : '?'}</span>
               {t('extra_expenses')}
              </button>
              {isNewTransactionExpensesOpen && (
               <div className="mt-3 rounded border border-border bg-surface-2 p-4">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                 <input
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  value={formatAmountInput(transactionForm.charges)}
                  onChange={(event) => setTransactionForm((current) => ({ ...current, charges: normalizeDecimalInput(event.target.value) }))}
                  className="rounded border border-border-strong bg-surface px-3 py-2 outline-none ring-blue-300 focus:ring"
                  placeholder="0"
                 />
                 <ChargesPayerSelects
                  value={transactionForm.chargesPayer}
                  onChange={(chargesPayer) => setTransactionForm((current) => ({ ...current, chargesPayer }))}
                  fromLabel={
                   transactionForm.accountFromId
                    ? (clientAccountMap.get(transactionForm.accountFromId)?.clientName ?? (transactionForm.type === 'exchange' ? t('transaction_seller') : t('transaction_account_from')))
                    : transactionForm.type === 'exchange'
                      ? t('transaction_seller')
                      : t('transaction_account_from')
                  }
                  toLabel={
                   transactionForm.accountToId
                    ? (clientAccountMap.get(transactionForm.accountToId)?.clientName ?? (transactionForm.type === 'exchange' ? t('transaction_buyer') : t('transaction_account_to')))
                    : transactionForm.type === 'exchange'
                      ? t('transaction_buyer')
                      : t('transaction_account_to')
                  }
                  meLabel={t('charges_payer_me')}
                  paidByPlaceholder={t('charges_payer_placeholder')}
                  paidToPlaceholder={t('charges_payer_to_placeholder')}
                  className="rounded border border-border-strong bg-surface px-2 py-2 text-sm outline-none ring-blue-300 focus:ring"
                 />
                </div>
                <div className="mt-2">
                 <label className="block text-xs font-medium text-fg-faint">{t('charges_description')}</label>
                 <input
                  type="text"
                  value={transactionForm.chargesDescription}
                  onChange={(event) => setTransactionForm((current) => ({ ...current, chargesDescription: event.target.value }))}
                  className="mt-1 w-full rounded border border-border-strong bg-surface px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                  placeholder={t('charges_description_placeholder')}
                 />
                </div>
               </div>
              )}
             </div>
            ) : null}

            <label className="mt-4 block text-sm font-medium">{t('transaction_description')}</label>
            <div className="mt-2">
             <DescriptionSuggestField
              as="textarea"
              value={transactionForm.description}
              onChange={(value) => setTransactionForm((current) => ({ ...current, description: value }))}
              suggestions={descriptionSuggestions}
              onExcludeSuggestion={excludeDescriptionSuggestion}
              removeSuggestionLabel={t('transaction_description_suggestion_remove')}
              className="min-h-20 w-full rounded border border-border-strong px-3 py-2 outline-none ring-blue-300 focus:ring"
              placeholder={t('transaction_description_placeholder')}
             />
            </div>

            <div className="mt-3">
             <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-muted">
              <input
               type="checkbox"
               checked={txSplitDescription}
               onChange={(event) => setTxSplitDescription(event.target.checked)}
               className="h-4 w-4 rounded border-border-strong text-accent focus:ring-blue-300"
              />
              {t('transaction_description_split')}
             </label>

             {txSplitDescription ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
               <div>
                <label className="block text-xs font-medium text-fg-faint">
                 {clientAccountMap.get(transactionForm.accountFromId ?? -1)?.clientName ?? (transactionForm.type === 'exchange' ? t('transaction_seller') : t('transaction_account_from'))}
                </label>
                <textarea
                 value={transactionForm.descriptionFrom}
                 onChange={(event) => setTransactionForm((current) => ({ ...current, descriptionFrom: event.target.value }))}
                 className="mt-1 min-h-16 w-full rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                 placeholder={transactionForm.description || t('transaction_description_placeholder')}
                />
               </div>
               <div>
                <label className="block text-xs font-medium text-fg-faint">
                 {clientAccountMap.get(transactionForm.accountToId ?? -1)?.clientName ?? (transactionForm.type === 'exchange' ? t('transaction_buyer') : t('transaction_account_to'))}
                </label>
                <textarea
                 value={transactionForm.descriptionTo}
                 onChange={(event) => setTransactionForm((current) => ({ ...current, descriptionTo: event.target.value }))}
                 className="mt-1 min-h-16 w-full rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                 placeholder={transactionForm.description || t('transaction_description_placeholder')}
                />
               </div>
              </div>
             ) : null}
            </div>

            {onSaveAndClose && !editingTransaction ? (
             <div className="mt-6 flex gap-2">
              <button
               type="submit"
               value="new"
               disabled={isSubmittingTransaction}
               className="flex-1 rounded border border-border-strong bg-surface px-4 py-2 font-medium text-fg transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
               {t('save_and_add_another')}
              </button>
              <button
               type="submit"
               value="close"
               disabled={isSubmittingTransaction}
               className="flex-1 rounded bg-blue-700 px-4 py-2 font-medium text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
               {t('save_and_close')}
              </button>
             </div>
            ) : (
             <button
              type="submit"
              disabled={isSubmittingTransaction}
              className="mt-6 w-full rounded bg-blue-700 px-4 py-2 font-medium text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
             >
              {editingTransaction ? t('update_transaction') : t('save_transaction')}
             </button>
            )}
           </form>

 );
}
