'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';

export type HarvestAwaitingPricingRow = { clientId: number; clientName: string; count: number };

type HarvestAwaitingPricingModalProps = {
  rows: HarvestAwaitingPricingRow[];
  onSelectClient: (clientId: number) => void;
  onClose: () => void;
};

// Read-only-except-the-count popup listing, per client, how many of this day's
// transactions/adjustments still have no exchange rate entered on them at all — the same
// pending definition the organization page's client list and the client ledger show.
// Clicking a client's count opens PendingPricingModal, the exact same popup the
// organization page uses, so the rate can be entered right there.
export default function HarvestAwaitingPricingModal({ rows, onSelectClient, onClose }: HarvestAwaitingPricingModalProps) {
  const { language } = useLanguage();
  const { t } = useTranslation(language);

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
          {rows.length === 0 ? (
            <p className="py-3 text-sm text-fg-faint">{t('harvest_no_transactions_today')}</p>
          ) : (
            rows.map((row) => (
              <div key={row.clientId} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="truncate font-semibold text-fg">{row.clientName || '—'}</span>
                <button
                  type="button"
                  onClick={() => onSelectClient(row.clientId)}
                  title={t(row.count === 1 ? 'ledger_pending_balance_note' : 'ledger_pending_balance_note_plural', { count: row.count })}
                  className="cursor-pointer rounded bg-warn-bg px-1.5 py-0.5 font-mono text-xs font-semibold text-warn-text transition hover:opacity-80"
                >
                  {row.count}
                </button>
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
