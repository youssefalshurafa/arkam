'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { formatDateValue } from '@/shared/utils/date';
import { transactionTypeLabelKey } from '@/shared/utils/transactionType';
import { formatRateValue } from '@/shared/utils/format';
import { normalizeDecimalInput, normalizePlainDecimalInput } from '@/shared/utils/decimal';
import { seamlessInputClassName, seamlessSelectClassName } from '@/shared/styles';
import { getCommissionAmount, exchangeToBase, parseChargesPayer, type ChargesPayerParty } from '@/shared/utils/commission';
import { useTransactionsStore } from '@/features/transactions/store/transactionsStore';
import { isArchiveEligible } from '@/features/transactions/utils/transactionRows';
import AccountSearchSelect from '@/features/transactions/components/AccountSearchSelect';
import type { ClientAccount, Currency, Transaction, TransactionUpdateInput } from '@/shared/types';

type TransactionDetailsModalProps = {
 transactions: Transaction[];
 clientAccounts: ClientAccount[];
 // enabledCurrencies for the picker; localizedCurrencies as a fallback so a transaction whose
 // currency was since disabled still shows correctly and stays selected (mirrors the same
 // merge OneSidedTransactionModal's own currency picker uses).
 enabledCurrencies: Currency[];
 localizedCurrencies: Currency[];
 onUpdateTransactionFields: (transactionId: number, patch: Partial<TransactionUpdateInput>) => void | Promise<void>;
};

// A label/value line. A plain render helper (not a component) so it isn't re-created each
// render — see the "components during render" lint rule.
function row(label: string, value: ReactNode, key: string = label) {
 return (
  <div key={key} className="flex items-start justify-between gap-4 py-1.5">
   <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-fg-faint">{label}</span>
   <span className="min-w-0 break-words text-right text-sm font-medium text-fg">{value}</span>
  </div>
 );
}

// A click-to-edit value: plain text until clicked, then an underlined (never boxed) input
// in place, seamless with the surrounding row. Commits on blur/Enter, discards on Escape or
// when the input is left unchanged from `editValue`. A real component (not a plain render
// helper like `row`) because it owns its own edit-mode state.
function EditableField({
 display,
 editValue,
 align = 'right',
 decimal = false,
 placeholder,
 onCommit,
}: {
 display: ReactNode;
 editValue: string;
 align?: 'left' | 'right';
 decimal?: boolean;
 placeholder?: string;
 onCommit: (raw: string) => void;
}) {
 const [editing, setEditing] = useState(false);
 const [draft, setDraft] = useState(editValue);
 const alignCls = align === 'right' ? 'text-right' : 'text-left';

 if (!editing) {
  return (
   <button
    type="button"
    onClick={() => {
     setDraft(editValue);
     setEditing(true);
    }}
    className={`-mx-1 min-w-0 break-words rounded-sm px-1 text-sm font-medium text-fg outline-none transition hover:bg-surface-hover ${alignCls}`}
   >
    {display}
   </button>
  );
 }

 const commit = () => {
  setEditing(false);
  if (draft !== editValue) onCommit(draft);
 };

 return (
  <input
   autoFocus
   type="text"
   inputMode={decimal ? 'decimal' : undefined}
   dir={decimal ? 'ltr' : undefined}
   value={draft}
   placeholder={placeholder}
   onChange={(e) => setDraft(decimal ? normalizePlainDecimalInput(e.target.value) : normalizeDecimalInput(e.target.value))}
   onBlur={commit}
   onKeyDown={(e) => {
    if (e.key === 'Enter') {
     e.preventDefault();
     commit();
    } else if (e.key === 'Escape') {
     setDraft(editValue);
     setEditing(false);
    }
   }}
   className={`${seamlessInputClassName} max-w-full text-sm text-fg ${alignCls}`}
  />
 );
}

