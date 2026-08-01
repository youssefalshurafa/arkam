'use client';

import { alertDialog } from '@/components/ui/AppDialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';

export type AiLedgerEditEntry = {
 transactionId: number;
 date: string;
 counterpartyName: string;
 // Free-text note field, often used to name a place/counterparty distinct from the formal
 // counterpartyName (e.g. "Milano", "Berlin") — commands frequently refer to this instead.
 description: string;
 exchangeRate: number;
 currencyCode: string;
 // Whether the user has manually highlighted this row in the ledger UI (the same highlight
 // feature used elsewhere for "use highlighted rows" range shortcuts). Lets a command refer to
 // "the highlighted rows" without the AI having to guess what that means from text alone.
 isHighlighted: boolean;
};

export type ProposedLedgerEdit = { transactionId: number; newExchangeRate: number };

// Shaped for inline display directly on the ledger row it applies to (see LedgerSection's
// exchangeRate cell), not a separate review dialog.
export type AiEditLedgerReviewRow = {
 transactionId: number;
 counterpartyName: string;
 date: string;
 oldRate: number;
 newRate: number;
};

// Proposes exchange-rate edits from a natural-language command against a given set of real
// ledger entries. Never writes anything — the route only parses/matches; applying a confirmed
// edit is the caller's job, through the existing per-row save machinery.
export function useAiEditLedger() {
 const { language } = useLanguage();
 const { t } = useTranslation(language);

 async function proposeEdits(command: string, entries: AiLedgerEditEntry[]): Promise<ProposedLedgerEdit[] | null> {
  try {
   const response = await fetch('/api/ai/edit-ledger', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language, command, entries }),
   });
   const data = (await response.json().catch(() => null)) as { edits?: ProposedLedgerEdit[] } | null;
   if (!response.ok || !data) {
    await alertDialog({ title: t('ai_edit_ledger_title'), message: t('ai_edit_ledger_error'), tone: 'danger' });
    return null;
   }
   return data.edits ?? [];
  } catch {
   await alertDialog({ title: t('ai_edit_ledger_title'), message: t('ai_edit_ledger_error'), tone: 'danger' });
   return null;
  }
 }

 return { proposeEdits };
}
