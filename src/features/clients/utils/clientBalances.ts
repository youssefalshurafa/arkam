import { computeAccountBalances } from '@/shared/utils/accountBalances';
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
