'use client';

import { useState } from 'react';
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
import type { Transaction, TransactionUpdateInput } from '@/shared/types';

type TransactionDetailsModalProps = {
 transactions: Transaction[];
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

/**
 * "More info" popup for a single transaction, opened from the ledger/transactions/harvest
 * row context menus (via `infoTransactionId` in the transactions store). Unlike a client
 * ledger — which only shows the current account's side — this shows BOTH sides in full
 * (each party's exchange rate, commission %, and computed commission amount), so e.g. the
 * counterparty's commission is visible even while viewing the other client's ledger.
 * Mounted once at page level, where the full transaction list is in scope.
 *
 * Every value except the account/currency identities and the charges payer is editable
 * in place via `EditableField`/the type `<select>` — click a value, edit, blur/Enter to
 * save (Escape or leaving it unchanged discards). Structural fields (which accounts,
 * which currencies, who pays charges) are deliberately left read-only here — changing
 * those needs the full edit form's account/currency pickers and lock/validation checks,
 * not a seamless one-line edit.
 */
export default function TransactionDetailsModal({ transactions, onUpdateTransactionFields }: TransactionDetailsModalProps) {
 const { language, isRTL } = useLanguage();
 const { t } = useTranslation(language);
 const numLocale = language === 'fr' ? 'en-US' : language;
 const infoTransactionId = useTransactionsStore((s) => s.infoTransactionId);
 const setInfoTransactionId = useTransactionsStore((s) => s.setInfoTransactionId);
 const dateFormat = useTransactionsStore((s) => s.transactionTableSettings.dateFormat);

 if (infoTransactionId == null) return null;
 const tx = transactions.find((candidate) => candidate.id === infoTransactionId);
 if (!tx) return null;

 const close = () => setInfoTransactionId(null);
 const update = (patch: Partial<TransactionUpdateInput>) => onUpdateTransactionFields(tx.id, patch);
 // A details view: show up to 4 fraction digits so exact stored amounts aren't rounded away
 // (the ledger/table use their own coarser display decimals; this is the full-precision view).
 const fmt = (value: number) => value.toLocaleString(numLocale, { maximumFractionDigits: 4 });
 const isExchange = tx.type === 'exchange';
 const isAdjustment = tx.type === 'adjustment';

 // Each side's commission is charged on that side's own base amount (mirrors the ledger's
 // per-side net-change formulas): the sender pays on amount × rateFrom; the receiver on the
 // settled destination amount (the الفعلي actual amount when set, else amount × rateTo).
 const fromCommissionAmount = getCommissionAmount(tx.amount * tx.exchangeRateFrom, tx.commissionFrom);
 const toCommissionAmount = getCommissionAmount(exchangeToBase(tx), tx.commissionTo);

 const rateDisplay = (rate: number, reversed: boolean) => (rate === 0 ? '—' : formatRateValue(reversed ? 1 / rate : rate));

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
  rate: number;
  reversed: boolean;
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
   <p className="mt-1 truncate text-sm font-semibold text-fg" title={opts.name || '—'}>
    {opts.name || <span className="text-fg-faint">—</span>}
    {opts.currencyCode ? <span className="ml-1.5 text-xs font-normal text-fg-faint">{opts.currencyCode}</span> : null}
   </p>
   <div className="mt-2 divide-y divide-border border-t border-border">
    {row(
     t('exchange_rate'),
     <EditableField
      editValue={opts.rate === 0 ? '' : String(opts.reversed ? 1 / opts.rate : opts.rate)}
      display={rateDisplay(opts.rate, opts.reversed)}
      decimal
      onCommit={opts.onCommitRate}
     />,
     'rate',
    )}
    {row(
     t('commission'),
     <>
      <EditableField editValue={String(opts.commissionPct)} display={`${opts.commissionPct.toLocaleString(numLocale, { maximumFractionDigits: 2 })}%`} decimal onCommit={opts.onCommitCommission} />
      {opts.commissionPct ? <span className="ml-1.5 text-xs text-fg-faint">({fmt(opts.commissionAmount)})</span> : null}
     </>,
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
      isAdjustment ? (
       <span className="text-fg-faint">{t('adjustment_label')}</span>
      ) : (
       <select
        value={tx.type}
        onChange={(e) => update({ type: e.target.value })}
        className={`${seamlessSelectClassName} text-sm text-fg text-right`}
       >
        <option value="buy">{t('transaction_type_buy')}</option>
        <option value="sell">{t('transaction_type_sell')}</option>
        <option value="exchange">{t('transaction_type_exchange')}</option>
        <option value="transfer">{t('transaction_type_transfer')}</option>
       </select>
      ),
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
       <span className="text-fg-faint">{tx.currencySymbol || tx.currencyCode}</span>
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
      rate: tx.exchangeRateFrom,
      reversed: !!tx.exchangeRateFromReversed,
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
      rate: tx.exchangeRateTo,
      reversed: !!tx.exchangeRateToReversed,
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

    {tx.archiveNote?.trim() ? (
     <div className="mt-3 divide-y divide-border rounded border border-border bg-surface-2 px-3">
      {row(
       t('archive_more_info'),
       <EditableField editValue={tx.archiveNote} display={tx.archiveNote} onCommit={(raw) => update({ archiveNote: raw })} />,
      )}
     </div>
    ) : null}
   </div>
  </div>
 );
}
