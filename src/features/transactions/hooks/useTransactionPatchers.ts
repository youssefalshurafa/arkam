'use client';

import type { Dispatch, SetStateAction } from 'react';
import { useWorkspaceActions } from '@/features/workspace/hooks/useWorkspaceActions';
import type { ClientAccount, ClientAdjustment, Currency, Transaction, TransactionUpdateInput } from '@/shared/types';

type UseTransactionPatchersParams = {
 clientAccountMap: Map<number, ClientAccount & { clientName?: string }>;
 currencyMap: Map<number, Currency>;
};

/**
 * Optimistic local-cache patchers shared by the ledger and transactions-table
 * edit flows — both edit the same underlying transaction/adjustment records
 * from different views, so both need to re-resolve the derived display
 * fields (client names, currency code/symbol) the same way after a save. A
 * background loadData() call afterward reconciles with the server.
 */
export function useTransactionPatchers({ clientAccountMap, currencyMap }: UseTransactionPatchersParams) {
 const { setters } = useWorkspaceActions();
 const setTransactions = setters.setTransactions as Dispatch<SetStateAction<Transaction[]>>;
 const setAdjustments = setters.setAdjustments as Dispatch<SetStateAction<ClientAdjustment[]>>;

 function applyTransactionPatch(input: TransactionUpdateInput) {
  const fromAccount = input.accountFromId != null ? clientAccountMap.get(input.accountFromId) : undefined;
  const toAccount = input.accountToId != null ? clientAccountMap.get(input.accountToId) : undefined;
  const currency = currencyMap.get(input.currencyId);
  const chargesCurrency = input.chargesCurrencyId != null ? currencyMap.get(input.chargesCurrencyId) : null;
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
        amount: input.amount,
        type: input.type,
        exchangeRateFrom: input.exchangeRateFrom,
        commissionFrom: input.commissionFrom,
        exchangeRateTo: input.exchangeRateTo,
        commissionTo: input.commissionTo,
        exchangeRateFromReversed: input.exchangeRateFromReversed ?? tx.exchangeRateFromReversed,
        exchangeRateToReversed: input.exchangeRateToReversed ?? tx.exchangeRateToReversed,
        charges: input.charges,
        chargesCurrencyId: input.chargesCurrencyId,
        chargesCurrencyCode: chargesCurrency?.code ?? null,
        chargesCurrencySymbol: chargesCurrency?.symbol ?? null,
        chargesPayer: input.chargesPayer,
        chargesExchangeRate: input.chargesExchangeRate,
        chargesDescription: input.chargesDescription,
        description: input.description,
        archiveNote: input.archiveNote ?? tx.archiveNote,
        createdAt: input.createdAt,
       }
     : tx,
   ),
  );
 }

 function applyAdjustmentPatch(input: ClientAdjustment) {
  setAdjustments((prev) => prev.map((adjustment) => (adjustment.id === input.id ? { ...adjustment, ...input } : adjustment)));
 }

 return { applyTransactionPatch, applyAdjustmentPatch };
}
