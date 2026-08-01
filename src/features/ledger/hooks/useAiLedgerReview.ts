'use client';

import { alertDialog } from '@/components/ui/AppDialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { formatDateValue } from '@/shared/utils/date';
import type { ClientLedgerEntry } from '@/shared/types';

type FlaggedEntry = { transactionId: number; concern: string };

// AI-powered second pass over an export range, on top of the statistical checks in
// ledgerAnomalies.ts. Advisory only — unlike those checks, this never blocks export; the
// user reads the findings (if any) and proceeds however they see fit.
export function useAiLedgerReview() {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const pdfSettings = useSettingsStore((s) => s.pdfSettings);

 async function reviewLedgerWithAi(entries: ClientLedgerEntry[]): Promise<void> {
  try {
   const response = await fetch('/api/ai/review-ledger', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
     language,
     entries: entries.map((entry) => ({
      transactionId: entry.transactionId,
      date: entry.createdAt,
      description: entry.description || '',
      amount: entry.amount,
      currencyCode: entry.currencyCode,
      exchangeRate: entry.exchangeRate,
      commission: entry.commission,
      direction: entry.direction,
     })),
    }),
   });
   const data = (await response.json().catch(() => null)) as { flagged?: FlaggedEntry[] } | null;
   if (!response.ok || !data) {
    await alertDialog({ title: t('ai_review_title'), message: t('ai_review_error'), tone: 'danger' });
    return;
   }
   const flagged = data.flagged ?? [];
   if (flagged.length === 0) {
    await alertDialog({ title: t('ai_review_title'), message: t('ai_review_none_found') });
    return;
   }
   const byId = new Map(entries.map((entry) => [entry.transactionId, entry]));
   const lines = flagged.map(({ transactionId, concern }) => {
    const entry = byId.get(transactionId);
    const label = entry ? `${formatDateValue(entry.createdAt, pdfSettings.dateFormat)} · ${entry.description || entry.counterpartyName}` : `#${transactionId}`;
    return `${label}\n${concern}`;
   });
   await alertDialog({ title: t('ai_review_title'), message: lines.join('\n\n'), tone: 'danger' });
  } catch {
   await alertDialog({ title: t('ai_review_title'), message: t('ai_review_error'), tone: 'danger' });
  }
 }

 return { reviewLedgerWithAi };
}
