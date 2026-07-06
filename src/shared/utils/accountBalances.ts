import { getCommissionAmount } from './commission';
import type { ClientAccount, ClientAdjustment, Transaction } from '@/shared/types';

// Net balance (starting balance + every non-archived transaction + every adjustment)
// of each client account. Shared by every feature that needs a per-account balance:
// the clients list, the overview org/currency cards, and the organizations page.
export function computeAccountBalances({ clientAccounts, transactions, adjustments }: {
 clientAccounts: ClientAccount[];
 transactions: Transaction[];
 adjustments: ClientAdjustment[];
}): Map<number, number> {
 const clientAccountMap = new Map(clientAccounts.map((account) => [account.id, account]));
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

 return balanceByAccount;
}

// Balances at/under this magnitude (in the account's own currency) are treated as
// negligible/settled: hidden from the overview's per-client breakdown and eligible
// for the one-click small-balance write-off.
export const SMALL_BALANCE_THRESHOLD = 100;
