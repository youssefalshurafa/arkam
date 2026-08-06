'use client';

import type { FormEvent } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useLedgerStore } from '@/features/ledger/store/ledgerStore';
import NewTransactionForm from '@/features/transactions/components/NewTransactionForm';
import type { Client, ClientAccount, ClientAccountLedger, Currency, Transaction } from '@/shared/types';

type NewTransactionModalProps = {
 selectedClientLedgers: ClientAccountLedger[];
 selectedClientForLedger: Client | null;
 clientAccounts: ClientAccount[];
 clientAccountMap: Map<number, ClientAccount>;
 enabledCurrencies: Currency[];
 currencyMap: Map<number, Currency>;
 transactions: Transaction[];
 lockPastEditsEnabled: boolean;
 onTransactionSubmit: (event: FormEvent<HTMLFormElement>) => void;
 closeNewTransactionModal: () => void;
};

// The full two-sided create-transaction form (NewTransactionForm — the same component the
// Transactions page renders inline), reachable from a client ledger's "+" menu so a normal
// exchange/transfer doesn't require leaving the ledger. Unlike OneSidedTransactionModal, this
// doesn't keep its own copy of the form data: NewTransactionForm reads/writes
// useTransactionsStore directly, and openNewTransactionModal (useLedgerActions.ts) seeds that
// shared draft with this account pre-picked before opening. Stays open after a successful
// submit — same "add several in a row" behavior as the Transactions page's inline form — closed
// only via the × button.
export default function NewTransactionModal({
 selectedClientLedgers,
 selectedClientForLedger,
 clientAccounts,
 clientAccountMap,
 enabledCurrencies,
 currencyMap,
 transactions,
 lockPastEditsEnabled,
 onTransactionSubmit,
 closeNewTransactionModal,
}: NewTransactionModalProps) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const accountId = useLedgerStore((s) => s.newTransactionModalAccountId);

 if (accountId == null) return null;

 const ledger = selectedClientLedgers.find((l) => l.accountId === accountId);
 const clientName = selectedClientForLedger?.name ?? '';

 return (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
   <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded bg-surface p-6 shadow-2xl">
    <div className="flex items-start justify-between gap-3">
     <div>
      <h3 className="text-lg font-semibold text-fg">{t('new_transaction')}</h3>
      {ledger ? (
       <p className="mt-1 text-xs text-fg-faint">
        {clientName} &mdash; {ledger.currencyName}
       </p>
      ) : null}
     </div>
     <button
      type="button"
      onClick={closeNewTransactionModal}
      title={t('cancel')}
      aria-label={t('cancel')}
      className="shrink-0 rounded p-1 text-fg-faint hover:bg-surface-hover hover:text-fg"
     >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
       <path d="M18 6 6 18M6 6l12 12" />
      </svg>
     </button>
    </div>

    <NewTransactionForm
     clientAccounts={clientAccounts}
     clientAccountMap={clientAccountMap}
     enabledCurrencies={enabledCurrencies}
     currencyMap={currencyMap}
     transactions={transactions}
     section="client-ledger"
     lockPastEditsEnabled={lockPastEditsEnabled}
     onTransactionSubmit={onTransactionSubmit}
    />
   </div>
  </div>
 );
}
