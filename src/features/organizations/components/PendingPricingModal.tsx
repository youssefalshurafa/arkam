'use client';

import { useId, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { formatDateValue } from '@/shared/utils/date';
import { normalizePlainDecimalInput } from '@/shared/utils/decimal';
import type { PdfSettings } from '@/shared/types';
import type { PendingPricingEntry } from '@/features/clients/utils/clientBalances';

type PendingPricingModalProps = {
 // Names whose pending rows these are — a single client's name. Reused verbatim by the
 // organizations-list flow: clicking an org's count first opens OrgPendingPricingClientsModal
 // (a per-client list), and clicking a client there opens THIS modal for just that client, so
 // it never needs to represent more than one client at a time.
 subtitle: string | null;
 entries: PendingPricingEntry[];
 numLocale: string;
 ledgerDecimals: number;
 ledgerDateFormat: PdfSettings['dateFormat'];
 // Present only when this modal was reached via OrgPendingPricingClientsModal (the
 // organizations-list flow) — renders a back arrow that returns to that client list instead
 // of closing everything.
 onBack?: () => void;
 onClose: () => void;
 // Persists a rate for one pending entry. Resolves true on success (parent reloads,
 // dropping the now-priced entry from the list). When `reversed` is false the rate means
 // "1 <entry currency> = rate <account currency>" (multiply); when true it means
 // "1 <account currency> = rate <entry currency>" (divide).
 onSaveRate: (entry: PendingPricingEntry, rate: string, reversed: boolean) => Promise<boolean>;
 // Dismisses one pending row from every "awaiting pricing" warning workspace-wide (this popup,
 // the client ledger's own pending list, the organization count) without setting a rate — for
 // rows the user has reviewed and decided don't need one. Shared with the ledger row's own
 // ignore action (see anomalyKey/'pendingRate' in ledgerAnomalies.ts).
 onIgnoreAnomaly: (kind: 'pendingRate', transactionId: number, accountId: number) => void;
};

// Same parse the parent's onSaveRate applies, so the Set button / live conversion preview only
// light up for a rate the save will actually accept.
function parseRate(value: string): number | null {
 const rate = parseFloat(normalizePlainDecimalInput(value));
 return Number.isFinite(rate) && rate > 0 ? rate : null;
}

const iconProps = {
 viewBox: '0 0 24 24',
 fill: 'none',
 stroke: 'currentColor',
 strokeLinecap: 'round',
 strokeLinejoin: 'round',
 'aria-hidden': true,
} as const;

// Popup listing one client's cross-currency rows that still have no exchange rate (excluded
// from the balance until priced). Each row carries an inline rate field so the pricing can be
// done here, instead of only in the client ledger.
export default function PendingPricingModal({
 subtitle,
 entries,
 numLocale,
 ledgerDecimals,
 ledgerDateFormat,
 onBack,
 onClose,
 onSaveRate,
 onIgnoreAnomaly,
}: PendingPricingModalProps) {
 const { language, isRTL } = useLanguage();
 const { t } = useTranslation(language);
 const titleId = useId();

 const [rateInputs, setRateInputs] = useState<Record<string, string>>({});
 const [reversedInputs, setReversedInputs] = useState<Record<string, boolean>>({});
 const [savingKey, setSavingKey] = useState<string | null>(null);
 const [savingAll, setSavingAll] = useState(false);
 // Rows whose rate section is folded away (everything starts expanded). Folding only hides the
 // UI — a rate typed into a collapsed row is kept and still counts toward "Set all".
 const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
 const allCollapsed = entries.length > 0 && entries.every((entry) => collapsed[entry.key]);
 const toggleAll = () => setCollapsed(allCollapsed ? {} : Object.fromEntries(entries.map((entry) => [entry.key, true])));
 const toggleRow = (key: string) => setCollapsed((current) => ({ ...current, [key]: !current[key] }));

 const formatAmount = (value: number) => value.toLocaleString(numLocale, { maximumFractionDigits: ledgerDecimals });

 const saveEntry = async (entry: PendingPricingEntry) => {
  const value = (rateInputs[entry.key] ?? '').trim();
  if (parseRate(value) == null) return;
  setSavingKey(entry.key);
  try {
   const ok = await onSaveRate(entry, value, !!reversedInputs[entry.key]);
   if (ok) {
    setRateInputs((current) => {
     const next = { ...current };
     delete next[entry.key];
     return next;
    });
    setReversedInputs((current) => {
     const next = { ...current };
     delete next[entry.key];
     return next;
    });
   }
  } finally {
   setSavingKey(null);
  }
 };

 // Saves every row that currently has a valid rate typed in, one at a time (each save reloads
 // the full dataset, so running them concurrently would race). Rows left blank are skipped and
 // stay in the list for later.
 const readyToSaveCount = entries.filter((entry) => parseRate(rateInputs[entry.key] ?? '') != null).length;
 const saveAll = async () => {
  setSavingAll(true);
  try {
   for (const entry of entries) {
    if (parseRate(rateInputs[entry.key] ?? '') != null) await saveEntry(entry);
   }
  } finally {
   setSavingAll(false);
  }
 };

 const spinner = (
  <svg width="14" height="14" {...iconProps} strokeWidth="2.4" className="animate-spin">
   <path d="M21 12a9 9 0 1 1-6.22-8.56" />
  </svg>
 );

 return (
  <div
   className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 backdrop-blur-[2px] sm:items-center sm:p-4"
   onClick={onClose}
  >
   <div
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
    className="flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-2xl sm:max-h-[80vh] sm:max-w-lg sm:rounded-2xl"
    onClick={(e) => e.stopPropagation()}
   >
    {/* Header */}
    <div className="flex items-center gap-3 border-b border-border px-4 py-4 sm:px-5">
     {onBack ? (
      <button
       type="button"
       onClick={onBack}
       aria-label={t('import_back')}
       title={t('import_back')}
       className="-ms-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-fg-faint transition hover:bg-surface-hover hover:text-fg"
      >
       <svg width="18" height="18" {...iconProps} strokeWidth="2.2">
        <path d={isRTL ? 'M9 18l6-6-6-6' : 'M15 18l-6-6 6-6'} />
       </svg>
      </button>
     ) : null}
     <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warn-bg text-warn">
      <svg width="20" height="20" {...iconProps} strokeWidth="1.9">
       <path d="M5 22h14M5 2h14" />
       <path d="M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22" />
       <path d="M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2" />
      </svg>
     </span>
     <div className="min-w-0 flex-1">
      {/* With a client name, the name leads and the dialog title becomes a small label above it. */}
      <div className="flex items-center gap-2">
       <h2
        id={titleId}
        className={`truncate ${subtitle ? 'text-sm font-medium text-fg-muted' : 'text-base font-semibold text-fg'}`}
       >
        {t('pending_pricing_modal_title')}
       </h2>
       {entries.length > 0 ? (
        <span className="shrink-0 rounded-full bg-warn-bg px-1.5 py-px text-[11px] font-semibold tabular-nums text-warn-text">
         {entries.length}
        </span>
       ) : null}
      </div>
      {subtitle ? <p className="mt-1 truncate text-lg font-bold leading-snug text-fg">{subtitle}</p> : null}
     </div>
     <div className="flex shrink-0 items-center gap-0.5 self-start">
      {entries.length > 1 ? (
       <button
        type="button"
        onClick={toggleAll}
        aria-label={allCollapsed ? t('pending_pricing_expand_all') : t('pending_pricing_collapse_all')}
        title={allCollapsed ? t('pending_pricing_expand_all') : t('pending_pricing_collapse_all')}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-faint transition hover:bg-surface-hover hover:text-fg"
       >
        <svg width="17" height="17" {...iconProps} strokeWidth="2.2">
         {allCollapsed ? (
          <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />
         ) : (
          <path d="m7 20 5-5 5 5M7 4l5 5 5-5" />
         )}
        </svg>
       </button>
      ) : null}
      <button
       type="button"
       onClick={onClose}
       aria-label={t('close')}
       className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-faint transition hover:bg-surface-hover hover:text-fg"
      >
       <svg width="18" height="18" {...iconProps} strokeWidth="2.2">
        <path d="M18 6 6 18M6 6l12 12" />
       </svg>
      </button>
     </div>
    </div>

    {/* Entries */}
    <div className="flex-1 overflow-y-auto px-3 py-3 sm:px-5 sm:py-4">
     {entries.length === 0 ? (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
       <span className="flex h-12 w-12 items-center justify-center rounded-full bg-good-bg text-good">
        <svg width="22" height="22" {...iconProps} strokeWidth="2.4">
         <path d="M20 6 9 17l-5-5" />
        </svg>
       </span>
       <p className="text-sm font-medium text-fg-muted">{t('pending_pricing_all_done')}</p>
      </div>
     ) : (
      <ul className="space-y-2.5">
       {entries.map((entry) => {
        const rateValue = rateInputs[entry.key] ?? '';
        const isReversed = !!reversedInputs[entry.key];
        const isSaving = savingKey === entry.key;
        const isBusy = isSaving || savingAll;
        const rate = parseRate(rateValue);
        const isInvalid = rateValue.trim() !== '' && rate == null;
        // The rate reads "1 <from> = rate <to>"; reversing flips which side is the unit.
        const fromCode = isReversed ? entry.accountCurrencyCode : entry.currencyCode;
        const toCode = isReversed ? entry.currencyCode : entry.accountCurrencyCode;
        const converted = rate == null ? null : isReversed ? entry.amount / rate : entry.amount * rate;
        const isCollapsed = !!collapsed[entry.key];
        const rateSectionId = `${titleId}-rate-${entry.key}`;
        return (
         <li
          key={entry.key}
          className={`rounded-xl border border-border bg-surface-2 transition ${isSaving ? 'opacity-60' : ''}`}
         >
          {/* One line: date, description, amount — and the other party on the far side. */}
          <div className="flex items-center justify-between gap-3 px-3.5 py-3">
           <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="shrink-0 text-xs tabular-nums text-fg-faint">{formatDateValue(entry.createdAt, ledgerDateFormat)}</span>
            {entry.description ? (
             <p className="min-w-0 truncate text-sm font-semibold text-fg" title={entry.description}>{entry.description}</p>
            ) : null}
            {/* Same colour rule as the ledger's amount column: this client on the "from" side is an
                outgoing row (green), on the "to" side an incoming one (red). */}
            <span
             dir="ltr"
             className={`shrink-0 whitespace-nowrap text-lg font-bold leading-none tabular-nums ${entry.side === 'from' ? 'text-good-text' : 'text-bad-text'}`}
            >
             <span className="me-1 text-xs font-medium text-fg-muted">{entry.currencySymbol || entry.currencyCode}</span>
             {formatAmount(entry.amount)}
            </span>
           </div>
           <div className="flex min-w-0 max-w-[45%] shrink-0 flex-col items-end gap-1">
            {entry.counterpartyName ? (
             <span className="inline-flex max-w-full items-center gap-1 text-xs text-fg-muted" title={entry.counterpartyName}>
              <svg width="12" height="12" {...iconProps} strokeWidth="2" className="shrink-0">
               <circle cx="12" cy="8" r="4" />
               <path d="M20 21a8 8 0 0 0-16 0" />
              </svg>
              <span className="truncate">{entry.counterpartyName}</span>
             </span>
            ) : null}
            {/* Live preview of the typed rate, in the account's currency */}
            {converted != null ? (
             <p dir="ltr" className="whitespace-nowrap text-xs font-medium tabular-nums text-accent">
              ≈ {formatAmount(converted)} <span className="text-fg-faint">{entry.accountCurrencyCode}</span>
             </p>
            ) : null}
           </div>
           <button
            type="button"
            onClick={() => toggleRow(entry.key)}
            aria-expanded={!isCollapsed}
            aria-controls={rateSectionId}
            aria-label={isCollapsed ? t('pending_pricing_expand_row') : t('pending_pricing_collapse_row')}
            title={isCollapsed ? t('pending_pricing_expand_row') : t('pending_pricing_collapse_row')}
            className="-me-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-faint transition hover:bg-surface-hover hover:text-fg"
           >
            <svg
             width="14"
             height="14"
             {...iconProps}
             strokeWidth="2.2"
             className={`transition-transform duration-200 ${isCollapsed ? '' : 'rotate-180'}`}
            >
             <path d="m6 9 6 6 6-6" />
            </svg>
           </button>
          </div>

          {/* Rate section — folds with a height transition (grid 1fr ↔ 0fr); `inert` keeps the
              hidden field and buttons out of the tab order while collapsed. */}
          <div
           id={rateSectionId}
           inert={isCollapsed}
           className={`grid transition-[grid-template-rows] duration-200 ease-out ${isCollapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'}`}
          >
           <div className="min-h-0 overflow-hidden">
            <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-3 py-2">
             {/* "1 EUR = [rate] MAD ⇄" — always laid out LTR so the equation reads correctly in Arabic too. */}
             <div
              dir="ltr"
              className={`flex h-7 shrink-0 items-center overflow-hidden rounded-md border bg-surface transition focus-within:ring-2 ${
               isInvalid
                ? 'border-bad focus-within:ring-bad/20'
                : 'border-border-strong focus-within:border-accent focus-within:ring-accent/20'
              } ${isBusy ? 'opacity-60' : ''}`}
             >
              <span className="flex h-full shrink-0 items-center whitespace-nowrap border-e border-border bg-surface-2 px-2 text-[11px] font-medium text-fg-muted">
               1 {fromCode} =
              </span>
              <input
               type="text"
               inputMode="decimal"
               value={rateValue}
               onChange={(e) => setRateInputs((current) => ({ ...current, [entry.key]: e.target.value }))}
               onKeyDown={(e) => {
                if (e.key === 'Enter' && !savingAll) {
                 e.preventDefault();
                 void saveEntry(entry);
                }
               }}
               placeholder={t('pending_pricing_rate_placeholder')}
               aria-label={`1 ${fromCode} = ? ${toCode}`}
               aria-invalid={isInvalid || undefined}
               disabled={isBusy}
               className="h-full w-16 bg-transparent px-1.5 text-right text-xs font-semibold tabular-nums text-fg outline-none placeholder:font-normal placeholder:text-fg-faint sm:w-24"
              />
              <span className="shrink-0 pe-2 text-[11px] font-semibold text-fg-muted">{toCode}</span>
              <button
               type="button"
               onClick={() => setReversedInputs((current) => ({ ...current, [entry.key]: !current[entry.key] }))}
               disabled={isBusy}
               aria-pressed={isReversed}
               title={`${t('reverse_rate')} (${isReversed ? t('rate_division') : t('rate_multiplication')})`}
               aria-label={t('reverse_rate')}
               className={`flex h-full w-7 shrink-0 items-center justify-center border-s border-border transition hover:bg-surface-hover disabled:pointer-events-none ${
                isReversed ? 'text-accent' : 'text-fg-faint hover:text-fg'
               }`}
              >
               <svg width="13" height="13" {...iconProps} strokeWidth="2">
                <path d="M8 3 4 7l4 4M4 7h16" />
                <path d="m16 21 4-4-4-4M20 17H4" />
               </svg>
              </button>
             </div>

             <div className="ms-auto flex shrink-0 items-center gap-1">
              <button
               type="button"
               title={t('ignore_anomaly_hint')}
               aria-label={t('ignore_anomaly_confirm_button')}
               onClick={() => onIgnoreAnomaly('pendingRate', entry.transactionId, entry.accountId)}
               disabled={isBusy}
               className="flex h-7 w-7 items-center justify-center rounded-md text-fg-faint transition hover:bg-surface-hover hover:text-fg disabled:opacity-50"
              >
               <svg width="14" height="14" {...iconProps} strokeWidth="1.9">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                <path d="m4 4 16 16" />
               </svg>
              </button>
              <button
               type="button"
               onClick={() => void saveEntry(entry)}
               disabled={isBusy || rate == null}
               className="inline-flex h-7 items-center gap-1 rounded-md bg-accent px-2.5 text-[11px] font-semibold text-accent-contrast transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
              >
               {isSaving ? spinner : (
                <svg width="12" height="12" {...iconProps} strokeWidth="2.6">
                 <path d="M20 6 9 17l-5-5" />
                </svg>
               )}
               {isSaving ? t('saving') : t('pending_pricing_set_rate')}
              </button>
             </div>
            </div>
           </div>
          </div>
         </li>
        );
       })}
      </ul>
     )}
    </div>

    {/* Bulk save — only worth showing when there's more than one row to price */}
    {entries.length > 1 ? (
     <div className="flex items-center justify-between gap-3 border-t border-border bg-surface-2 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
      <p className="text-xs text-fg-muted">
       {t('pending_pricing_ready_count', { ready: readyToSaveCount, total: entries.length })}
      </p>
      <button
       type="button"
       onClick={() => void saveAll()}
       disabled={savingAll || readyToSaveCount === 0}
       className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-contrast transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
      >
       {savingAll ? spinner : null}
       {savingAll ? t('saving') : t('pending_pricing_set_all', { count: readyToSaveCount })}
      </button>
     </div>
    ) : null}
   </div>
  </div>
 );
}
