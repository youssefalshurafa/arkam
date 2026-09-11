'use client';

import { useCallback, useMemo, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { panelClassName } from '@/shared/styles';
import { formatDateValue } from '@/shared/utils/date';
import { useLedgerStore } from '@/features/ledger/store/ledgerStore';
import { describeCommissionCeiling } from '@/features/ledger/utils/ledgerAnomalies';
import {
 DEFAULT_FIXED_CEILING,
 DEFAULT_REVIEW_SETTINGS,
 REVIEW_LIMITS,
 type ReviewEngineSettings as ReviewSettings,
 type ReviewSensitivity,
} from '@/features/ledger/utils/reviewSettings';
import type { Client, ClientAccount, Transaction } from '@/shared/types';

type ReviewEngineSettingsProps = {
 isWorkspaceOwnerOrAdmin: boolean;
 transactions: Transaction[];
 clients: Client[];
 clientAccounts: ClientAccount[];
 reviewSettings: ReviewSettings;
 onSave: (settings: ReviewSettings) => void;
 openClientLedger: (client: Client, origin?: 'clients' | 'organization-clients', accountId?: number | null) => void;
};

// How many of the largest recorded commissions the breakdown lists. Enough to see the shape of
// the top of the distribution and to reach the anchor in normal books, short enough to stay a
// glance rather than a report.
const CEILING_SAMPLES_SHOWN = 8;

const SENSITIVITIES: ReviewSensitivity[] = ['strict', 'balanced', 'relaxed'];

/**
 * Settings > Second Accountant: how the entry-review engine (ledgerAnomalies.ts) judges this
 * workspace's entries. Every control writes the whole settings object, so a save is one
 * round-trip and there is no partially-applied state to reason about.
 *
 * Deliberately worded in terms of what the user sees happen ("start checking after N similar
 * transactions") rather than the statistics underneath. The one place a raw number is unavoidable
 * is the commission ceiling, and there the measured value is shown alongside so the user can
 * judge whether overriding it is worth doing at all.
 */
export default function ReviewEngineSettingsTab({
 isWorkspaceOwnerOrAdmin,
 transactions,
 clients,
 clientAccounts,
 reviewSettings,
 onSave,
 openClientLedger,
}: ReviewEngineSettingsProps) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const numLocale = language === 'fr' ? 'en-US' : language;
 const setFlashLedgerEntry = useLedgerStore((s) => s.setFlashLedgerEntry);

 // What 'auto' currently works out to on this workspace's books, and the rows it was taken from
 // — shown next to the option so the choice is informed rather than blind. Null when there
 // aren't enough recorded commissions for the measurement to mean anything, which is itself
 // worth telling the user.
 const ceiling = useMemo(() => describeCommissionCeiling(transactions), [transactions]);
 const clientAccountById = useMemo(() => new Map(clientAccounts.map((account) => [account.id, account])), [clientAccounts]);
 const clientById = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);

 // The fixed-ceiling input is free text while being typed (so a half-typed "1" isn't clamped to
 // the minimum under the user's fingers) and only becomes a number on commit.
 const [ceilingDraft, setCeilingDraft] = useState<string | null>(null);
 const [showCeilingSamples, setShowCeilingSamples] = useState(false);

 // Opens the ledger the commission was recorded on and flashes the row, the same way the
 // "needs review" queue on Overview navigates to a flagged entry. A useCallback rather than a
 // plain function so the Date.now() stamp stays inside an event handler rather than reading as
 // render-phase work.
 const openCommissionRow = useCallback(
  (transactionId: number, accountId: number) => {
   const account = clientAccountById.get(accountId);
   const client = account ? clientById.get(account.clientId) : undefined;
   if (!client) return;
   openClientLedger(client, 'clients', accountId);
   // 'row' rather than 'commission': these are the workspace's largest commissions, not
   // necessarily flagged ones, so there may be no badge to flash — ring the row instead.
   setFlashLedgerEntry({ transactionId, accountId, kind: 'row', requestedAt: Date.now() });
  },
  [clientAccountById, clientById, openClientLedger, setFlashLedgerEntry],
 );

 if (!isWorkspaceOwnerOrAdmin) return null;

 const update = (patch: Partial<ReviewSettings>) => onSave({ ...reviewSettings, ...patch });
 const updateRate = (patch: Partial<ReviewSettings['rate']>) => update({ rate: { ...reviewSettings.rate, ...patch } });
 const updateCommission = (patch: Partial<ReviewSettings['commission']>) => update({ commission: { ...reviewSettings.commission, ...patch } });

 const engineOff = !reviewSettings.enabled;
 const percent = (share: number) => Math.round(share * 100);

 const toggle = (checked: boolean, onChange: (next: boolean) => void, disabled = false) => (
  <button
   type="button"
   role="switch"
   aria-checked={checked}
   disabled={disabled}
   onClick={() => onChange(!checked)}
   className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-40 ${checked ? 'bg-accent' : 'bg-border-strong'}`}
  >
   <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface transition-all ${checked ? 'start-[22px]' : 'start-0.5'}`} />
  </button>
 );

 const numberField = (value: number, onCommit: (next: number) => void, bounds: { min: number; max: number }, disabled: boolean) => (
  <input
   type="number"
   min={bounds.min}
   max={bounds.max}
   disabled={disabled}
   value={value}
   onChange={(event) => {
    const next = Number(event.target.value);
    if (Number.isFinite(next)) onCommit(Math.min(bounds.max, Math.max(bounds.min, Math.round(next))));
   }}
   className="w-20 rounded border border-border-strong bg-surface px-2 py-1 text-sm text-fg outline-none focus:ring-1 focus:ring-accent disabled:opacity-40"
  />
 );

 const subSection = (title: string, description: string, enabled: boolean, onToggle: (next: boolean) => void, body: React.ReactNode) => (
  <div className={`rounded-lg border border-border p-4 transition ${engineOff ? 'opacity-50' : ''}`}>
   <div className="flex items-start justify-between gap-4">
    <div>
     <h4 className="font-semibold text-fg">{title}</h4>
     <p className="mt-0.5 text-sm text-fg-muted">{description}</p>
    </div>
    {toggle(enabled, onToggle, engineOff)}
   </div>
   {enabled ? <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">{body}</div> : null}
  </div>
 );

 const row = (label: string, hint: string, control: React.ReactNode) => (
  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
   <div className="min-w-0">
    <p className="text-sm text-fg">{label}</p>
    <p className="text-xs text-fg-faint">{hint}</p>
   </div>
   {control}
  </div>
 );

 return (
  <section className={panelClassName}>
   <div className="flex items-start justify-between gap-4">
    <div>
     <h3 className="text-lg font-semibold">{t('settings_review_title')}</h3>
     <p className="mt-1 text-sm text-fg-muted">{t('settings_review_description')}</p>
    </div>
    {toggle(reviewSettings.enabled, (enabled) => update({ enabled }))}
   </div>

   <p className="mt-3 rounded-lg border border-border bg-surface-hover px-3 py-2 text-xs text-fg-muted">{t('settings_review_advisory_note')}</p>

   <div className="mt-4 flex flex-col gap-4">
    {subSection(
     t('settings_review_rate_title'),
     t('settings_review_rate_description'),
     reviewSettings.rate.enabled,
     (enabled) => updateRate({ enabled }),
     <>
      {row(
       t('settings_review_sensitivity'),
       t('settings_review_sensitivity_hint'),
       <div className="flex overflow-hidden rounded border border-border-strong">
        {SENSITIVITIES.map((level) => (
         <button
          key={level}
          type="button"
          disabled={engineOff}
          onClick={() => updateRate({ sensitivity: level })}
          className={`px-3 py-1 text-xs font-semibold transition disabled:cursor-not-allowed ${
           reviewSettings.rate.sensitivity === level ? 'bg-accent text-accent-contrast' : 'bg-surface text-fg-muted hover:bg-surface-hover'
          }`}
         >
          {t(`settings_review_sensitivity_${level}`)}
         </button>
        ))}
       </div>,
      )}
      {row(
       t('settings_review_min_samples'),
       t('settings_review_min_samples_rate_hint'),
       numberField(reviewSettings.rate.minSamples, (minSamples) => updateRate({ minSamples }), REVIEW_LIMITS.minSamples, engineOff),
      )}
     </>,
    )}

    {subSection(
     t('settings_review_commission_title'),
     t('settings_review_commission_description'),
     reviewSettings.commission.enabled,
     (enabled) => updateCommission({ enabled }),
     <>
      {row(
       t('settings_review_min_samples'),
       t('settings_review_min_samples_commission_hint'),
       numberField(reviewSettings.commission.minSamples, (minSamples) => updateCommission({ minSamples }), REVIEW_LIMITS.minSamples, engineOff),
      )}
      {row(
       t('settings_review_agreement'),
       t('settings_review_agreement_hint'),
       <div className="flex items-center gap-2">
        <input
         type="range"
         min={percent(REVIEW_LIMITS.agreement.min)}
         max={percent(REVIEW_LIMITS.agreement.max)}
         step={5}
         disabled={engineOff}
         value={percent(reviewSettings.commission.agreement)}
         onChange={(event) => updateCommission({ agreement: Number(event.target.value) / 100 })}
         className="w-36 accent-accent disabled:opacity-40"
        />
        <span className="w-10 text-end text-sm tabular-nums text-fg">{percent(reviewSettings.commission.agreement)}%</span>
       </div>,
      )}
      <div className="border-t border-border pt-3">
       <p className="text-sm text-fg">{t('settings_review_ceiling')}</p>
       <p className="text-xs text-fg-faint">{t('settings_review_ceiling_hint')}</p>
       <div className="mt-2 flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm text-fg">
         <input
          type="radio"
          name="review-ceiling-mode"
          disabled={engineOff}
          checked={reviewSettings.commission.ceiling.mode === 'auto'}
          onChange={() => updateCommission({ ceiling: { mode: 'auto' } })}
          className="accent-accent"
         />
         <span>
          {t('settings_review_ceiling_auto')}
          {/* The measured figure is derived, so it has to be auditable: clicking it opens the
              rows it was taken from rather than leaving the user to trust a bare number. */}
          {ceiling.ceiling == null ? (
           <span className="ms-2 text-xs text-fg-faint">{t('settings_review_ceiling_auto_unmeasurable')}</span>
          ) : (
           <button
            type="button"
            onClick={() => setShowCeilingSamples((open) => !open)}
            aria-expanded={showCeilingSamples}
            className="ms-2 text-xs font-semibold text-accent underline decoration-dotted underline-offset-2 transition hover:opacity-80"
            title={t('settings_review_ceiling_explain_hint')}
           >
            {t('settings_review_ceiling_auto_current', { value: ceiling.ceiling.toFixed(2) })}
           </button>
          )}
         </span>
        </label>

        {showCeilingSamples && ceiling.percentileValue != null ? (
         <div className="ms-6 rounded-lg border border-border bg-surface-hover p-3">
          <p className="text-xs text-fg-muted">
           {t('settings_review_ceiling_explain', {
            percentile: ceiling.percentileValue.toFixed(2),
            count: ceiling.sampleSize.toLocaleString(numLocale),
           })}
          </p>
          <p className="mt-2 text-xs font-semibold text-fg-faint">{t('settings_review_ceiling_samples_title')}</p>
          <div className="mt-1 flex flex-col">
           {ceiling.samples.slice(0, CEILING_SAMPLES_SHOWN).map((sample) => {
            const account = clientAccountById.get(sample.accountId);
            // A commission recorded on an account that has since been deleted can't be opened,
            // so it is listed for completeness but not offered as a link.
            const openable = Boolean(account && clientById.has(account.clientId));
            return (
             <button
              key={`${sample.transactionId}:${sample.accountId}`}
              type="button"
              disabled={!openable}
              onClick={() => openCommissionRow(sample.transactionId, sample.accountId)}
              className="flex items-center gap-2 rounded px-1 py-1 text-start text-xs transition enabled:hover:bg-surface disabled:cursor-default disabled:opacity-60"
             >
              <span className="w-14 shrink-0 tabular-nums text-fg-faint">{formatDateValue(sample.createdAt, 'day-month')}</span>
              <span className="w-14 shrink-0 text-end font-semibold tabular-nums text-fg">
               {sample.commission.toLocaleString(numLocale, { maximumFractionDigits: 3 })}%
              </span>
              <span className="min-w-0 flex-1 truncate text-fg-muted">{account?.clientName ?? ''}</span>
              {sample.isAnchor ? (
               <span className="shrink-0 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">{t('settings_review_ceiling_anchor')}</span>
              ) : null}
             </button>
            );
           })}
          </div>
          <p className="mt-2 text-[11px] text-fg-faint">{t('settings_review_ceiling_anchor_hint')}</p>
         </div>
        ) : null}
        <label className="flex items-center gap-2 text-sm text-fg">
         <input
          type="radio"
          name="review-ceiling-mode"
          disabled={engineOff}
          checked={reviewSettings.commission.ceiling.mode === 'fixed'}
          onChange={() => updateCommission({ ceiling: { mode: 'fixed', value: DEFAULT_FIXED_CEILING } })}
          className="accent-accent"
         />
         <span className="flex items-center gap-2">
          {t('settings_review_ceiling_fixed')}
          <input
           type="number"
           min={REVIEW_LIMITS.ceiling.min}
           max={REVIEW_LIMITS.ceiling.max}
           step="0.1"
           disabled={engineOff || reviewSettings.commission.ceiling.mode !== 'fixed'}
           value={ceilingDraft ?? (reviewSettings.commission.ceiling.mode === 'fixed' ? String(reviewSettings.commission.ceiling.value) : String(DEFAULT_FIXED_CEILING))}
           onChange={(event) => setCeilingDraft(event.target.value)}
           onBlur={() => {
            const parsed = Number(ceilingDraft);
            setCeilingDraft(null);
            if (ceilingDraft == null || !Number.isFinite(parsed)) return;
            updateCommission({ ceiling: { mode: 'fixed', value: Math.min(REVIEW_LIMITS.ceiling.max, Math.max(REVIEW_LIMITS.ceiling.min, parsed)) } });
           }}
           className="w-20 rounded border border-border-strong bg-surface px-2 py-1 text-sm text-fg outline-none focus:ring-1 focus:ring-accent disabled:opacity-40"
          />
          <span className="text-fg-faint">%</span>
         </span>
        </label>
       </div>
      </div>
     </>,
    )}

    <div className={`rounded-lg border border-border p-4 transition ${engineOff ? 'opacity-50' : ''}`}>
     <div className="flex items-start justify-between gap-4">
      <div>
       <h4 className="font-semibold text-fg">{t('settings_review_export_title')}</h4>
       <p className="mt-0.5 text-sm text-fg-muted">{t('settings_review_export_description')}</p>
      </div>
      {toggle(reviewSettings.warnOnExport, (warnOnExport) => update({ warnOnExport }), engineOff)}
     </div>
    </div>
   </div>

   <button
    type="button"
    onClick={() => onSave(DEFAULT_REVIEW_SETTINGS)}
    className="mt-4 text-xs font-semibold text-fg-faint underline transition hover:text-fg"
   >
    {t('settings_review_reset')}
   </button>
  </section>
 );
}
