'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { panelClassName } from '@/shared/styles';
import type { TreasuryBalanceEntry } from '@/shared/types';

/**
 * A compact, read-only "Treasury balance" card shown above a Cashbox's own ledger (see
 * TreasurySection.tsx) — deliberately balance-only (fed by getTreasuryBalance, not
 * useSystemClients), so it's safe to show to every role including a `member`, who can't see
 * Treasury's own ledger/entries at all.
 */
export default function TreasuryBalanceSummary({ balances }: { balances: TreasuryBalanceEntry[] }) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const numLocale = language === 'fr' ? 'en-US' : language;

 if (!balances.length) return null;

 return (
  <div className={panelClassName}>
   <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('treasury_balance_summary_title')}</h3>
   <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
    {balances.map((entry) => (
     <div key={entry.currencyCode} className="flex items-baseline gap-2">
      <span className="text-xs text-fg-muted">{entry.currencyName} ({entry.currencyCode})</span>
      <span className={`text-base font-bold ${entry.balance > 0 ? 'text-good' : entry.balance < 0 ? 'text-bad' : 'text-fg'}`}>
       {entry.balance.toLocaleString(numLocale, { maximumFractionDigits: 2 })} {entry.currencySymbol || entry.currencyCode}
      </span>
     </div>
    ))}
   </div>
  </div>
 );
}
