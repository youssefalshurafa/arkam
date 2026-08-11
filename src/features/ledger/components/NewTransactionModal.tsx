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
 onTransactionSubmit: (event: FormEvent<HTMLFormElement>, onCreated?: () => void) => void;
 closeNewTransactionModal: () => void;
 // Same clipboard slot + fill logic as the Transactions page's copy/paste (see
 // onCopyTransactionRow/onPasteCopiedTransaction in useTransactionActions.ts) — copying happens
 // on a ledger row (LedgerSection.tsx), pasting happens here since this modal hosts the same
 // shared NewTransactionForm the Transactions page fills.
 copiedTransaction: Transaction | null;
 onPasteCopiedTransaction: () => void;
};

// The full two-sided create-transaction form (NewTransactionForm — the same component the
// Transactions page renders inline), reachable from a client ledger's "+" menu so a normal
// exchange/transfer doesn't require leaving the ledger. Unlike OneSidedTransactionModal, this
// doesn't keep its own copy of the form data: NewTransactionForm reads/writes
// useTransactionsStore directly, and openNewTransactionModal (useLedgerActions.ts) seeds that
// shared draft with this account pre-picked before opening. Offers two submit buttons (via
// `onSaveAndClose`): one keeps the modal open for another entry (same "add several in a row"
// behavior as the Transactions page's inline form), the other closes it — plus the × button.
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
 copiedTransaction,
 onPasteCopiedTransaction,
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
     <div className="flex shrink-0 items-center gap-2">
      {copiedTransaction ? (
       <button
        type="button"
        onClick={onPasteCopiedTransaction}
        title={t('paste_transaction')}
        aria-label={t('paste_transaction')}
        className="inline-flex shrink-0 items-center gap-1.5 rounded border border-blue-200 bg-accent-weak px-2.5 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent-weak"
       >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
         <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
         <rect
          x="9"
          y="3"
          width="6"
          height="4"
          rx="1"
         />
        </svg>
        {t('paste_transaction')}
       </button>
      ) : null}
      <button
       type="button"
       onClick={closeNewTransactionModal}
       title={t('cancel')}
       aria-label={t('cancel')}
       className="rounded p-1 text-fg-faint hover:bg-surface-hover hover:text-fg"
      >
       <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M18 6 6 18M6 6l12 12" />
       </svg>
      </button>
     </div>
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
     onSaveAndClose={closeNewTransactionModal}
    />
   </div>
  </div>
 );
}
