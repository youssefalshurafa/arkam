'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { panelClassName, tableWrapClassName } from '@/shared/styles';
import type { ClientAccountLedger } from '@/shared/types';

/**
 * A lean, read-focused ledger table for a Treasury/Cashbox account — deliberately NOT
 * LedgerSection.tsx (drag-reorder/column customization/reconciliation UI is out of v1 scope
 * for this feature and risky to entangle with that ~3000-line component). Fed by
 * computeClientLedgers({ enabled: true }), so it shares the exact same running-balance math
 * as the real client ledger page.
 *
 * Sign note: computeClientLedgers/computeAccountBalances treat every account like a normal
 * client's receivable/payable ledger — a positive balance means "the business owes this
 * account," which is exactly right for a real client's own ledger (a client who hands over
 * cash is correctly credited there) but backwards for Treasury/Cashbox itself, which is a
 * CASH/asset position: it should read as a bigger positive number the more cash it's holding.
 * Since the stored math must stay untouched (the counterparty's own ledger depends on it),
 * the balance is negated here, at render time only, to show true cash-on-hand.
 */
export default function SystemAccountLedgerTable({ ledgers }: { ledgers: ClientAccountLedger[] }) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const numLocale = language === 'fr' ? 'en-US' : language;

 if (!ledgers.length) {
  return <div className={`${panelClassName} text-sm text-fg-faint`}>{t('treasury_empty_ledger')}</div>;
 }

 return (
  <div className="flex flex-col gap-6">
   {ledgers.map((ledger) => {
    const cashOnHand = -ledger.currentBalance;
    return (
    <div
     key={ledger.accountId}
     className={panelClassName}
    >
     <div className="flex items-center justify-between gap-3">
      <h3 className="text-sm font-semibold text-fg-muted">{ledger.currencyName} ({ledger.currencyCode})</h3>
      <span className={`text-lg font-bold ${cashOnHand > 0 ? 'text-good' : cashOnHand < 0 ? 'text-bad' : 'text-fg'}`}>
       {cashOnHand.toLocaleString(numLocale, { maximumFractionDigits: 2 })} {ledger.currencySymbol || ledger.currencyCode}
      </span>
     </div>
     <div className={tableWrapClassName}>
      <table className="w-full text-xs">
       <thead className="bg-surface-2 text-fg-faint">
        <tr>
         <th className="px-3 py-2 text-start font-medium">{t('treasury_entry_date')}</th>
         <th className="px-3 py-2 text-start font-medium">{t('treasury_entry_counterparty_client')}</th>
         <th className="px-3 py-2 text-start font-medium">{t('treasury_entry_description')}</th>
         <th className="px-3 py-2 text-end font-medium">{t('treasury_entry_amount')}</th>
         <th className="px-3 py-2 text-end font-medium">{t('balance')}</th>
        </tr>
       </thead>
       <tbody className="divide-y divide-border">
        {ledger.entries.length === 0 ? (
         <tr>
          <td
           colSpan={5}
           className="px-3 py-4 text-center text-fg-faint"
          >
           {t('treasury_empty_ledger')}
          </td>
         </tr>
        ) : (
         ledger.entries.map((entry) => (
          <tr key={`tx-${entry.transactionId}`}>
           <td className="px-3 py-2 whitespace-nowrap text-fg-muted">{entry.createdAt.slice(0, 10)}</td>
           <td className="px-3 py-2 whitespace-nowrap text-fg">{entry.counterpartyName || '-'}</td>
           <td className="px-3 py-2 text-fg-muted">{entry.description || '-'}</td>
           <td className={`px-3 py-2 text-end font-medium whitespace-nowrap ${entry.direction === 'incoming' ? 'text-good' : 'text-bad'}`}>
            {entry.pendingRate ? '—' : `${entry.direction === 'incoming' ? '+' : '-'}${entry.amount.toLocaleString(numLocale, { maximumFractionDigits: 2 })} ${entry.currencySymbol || entry.currencyCode}`}
           </td>
           <td className="px-3 py-2 text-end whitespace-nowrap text-fg">
            {(-entry.runningBalance).toLocaleString(numLocale, { maximumFractionDigits: 2 })}
           </td>
          </tr>
         ))
        )}
       </tbody>
      </table>
     </div>
    </div>
    );
   })}
  </div>
 );
}