// A click-to-edit account/client picker: the client name (plus currency) until clicked, then
// AccountSearchSelect's search dropdown in place. Selecting an account (or clearing it) commits
// immediately and returns to display mode; clicking away without selecting just closes it.
function EditableAccountField({
 accounts,
 value,
 name,
 currencyCode,
 placeholder,
 clearLabel,
 isRTL,
 onCommit,
}: {
 accounts: ClientAccount[];
 value: number | null;
 name: string;
 currencyCode: string;
 placeholder: string;
 clearLabel: string;
 isRTL: boolean;
 onCommit: (id: number | null) => void;
}) {
 const [editing, setEditing] = useState(false);
 const containerRef = useRef<HTMLDivElement>(null);

 if (!editing) {
  return (
   <button
    type="button"
    onClick={() => setEditing(true)}
    className="-mx-1 block w-full truncate rounded-sm px-1 text-left text-sm font-semibold text-fg outline-none transition hover:bg-surface-hover"
    title={name || '—'}
   >
    {name || <span className="text-fg-faint">—</span>}
    {currencyCode ? <span className="ml-1.5 text-xs font-normal text-fg-faint">{currencyCode}</span> : null}
   </button>
  );
 }

 return (
  <div
   ref={containerRef}
   onBlur={(event) => {
    if (containerRef.current?.contains(event.relatedTarget as Node)) return;
    setTimeout(() => {
     if (!containerRef.current?.contains(document.activeElement)) setEditing(false);
    }, 200);
   }}
  >
   <AccountSearchSelect
    accounts={accounts}
    value={value}
    onChange={(id) => {
     onCommit(id);
     setEditing(false);
    }}
    placeholder={placeholder}
    clearLabel={clearLabel}
    isRTL={isRTL}
   />
  </div>
 );
}

/**
 * "More info" popup for a single transaction, opened from the ledger/transactions/harvest
 * row context menus (via `infoTransactionId` in the transactions store). Unlike a client
 * ledger — which only shows the current account's side — this shows BOTH sides in full
 * (each party's exchange rate, commission %, and computed commission amount), so e.g. the
 * counterparty's commission is visible even while viewing the other client's ledger.
 * Mounted once at page level, where the full transaction list is in scope.
 *
 * Every value except who pays charges is editable in place via `EditableField`/
 * `EditableAccountField`/the type and currency `<select>`s — click a value, edit, blur/Enter
 * to stage the change (Escape or leaving it unchanged discards). Edits are buffered locally
 * and only written when Save is pressed; Cancel/closing discards them. Which client/account
 * each side belongs to (via `EditableAccountField`) and the transaction's own currency (via the
 * currency `<select>`) both mirror the same cross-currency exchange-rate reset the inline table
 * edit and the new-transaction form use (see `resetSideRate`/the effect in page.tsx): a side
 * that lands on the same currency as the transaction is forced to 1.00; a side that turns
 * cross-currency while still holding the untouched default rate is cleared so the row stays
 * pending until a real rate is entered — otherwise it would silently save as a 1:1 conversion
 * across a currency mismatch. Who pays charges is deliberately left read-only here — changing
 * that needs the full edit form's payer picker, not a seamless one-line edit.
 */
