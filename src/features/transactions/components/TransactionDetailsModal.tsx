'use client';

import type { ReactNode } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { formatDateValue } from '@/shared/utils/date';
import { transactionTypeLabelKey } from '@/shared/utils/transactionType';
import { formatRateValue } from '@/shared/utils/format';
import { getCommissionAmount, exchangeToBase, parseChargesPayer, type ChargesPayerParty } from '@/shared/utils/commission';
import { useTransactionsStore } from '@/features/transactions/store/transactionsStore';
import type { Transaction } from '@/shared/types';

type TransactionDetailsModalProps = {
 transactions: Transaction[];
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

/**
 * Read-only "More info" popup for a single transaction, opened from the ledger and
 * transactions-table row context menus (via `infoTransactionId` in the transactions store).
 * Unlike a client ledger — which only shows the current account's side — this shows BOTH
 * sides in full (each party's exchange rate, commission %, and computed commission amount),
 * so e.g. the counterparty's commission is visible even while viewing the other client's
 * ledger. Mounted once at page level, where the full transaction list is in scope.
 */
export default function TransactionDetailsModal({ transactions }: TransactionDetailsModalProps) {
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

 // The stored chargesPayer encodes a payer→payee pair (each end is the sender, the receiver,
 // or "me"/the org). Resolve each end to a display name so the popup states who paid whom —
 // information a single client's ledger can't convey.
 const partyName = (party: ChargesPayerParty) =>
  party === 'from' ? tx.clientFromName : party === 'to' ? tx.clientToName : party === 'me' ? t('charges_payer_me') : '';
 const chargesParties = parseChargesPayer(tx.chargesPayer);
 const chargesPayerName = partyName(chargesParties.payer);
 const chargesPayeeName = partyName(chargesParties.payee);

 const commissionCell = (pct: number, amount: number) => (
  <>
   {pct.toLocaleString(numLocale, { maximumFractionDigits: 2 })}%{pct ? <span className="ml-1.5 text-xs text-fg-faint">({fmt(amount)})</span> : null}
  </>
 );

 const sideCard = (opts: {
  title: string;
  name: string;
  currencyCode: string;
  rate: number;
  reversed: boolean;
  commissionCellNode: ReactNode;
  extraRows: ReactNode[];
 }) => (
  <div className="flex-1 rounded border border-border bg-surface-2 p-3">
   <p className="text-xs font-semibold uppercase tracking-wide text-accent">{opts.title}</p>
   <p className="mt-1 truncate text-sm font-semibold text-fg" title={opts.name || '—'}>
    {opts.name || <span className="text-fg-faint">—</span>}
    {opts.currencyCode ? <span className="ml-1.5 text-xs font-normal text-fg-faint">{opts.currencyCode}</span> : null}
   </p>
   <div className="mt-2 divide-y divide-border border-t border-border">
    {row(t('exchange_rate'), rateDisplay(opts.rate, opts.reversed))}
    {row(t('commission'), opts.commissionCellNode)}
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
     {row(t('transaction_type'), t(transactionTypeLabelKey(tx.type)))}
     {row(t('transaction_amount'), <>{fmt(tx.amount)} <span className="text-fg-faint">{tx.currencySymbol || tx.currencyCode}</span></>)}
     {tx.description ? row(t('transaction_description'), tx.description) : null}
    </div>

    <div className="mt-3 flex flex-col gap-3 sm:flex-row">
     {sideCard({
      title: t('transaction_account_from'),
      name: tx.clientFromName,
      currencyCode: tx.accountFromCurrencyCode,
      rate: tx.exchangeRateFrom,
      reversed: !!tx.exchangeRateFromReversed,
      commissionCellNode: commissionCell(tx.commissionFrom, fromCommissionAmount),
      extraRows: [tx.descriptionFrom?.trim() ? row(t('transaction_description'), tx.descriptionFrom, 'desc-from') : null],
     })}
     {sideCard({
      title: t('transaction_account_to'),
      name: tx.clientToName,
      currencyCode: tx.accountToCurrencyCode,
      rate: tx.exchangeRateTo,
      reversed: !!tx.exchangeRateToReversed,
      commissionCellNode: commissionCell(tx.commissionTo, toCommissionAmount),
      extraRows: [
       isExchange && tx.exchangeActualAmount != null ? row(t('exchange_actual_label'), fmt(tx.exchangeActualAmount)) : null,
       tx.descriptionTo?.trim() ? row(t('transaction_description'), tx.descriptionTo, 'desc-to') : null,
      ],
     })}
    </div>

    {tx.charges > 0 ? (
     <div className="mt-3 divide-y divide-border rounded border border-border bg-surface-2 px-3">
      {row(t('charges'), <>{fmt(tx.charges)} <span className="text-fg-faint">{tx.chargesCurrencySymbol || tx.chargesCurrencyCode || ''}</span></>)}
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
      {tx.chargesDescription ? row(t('charges_description'), tx.chargesDescription) : null}
     </div>
    ) : null}

    {tx.archiveNote?.trim() ? (
     <div className="mt-3 divide-y divide-border rounded border border-border bg-surface-2 px-3">{row(t('archive_more_info'), tx.archiveNote)}</div>
    ) : null}

    <div className="mt-5 flex justify-end">
     <button
      type="button"
      onClick={close}
      className="rounded border border-border-strong px-4 py-2 text-sm font-semibold text-fg-muted transition hover:bg-surface-hover"
     >
      {t('close')}
     </button>
    </div>
   </div>
  </div>
 );
}
