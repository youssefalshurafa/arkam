import { getCommissionAmount } from '@/shared/utils/commission';
import type { ClientAccount, ClientAdjustment, Transaction } from '@/shared/types';

export type ClientBalanceEntry = { currencyCode: string; currencySymbol: string; balance: number };

// Per-client, per-currency net balances for the clients list. Ported verbatim
// from the page's clientPageBalances memo; pure over its inputs.
export function computeClientPageBalances({ clientAccounts, transactions, adjustments, clientAccountMap }: {
 clientAccounts: ClientAccount[];
 transactions: Transaction[];
 adjustments: ClientAdjustment[];
 clientAccountMap: Map<number, ClientAccount>;
}): Map<number, ClientBalanceEntry[]> {
  const balanceByAccount = new Map<number, number>();
  for (const account of clientAccounts) {
   balanceByAccount.set(account.id, account.startingBalance ?? 0);
  }
  for (const transaction of transactions) {
   if (transaction.isArchived) continue;
   if (transaction.accountFromId != null && balanceByAccount.has(transaction.accountFromId)) {
    const account = clientAccountMap.get(transaction.accountFromId);
    if (account) {
     const pending = transaction.currencyId !== account.currencyId && transaction.exchangeRateFrom === 0;
     const netChange = pending
      ? 0
      : transaction.amount * transaction.exchangeRateFrom + getCommissionAmount(transaction.amount * transaction.exchangeRateFrom, transaction.commissionFrom);
     balanceByAccount.set(transaction.accountFromId, (balanceByAccount.get(transaction.accountFromId) ?? 0) + netChange);
    }
   }
   if (transaction.accountToId != null && balanceByAccount.has(transaction.accountToId)) {
    const account = clientAccountMap.get(transaction.accountToId);
    if (account) {
     const pending = transaction.currencyId !== account.currencyId && transaction.exchangeRateTo === 0;
     const netChange = pending
      ? 0
      : -(transaction.amount * transaction.exchangeRateTo - getCommissionAmount(transaction.amount * transaction.exchangeRateTo, transaction.commissionTo));
     balanceByAccount.set(transaction.accountToId, (balanceByAccount.get(transaction.accountToId) ?? 0) + netChange);
    }
   }
  }
  for (const adj of adjustments) {
   if (!balanceByAccount.has(adj.accountId)) continue;
   const account = clientAccountMap.get(adj.accountId);
   if (!account) continue;
   const pending = adj.currencyId != null && adj.currencyId !== account.currencyId && (adj.exchangeRate ?? 0) === 0;
   const netChange = pending ? 0 : (adj.direction === 'credit' ? 1 : -1) * adj.amount * (adj.exchangeRate || 1);
   balanceByAccount.set(adj.accountId, (balanceByAccount.get(adj.accountId) ?? 0) + netChange);
  }
  const result = new Map<number, { currencyCode: string; currencySymbol: string; balance: number }[]>();
  for (const account of clientAccounts) {
   const balance = balanceByAccount.get(account.id) ?? 0;
   const arr = result.get(account.clientId) ?? [];
   arr.push({ currencyCode: account.currencyCode, currencySymbol: account.currencySymbol, balance });
   result.set(account.clientId, arr);
  }
  return result;
}