export default function TransactionDetailsModal({ transactions, clientAccounts, enabledCurrencies, localizedCurrencies, onUpdateTransactionFields }: TransactionDetailsModalProps) {
 const { language, isRTL } = useLanguage();
 const { t } = useTranslation(language);
 const numLocale = language === 'fr' ? 'en-US' : language;
 const infoTransactionId = useTransactionsStore((s) => s.infoTransactionId);
 const setInfoTransactionId = useTransactionsStore((s) => s.setInfoTransactionId);
 const dateFormat = useTransactionsStore((s) => s.transactionTableSettings.dateFormat);

 // Edits are buffered here and only persisted on Save (discarded on Cancel/close), so the
 // modal is an explicit editing session rather than the auto-save-on-blur behavior. Reset
 // whenever the target transaction changes (the modal is mounted once at page level and
 // reused for whichever row is opened, so stale edits must not leak across opens).
 const [pending, setPending] = useState<Partial<TransactionUpdateInput>>({});
 useEffect(() => setPending({}), [infoTransactionId]);

 if (infoTransactionId == null) return null;
 const found = transactions.find((candidate) => candidate.id === infoTransactionId);
 if (!found) return null;

 // The transaction as it would look with the buffered edits applied — every display/computed
 // value below reads from this merged view so in-progress edits are reflected live. When a
 // side's account was reassigned, the client name/currency displayed must follow the newly
 // picked account rather than the original row's (those are plain display fields, not part
 // of `pending`, so they don't update on their own).
 const accountFromOverride = 'accountFromId' in pending ? (clientAccounts.find((a) => a.id === pending.accountFromId) ?? null) : undefined;
 const accountToOverride = 'accountToId' in pending ? (clientAccounts.find((a) => a.id === pending.accountToId) ?? null) : undefined;
 const currencyOverride = 'currencyId' in pending ? (localizedCurrencies.find((c) => c.id === pending.currencyId) ?? null) : undefined;
 const tx = {
  ...found,
  ...pending,
  ...(accountFromOverride !== undefined
   ? { clientFromName: accountFromOverride?.clientName ?? '', accountFromCurrencyCode: accountFromOverride?.currencyCode ?? '', accountFromCurrencySymbol: accountFromOverride?.currencySymbol ?? '' }
   : null),
  ...(accountToOverride !== undefined
   ? { clientToName: accountToOverride?.clientName ?? '', accountToCurrencyCode: accountToOverride?.currencyCode ?? '', accountToCurrencySymbol: accountToOverride?.currencySymbol ?? '' }
   : null),
  ...(currencyOverride !== undefined ? { currencyCode: currencyOverride?.code ?? '', currencySymbol: currencyOverride?.symbol ?? '' } : null),
 };
 // The currency picker must always include the transaction's current currency even if it's
 // since been disabled (mirrors OneSidedTransactionModal's own currency select).
 const currencyOptions =
  tx.currencyId && !enabledCurrencies.some((c) => c.id === tx.currencyId)
   ? [...enabledCurrencies, ...localizedCurrencies.filter((c) => c.id === tx.currencyId)]
   : enabledCurrencies;
 const isDirty = Object.keys(pending).length > 0;

 const close = () => setInfoTransactionId(null);
 const update = (patch: Partial<TransactionUpdateInput>) => setPending((prev) => ({ ...prev, ...patch }));
 const save = () => {
  if (isDirty) void onUpdateTransactionFields(found.id, pending);
  close();
 };
 // A details view: show up to 4 fraction digits so exact stored amounts aren't rounded away
 // (the ledger/table use their own coarser display decimals; this is the full-precision view).
 const fmt = (value: number) => value.toLocaleString(numLocale, { maximumFractionDigits: 4 });
 const isExchange = tx.type === 'exchange';

 // Each side's commission is charged on that side's own base amount (mirrors the ledger's
 // per-side net-change formulas): the sender pays on amount × rateFrom; the receiver on the
 // settled destination amount (the الفعلي actual amount when set, else amount × rateTo).
 const fromCommissionAmount = getCommissionAmount(tx.amount * tx.exchangeRateFrom, tx.commissionFrom);
 const toCommissionAmount = getCommissionAmount(exchangeToBase(tx), tx.commissionTo);

 const rateDisplay = (rate: number, reversed: boolean) => (rate === 0 ? '—' : formatRateValue(reversed ? 1 / rate : rate));

 // Mirrors resetSideRate in useTransactionActions.ts / the new-transaction form's effect in
 // page.tsx: when a side's account changes, force same-currency sides to 1 and clear a
 // cross-currency side that's still holding the untouched default 1 (never reversed), so it
 // stays pending (excluded from the balance) instead of silently saving as a 1:1 conversion.
 const resetRateForAccountChange = (accountId: number | null, currentRate: number, reversed: boolean) => {
  const account = accountId != null ? clientAccounts.find((a) => a.id === accountId) : undefined;
  if (!account) return currentRate;
  if (account.currencyId === tx.currencyId) return 1;
  return currentRate === 1 && !reversed ? 0 : currentRate;
 };

 // Same reset, the other way round: when the TRANSACTION's own currency changes (rather than
 // an account), both sides' rates need the same re-evaluation against the new currency, since
 // exchangeRateFrom/To both convert FROM it.
 const resetRateForCurrencyChange = (accountId: number | null, currentRate: number, reversed: boolean, newCurrencyId: number | null) => {
  const account = accountId != null ? clientAccounts.find((a) => a.id === accountId) : undefined;
  if (!account || newCurrencyId == null) return currentRate;
  if (account.currencyId === newCurrencyId) return 1;
  return currentRate === 1 && !reversed ? 0 : currentRate;
 };

 // The stored chargesPayer encodes a payer→payee pair (each end is the sender, the receiver,
 // or "me"/the org). Resolve each end to a display name so the popup states who paid whom —
 // information a single client's ledger can't convey.
 const partyName = (party: ChargesPayerParty) =>
  party === 'from' ? tx.clientFromName : party === 'to' ? tx.clientToName : party === 'me' ? t('charges_payer_me') : '';
 const chargesParties = parseChargesPayer(tx.chargesPayer);
 const chargesPayerName = partyName(chargesParties.payer);
 const chargesPayeeName = partyName(chargesParties.payee);

 const sideCard = (opts: {
  title: string;
  name: string;
  currencyCode: string;
  accountId: number | null;
  onCommitAccount: ((id: number | null) => void) | null;
  rate: number;
  reversed: boolean;
  onToggleReversed: () => void;
  commissionPct: number;
  commissionAmount: number;
  onCommitRate: (raw: string) => void;
  onCommitCommission: (raw: string) => void;
  description: string;
  onCommitDescription: (raw: string) => void;
  extraRows: ReactNode[];
 }) => (
  <div className="flex-1 rounded border border-border bg-surface-2 p-3">
   <p className="text-xs font-semibold uppercase tracking-wide text-accent">{opts.title}</p>
   <div className="mt-1">
    {opts.onCommitAccount ? (
     <EditableAccountField
      accounts={clientAccounts}
      value={opts.accountId}
      name={opts.name}
      currencyCode={opts.currencyCode}
      placeholder={t('transaction_account_placeholder')}
      clearLabel={t('clear_selection')}
      isRTL={isRTL}
      onCommit={opts.onCommitAccount}
     />
    ) : (
     <p className="truncate text-sm font-semibold text-fg" title={opts.name || '—'}>
      {opts.name || <span className="text-fg-faint">—</span>}
      {opts.currencyCode ? <span className="ml-1.5 text-xs font-normal text-fg-faint">{opts.currencyCode}</span> : null}
     </p>
    )}
   </div>
   <div className="mt-2 divide-y divide-border border-t border-border">
    <div className="flex items-start justify-between gap-4 py-1.5">
     <span className="flex shrink-0 items-center gap-1 text-xs font-medium uppercase tracking-wide text-fg-faint">
      {t('exchange_rate')}
      <button
       type="button"
       title={t('reverse_rate')}
       onClick={opts.onToggleReversed}
       className="inline-flex items-center rounded p-0.5 text-fg-faint transition hover:bg-surface-hover hover:text-fg"
      >
       <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M7 4 3 8l4 4M3 8h13.5" />
        <path d="M17 20l4-4-4-4m4 4H7.5" />
       </svg>
      </button>
     </span>
     <span className="min-w-0 break-words text-right text-sm font-medium text-fg">
      <EditableField
       editValue={opts.rate === 0 ? '' : String(opts.reversed ? 1 / opts.rate : opts.rate)}
       display={rateDisplay(opts.rate, opts.reversed)}
       decimal
       onCommit={opts.onCommitRate}
      />
     </span>
    </div>
    {row(
     t('commission'),
     <EditableField editValue={String(opts.commissionPct)} display={`${opts.commissionPct.toLocaleString(numLocale, { maximumFractionDigits: 2 })}%`} decimal onCommit={opts.onCommitCommission} />,
     'commission',
    )}
    {row(
     t('transaction_description'),
     <EditableField
      editValue={opts.description}
      display={opts.description || <span className="text-fg-faint">—</span>}
      placeholder={t('transaction_description_placeholder')}
      onCommit={opts.onCommitDescription}
     />,
     'desc',
    )}
    {opts.extraRows}
   </div>
  </div>
 );

 return (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={close} dir={isRTL ? 'rtl' : 'ltr'}>
   <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded bg-surface p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
    <div className="flex items-start justify-between gap-3">
     <div>
      <h3 className="text-lg font-semibold text-fg">{t('transaction_details_title')}</h3>
      <p className="mt-0.5 text-sm text-fg-faint">
       {formatDateValue(tx.createdAt, dateFormat)} &middot; {t(transactionTypeLabelKey(tx.type))}
      </p>
     </div>
     <button
      type="button"
      onClick={close}
      title={t('close')}
      aria-label={t('close')}
      className="shrink-0 rounded p-1 text-fg-faint transition hover:bg-surface-hover hover:text-fg"
     >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
       <line x1="18" y1="6" x2="6" y2="18" />
       <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
     </button>
    </div>

    <div className="mt-4 divide-y divide-border rounded border border-border bg-surface-2 px-3">
     {row(
      t('transaction_type'),
      <select
       value={tx.type}
       onChange={(e) => update({ type: e.target.value })}
       className={`${seamlessSelectClassName} text-sm text-fg text-right`}
      >
       <option value="buy">{t('transaction_type_buy')}</option>
       <option value="sell">{t('transaction_type_sell')}</option>
       <option value="exchange">{t('transaction_type_exchange')}</option>
       <option value="transfer">{t('transaction_type_transfer')}</option>
       <option value="adjustment">{t('transaction_type_adjustment')}</option>
      </select>,
     )}
     {row(
      t('transaction_amount'),
      <>
       <EditableField
        editValue={String(tx.amount)}
        display={fmt(tx.amount)}
        decimal
        onCommit={(raw) => {
         const parsed = parseFloat(raw);
         if (Number.isFinite(parsed) && parsed >= 0) update({ amount: parsed });
        }}
       />{' '}
       <select
        value={tx.currencyId}
        onChange={(e) => {
         const newCurrencyId = Number(e.target.value);
         update({
          currencyId: newCurrencyId,
          exchangeRateFrom: resetRateForCurrencyChange(tx.accountFromId, tx.exchangeRateFrom, !!tx.exchangeRateFromReversed, newCurrencyId),
          exchangeRateTo: resetRateForCurrencyChange(tx.accountToId, tx.exchangeRateTo, !!tx.exchangeRateToReversed, newCurrencyId),
         });
        }}
        className={`${seamlessSelectClassName} inline w-auto text-sm text-fg-faint`}
       >
        {currencyOptions.map((currency) => (
         <option key={currency.id} value={currency.id}>
          {currency.code}
         </option>
        ))}
       </select>
      </>,
     )}
     {row(
      t('transaction_description'),
      <EditableField
       editValue={tx.description}
       display={tx.description || <span className="text-fg-faint">—</span>}
       placeholder={t('transaction_description_placeholder')}
       onCommit={(raw) => update({ description: raw })}
      />,
     )}
    </div>

    <div className="mt-3 flex flex-col gap-3 sm:flex-row">
     {sideCard({
      title: t('transaction_account_from'),
      name: tx.clientFromName,
      currencyCode: tx.accountFromCurrencyCode,
      accountId: tx.accountFromId,
      onCommitAccount: (id) =>
       update({
        accountFromId: id,
        exchangeRateFrom: resetRateForAccountChange(id, tx.exchangeRateFrom, !!tx.exchangeRateFromReversed),
       }),
      rate: tx.exchangeRateFrom,
      reversed: !!tx.exchangeRateFromReversed,
      onToggleReversed: () => update({ exchangeRateFromReversed: tx.exchangeRateFromReversed ? 0 : 1 }),
      commissionPct: tx.commissionFrom,
      commissionAmount: fromCommissionAmount,
      onCommitRate: (raw) => {
       if (raw.trim() === '') {
        update({ exchangeRateFrom: 0 });
        return;
       }
       const parsed = parseFloat(raw);
       if (!Number.isFinite(parsed) || parsed <= 0) return;
       update({ exchangeRateFrom: tx.exchangeRateFromReversed ? 1 / parsed : parsed });
      },
      onCommitCommission: (raw) => {
       const parsed = parseFloat(raw);
       update({ commissionFrom: Number.isFinite(parsed) ? parsed : 0 });
      },
      description: tx.descriptionFrom,
      onCommitDescription: (raw) => update({ descriptionFrom: raw }),
      extraRows: [],
     })}
     {sideCard({
      title: t('transaction_account_to'),
      name: tx.clientToName,
      currencyCode: tx.accountToCurrencyCode,
      accountId: tx.accountToId,
      onCommitAccount: (id) =>
       update({
        accountToId: id,
        exchangeRateTo: resetRateForAccountChange(id, tx.exchangeRateTo, !!tx.exchangeRateToReversed),
       }),
      rate: tx.exchangeRateTo,
      reversed: !!tx.exchangeRateToReversed,
      onToggleReversed: () => update({ exchangeRateToReversed: tx.exchangeRateToReversed ? 0 : 1 }),
      commissionPct: tx.commissionTo,
      commissionAmount: toCommissionAmount,
      onCommitRate: (raw) => {
       if (raw.trim() === '') {
        update({ exchangeRateTo: 0 });
        return;
       }
       const parsed = parseFloat(raw);
       if (!Number.isFinite(parsed) || parsed <= 0) return;
       update({ exchangeRateTo: tx.exchangeRateToReversed ? 1 / parsed : parsed });
      },
      onCommitCommission: (raw) => {
       const parsed = parseFloat(raw);
       update({ commissionTo: Number.isFinite(parsed) ? parsed : 0 });
      },
      description: tx.descriptionTo,
      onCommitDescription: (raw) => update({ descriptionTo: raw }),
      extraRows: [isExchange && tx.exchangeActualAmount != null ? row(t('exchange_actual_label'), fmt(tx.exchangeActualAmount)) : null],
     })}
    </div>

    {tx.charges > 0 ? (
     <div className="mt-3 divide-y divide-border rounded border border-border bg-surface-2 px-3">
      {row(
       t('charges'),
       <>
        <EditableField
         editValue={String(tx.charges)}
         display={fmt(tx.charges)}
         decimal
         onCommit={(raw) => {
          const parsed = parseFloat(raw);
          if (Number.isFinite(parsed) && parsed >= 0) update({ charges: parsed });
         }}
        />{' '}
        <span className="text-fg-faint">{tx.chargesCurrencySymbol || tx.chargesCurrencyCode || ''}</span>
       </>,
      )}
      {chargesPayerName || chargesPayeeName
       ? row(
          t('charges_payer_placeholder'),
          <>
           {chargesPayerName || <span className="text-fg-faint">—</span>}
           <span className="mx-1.5 text-fg-faint">{t('charges_payer_to_placeholder')}</span>
           {chargesPayeeName || <span className="text-fg-faint">—</span>}
          </>,
          'charges-payer',
         )
       : null}
      {row(
       t('charges_description'),
       <EditableField
        editValue={tx.chargesDescription}
        display={tx.chargesDescription || <span className="text-fg-faint">—</span>}
        placeholder={t('charges_description_placeholder')}
        onCommit={(raw) => update({ chargesDescription: raw })}
       />,
       'charges-desc',
      )}
     </div>
    ) : null}

    {isArchiveEligible(tx) ? (
     <div className="mt-3 divide-y divide-border rounded border border-border bg-surface-2 px-3">
      {row(
       t('archive_more_info'),
       <EditableField
        editValue={tx.archiveNote}
        display={tx.archiveNote || <span className="text-fg-faint">—</span>}
        placeholder={t('archive_more_info_placeholder')}
        onCommit={(raw) => update({ archiveNote: raw })}
       />,
      )}
     </div>
    ) : null}

    <div className="mt-5 flex justify-end gap-2">
     <button
      type="button"
      onClick={close}
      className="rounded border border-border-strong px-4 py-2 text-sm font-semibold text-fg-muted transition hover:bg-surface-hover"
     >
      {t('cancel')}
     </button>
     <button
      type="button"
      onClick={save}
      className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800"
     >
      {t('save')}
     </button>
    </div>
   </div>
  </div>
 );
}
