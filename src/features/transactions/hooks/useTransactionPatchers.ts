'use client';

import type { Dispatch, SetStateAction } from 'react';
import { useWorkspaceActions } from '@/features/workspace/hooks/useWorkspaceActions';
import type { ClientAccount, Currency, Transaction, TransactionUpdateInput } from '@/shared/types';

type UseTransactionPatchersParams = {
 clientAccountMap: Map<number, ClientAccount & { clientName?: string }>;
 currencyMap: Map<number, Currency>;
};

/**
 * Optimistic local-cache patcher shared by the ledger and transactions-table edit
 * flows — both edit the same underlying transaction records from different views,
 * so both need to re-resolve the derived display fields (client names, currency
 * code/symbol) the same way after a save.
 *
 * This is what the user actually looks at after a save: the ledger no longer waits for
 * the write to land, and the reconciling refetch is deferred and coalesced (see
 * scheduleWorkspaceResync in useLedgerActions). So the patch has to land the row exactly
 * where the server will, normalizations included — anything it gets wrong is visible until
 * that later refetch, and reads as the save having changed something the user didn't type.
 * The normalizations below mirror db.js's `updateTransaction` statement one for one.
 */
export function useTransactionPatchers({ clientAccountMap, currencyMap }: UseTransactionPatchersParams) {
 const { setters } = useWorkspaceActions();
 const setTransactions = setters.setTransactions as Dispatch<SetStateAction<Transaction[]>>;

 // The server trims every free-text column on write; a locally-kept untrimmed value would
 // otherwise sit in the cache looking like an edit nobody made.
 const trimmed = (value: string | null | undefined) => (value == null ? value : value.trim());

 function applyTransactionPatch(input: TransactionUpdateInput) {
  const fromAccount = input.accountFromId != null ? clientAccountMap.get(input.accountFromId) : undefined;
  const toAccount = input.accountToId != null ? clientAccountMap.get(input.accountToId) : undefined;
  const currency = currencyMap.get(input.currencyId);
  const chargesCurrency = input.chargesCurrencyId != null ? currencyMap.get(input.chargesCurrencyId) : null;
  const charges2Currency = input.charges2CurrencyId != null ? currencyMap.get(input.charges2CurrencyId) : null;
  setTransactions((prev) =>
   prev.map((tx) =>
    tx.id === input.id
     ? {
        ...tx,
        accountFromId: input.accountFromId,
        accountToId: input.accountToId,
        clientFromName: fromAccount?.clientName ?? tx.clientFromName,
        accountFromCurrencyCode: fromAccount?.currencyCode ?? tx.accountFromCurrencyCode,
        accountFromCurrencySymbol: fromAccount?.currencySymbol ?? tx.accountFromCurrencySymbol,
        clientToName: toAccount?.clientName ?? tx.clientToName,
        accountToCurrencyCode: toAccount?.currencyCode ?? tx.accountToCurrencyCode,
        accountToCurrencySymbol: toAccount?.currencySymbol ?? tx.accountToCurrencySymbol,
        currencyId: input.currencyId,
        currencyCode: currency?.code ?? tx.currencyCode,
        currencySymbol: currency?.symbol ?? tx.currencySymbol,
        amount: input.amount ?? 0,
        type: input.type,
        exchangeRateFrom: input.exchangeRateFrom ?? 1,
        commissionFrom: input.commissionFrom ?? 0,
        exchangeRateTo: input.exchangeRateTo ?? 1,
        commissionTo: input.commissionTo ?? 0,
        exchangeRateFromReversed: input.exchangeRateFromReversed ?? tx.exchangeRateFromReversed,
        exchangeRateToReversed: input.exchangeRateToReversed ?? tx.exchangeRateToReversed,
        charges: input.charges ?? 0,
        chargesCurrencyId: input.chargesCurrencyId,
        chargesCurrencyCode: chargesCurrency?.code ?? null,
        chargesCurrencySymbol: chargesCurrency?.symbol ?? null,
        chargesPayer: input.chargesPayer ?? '',
        chargesExchangeRate: input.chargesExchangeRate ?? 1,
        chargesDescription: trimmed(input.chargesDescription) ?? '',
        charges2: input.charges2 ?? 0,
        charges2CurrencyId: input.charges2CurrencyId,
        charges2CurrencyCode: charges2Currency?.code ?? null,
        charges2CurrencySymbol: charges2Currency?.symbol ?? null,
        chargesPayer2: input.chargesPayer2,
        charges2ExchangeRate: input.charges2ExchangeRate ?? 1,
        charges2Description: trimmed(input.charges2Description) ?? '',
        description: trimmed(input.description) ?? '',
        archiveNote: trimmed(input.archiveNote) ?? tx.archiveNote,
        counterParty: trimmed(input.counterParty) ?? tx.counterParty,
        // Both are COALESCE'd server-side: a caller that omits them keeps whatever is stored,
        // so an omission here must keep the local value rather than blanking it.
        exchangeActualAmount: input.exchangeActualAmount ?? tx.exchangeActualAmount,
        distributionLocationId: input.distributionLocationId || null,
        createdAt: input.createdAt,
       }
     : tx,
   ),
  );
 }

 return { applyTransactionPatch };
}
