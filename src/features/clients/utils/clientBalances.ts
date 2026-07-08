import { computeAccountBalances, isPendingAdjustment, isPendingTransactionFrom, isPendingTransactionTo } from '@/shared/utils/accountBalances';
import type { ClientAccount, ClientAdjustment, Transaction } from '@/shared/types';

export type ClientBalanceEntry = { accountId: number; currencyCode: string; currencySymbol: string; balance: number };

// Per-client, per-currency net balances for the clients list. Ported verbatim
// from the page's clientPageBalances memo; pure over its inputs.
export function computeClientPageBalances({ clientAccounts, transactions, adjustments }: {
 clientAccounts: ClientAccount[];
 transactions: Transaction[];
 adjustments: ClientAdjustment[];
}): Map<number, ClientBalanceEntry[]> {
 const balanceByAccount = computeAccountBalances({ clientAccounts, transactions, adjustments });
 const result = new Map<number, ClientBalanceEntry[]>();
 for (const account of clientAccounts) {
  const balance = balanceByAccount.get(account.id) ?? 0;
  const arr = result.get(account.clientId) ?? [];
  arr.push({ accountId: account.id, currencyCode: account.currencyCode, currencySymbol: account.currencySymbol, balance });
  result.set(account.clientId, arr);
 }
 return result;
}

// Per-client count of transactions/adjustments still "waiting for pricing" — a cross-currency
// row with no exchange rate entered yet, excluded from the balance above until the user sets
// one. Used by the organization page's client list to surface rows a client's balance doesn't
// yet reflect.
export function computeClientPendingPricingCounts({ clientAccounts, transactions, adjustments }: {
 clientAccounts: ClientAccount[];
 transactions: Transaction[];
 adjustments: ClientAdjustment[];
}): Map<number, number> {
 const accountMap = new Map(clientAccounts.map((account) => [account.id, account]));
 const countByClient = new Map<number, number>();
 const bump = (clientId: number) => countByClient.set(clientId, (countByClient.get(clientId) ?? 0) + 1);

 for (const transaction of transactions) {
  if (transaction.isArchived) continue;
  const fromAccount = transaction.accountFromId != null ? accountMap.get(transaction.accountFromId) : undefined;
  if (fromAccount && isPendingTransactionFrom(transaction, fromAccount.currencyId)) bump(fromAccount.clientId);
  const toAccount = transaction.accountToId != null ? accountMap.get(transaction.accountToId) : undefined;
  if (toAccount && isPendingTransactionTo(transaction, toAccount.currencyId)) bump(toAccount.clientId);
 }

 for (const adj of adjustments) {
  const account = accountMap.get(adj.accountId);
  if (account && isPendingAdjustment(adj, account.currencyId)) bump(account.clientId);
 }

 return countByClient;
}
