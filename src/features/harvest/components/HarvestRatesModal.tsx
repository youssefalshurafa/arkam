'use client';

import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { normalizeDecimalInput } from '@/shared/utils/decimal';
import type { Currency } from '@/shared/types';

export type HarvestPriceGroup = { key: string; name: string; organizationId: number | null; currencies: Map<number, Currency> };
export type HarvestRateEdit = { currencyId: number; groupKey: string; value: string };

// Modal-local key — the modal is always scoped to a single `dateKey` per open, so
// unlike the old localStorage-era key this doesn't need the day baked in.
const rateInputKey = (currencyId: number, groupKey: string) => `${currencyId}:${groupKey}`;

type HarvestRatesModalProps = {
  mainCode: string;
  priceGroups: HarvestPriceGroup[];
  rates: Record<string, string>;
  onSave: (edits: HarvestRateEdit[]) => void | Promise<void>;
  onClose: () => void;
};

// Buffered edit-then-save dialog for حصاد اليوم's daily reference prices — replaces the
// old always-open, save-on-every-keystroke inline panel. Edits are staged locally and only
// committed (via the caller's onSave, which persists to the DB) when the user presses Save.
export default function HarvestRatesModal({ mainCode, priceGroups, rates, onSave, onClose }: HarvestRatesModalProps) {
  const { language } = useLanguage();
  const { t } = useTranslation(language);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const valueFor = (key: string) => (key in draft ? draft[key] : rates[key] ?? '');

  const handleSave = async () => {
    const edits: HarvestRateEdit[] = [];
    for (const group of priceGroups) {
      for (const currencyId of group.currencies.keys()) {
        const key = rateInputKey(currencyId, group.key);
        if (key in draft) edits.push({ currencyId, groupKey: group.key, value: draft[key] });
      }
    }
    await onSave(edits);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg bg-surface p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-weak text-accent">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </span>
          <div>
            <h3 className="text-lg font-semibold text-fg">{t('harvest_todays_price_title')}</h3>
            <p className="text-xs text-fg-faint">{t('harvest_todays_price_hint', { currency: mainCode })}</p>
          </div>
        </div>

        <div className="mt-4 flex max-h-[60vh] flex-col gap-2.5 overflow-y-auto">
          {priceGroups.length === 0 ? (
            <p className="text-sm text-fg-faint">{t('harvest_no_transactions_today')}</p>
          ) : (
            priceGroups.map((group) => (
              <div key={group.key} className="rounded-md border border-border bg-surface-2 px-3 py-2.5">
                <div className="text-xs font-semibold text-fg">{group.name}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {[...group.currencies.values()].map((c) => {
                    const key = rateInputKey(c.id, group.key);
                    const value = valueFor(key);
                    return (
                      <label
                        key={c.id}
                        className={`flex items-center gap-2 rounded-md border bg-surface px-2.5 py-1.5 text-sm text-fg-muted ${value ? 'border-border' : 'border-warn'}`}
                      >
                        <span dir="ltr" className="font-semibold text-fg">
                          1 {c.symbol || c.code} =
                        </span>
                        <input
                          type="text"
                          inputMode="decimal"
                          dir="ltr"
                          value={value}
                          onChange={(e) => setDraft((d) => ({ ...d, [key]: normalizeDecimalInput(e.target.value) }))}
                          className="w-24 rounded border border-border-strong bg-surface px-2 py-1 text-sm outline-none ring-blue-300 focus:ring"
                        />
                        <span className="text-fg-faint">{mainCode}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center rounded border border-border-strong bg-surface-2 px-3 text-sm font-semibold text-fg-muted transition hover:bg-surface-hover"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="inline-flex h-9 items-center rounded bg-accent px-4 text-sm font-semibold text-accent-contrast transition hover:opacity-90"
          >
            {t('save')}
          </button>
        </div>
      </div>
    </div>
  );
}
