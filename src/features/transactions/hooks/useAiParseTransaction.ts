'use client';

import { alertDialog } from '@/components/ui/AppDialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import type { ClientAccount, Currency, TransactionForm } from '@/shared/types';

export type ParsedTransaction = {
 type: TransactionForm['type'] | null;
 accountFromId: number | null;
 accountToId: number | null;
 currencyId: number | null;
 amount: number | null;
 exchangeRateFrom: number | null;
 commissionFrom: number | null;
 exchangeRateTo: number | null;
 commissionTo: number | null;
 description: string | null;
 date: string | null;
 charges: number | null;
 chargesCurrencyId: number | null;
 chargesDescription: string | null;
 chargesPayer: TransactionForm['chargesPayer'] | null;
};

// Natural-language transaction entry: parses a typed sentence into a partial form payload.
// Never submits anything itself — the caller merges the result into the existing draft form
// so the user reviews/edits it through the same Save flow as manual entry.
export function useAiParseTransaction() {
 const { language } = useLanguage();
 const { t } = useTranslation(language);

 async function parseTransactionText(text: string, clientAccounts: ClientAccount[], currencies: Currency[], today: string): Promise<ParsedTransaction | null> {
  try {
   const response = await fetch('/api/ai/parse-transaction', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
     language,
     text,
     today,
     accounts: clientAccounts.map((a) => ({ id: a.id, label: `${a.clientName} · ${a.currencyCode}` })),
     currencies: currencies.map((c) => ({ id: c.id, code: c.code })),
    }),
   });
   const data = (await response.json().catch(() => null)) as { parsed?: ParsedTransaction } | null;
   if (!response.ok || !data?.parsed) {
    await alertDialog({ title: t('ai_parse_title'), message: t('ai_parse_error'), tone: 'danger' });
    return null;
   }
   return data.parsed;
  } catch {
   await alertDialog({ title: t('ai_parse_title'), message: t('ai_parse_error'), tone: 'danger' });
   return null;
  }
 }

 return { parseTransactionText };
}
