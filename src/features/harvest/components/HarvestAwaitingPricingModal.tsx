'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { formatTimeValue } from '@/shared/utils/date';
import type { HarvestFlowEntry } from '../utils/harvestFlow';

type HarvestAwaitingPricingModalProps = {
  entries: HarvestFlowEntry[];
  onClose: () => void;
};

// Read-only popup listing today's transactions whose leg currency still lacks a resolvable
// rate — opened from the header's "N transactions awaiting pricing" pill. Purely informational;
// fixing one means entering that organization's rate in the "Today's price" dialog.
export default function HarvestAwaitingPricingModal({ entries, onClose }: HarvestAwaitingPricingModalProps) {
  const { language, isRTL } = useLanguage();
  const { t } = useTranslation(language);
  const numLocale = language === 'fr' ? 'en-US' : language;
  const units = (n: number) => n.toLocaleString(numLocale, { maximumFractionDigits: 0 });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg bg-surface p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warn-bg text-warn-text">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v5" />
              <circle cx="12" cy="16" r="0.5" fill="currentColor" />
            </svg>
          </span>
          <div>
            <h3 className="text-lg font-semibold text-fg">{t('harvest_awaiting_pricing_title')}</h3>
            <p className="text-xs text-fg-faint">{t('harvest_awaiting_pricing_hint')}</p>
          </div>
        </div>

        <div className="mt-4 flex max-h-[60vh] flex-col divide-y divide-border overflow-y-auto">
          {entries.length === 0 ? (
            <p className="py-3 text-sm text-fg-faint">{t('harvest_no_transactions_today')}</p>
          ) : (
            entries.map((entry, i) => (
              <div key={`${entry.transactionId}-${entry.direction}-${i}`} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${entry.direction === 'in' ? 'bg-good' : 'bg-bad'}`} />
                  <span dir="ltr" className="shrink-0 text-xs text-fg-faint whitespace-nowrap">{formatTimeValue(entry.createdAt)}</span>
                  <span className={`truncate font-semibold text-fg ${isRTL ? 'text-right' : 'text-left'}`}>{entry.clientName || '—'}</span>
                </div>
                <span dir="ltr" className="shrink-0 font-semibold text-warn-text whitespace-nowrap">
                  {units(entry.units)} {entry.symbol || entry.code}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center rounded border border-border-strong bg-surface-2 px-3 text-sm font-semibold text-fg-muted transition hover:bg-surface-hover"
          >
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  );
}
