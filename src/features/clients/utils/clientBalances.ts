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

// One "waiting for pricing" row surfaced for the organization page's popup: enough
// detail (date, the other party, amount, description) to identify which transaction
// still needs an exchange rate, mirroring the pending list inside the client ledger.
export type PendingPricingEntry = {
 key: string;
 createdAt: string;
 counterpartyName: string;
 amount: number;
 currencyCode: string;
 currencySymbol: string;
 description: string;
 // Identity + target-currency detail so the org-page popup can price the row in place:
 // which record and side still needs a rate, and the account currency the amount converts
 // into (the rate means "1 <currencyCode> = rate <accountCurrencyCode>").
 kind: 'transaction' | 'adjustment';
 transactionId?: number;
 adjustmentId?: number;
 side?: 'from' | 'to';
 accountCurrencyCode: string;
};

// Like computeClientPendingPricingCounts, but returns the actual pending rows per client
// (newest first) so the org page can list them in a popup rather than just count them.
export function computeClientPendingPricingEntries({ clientAccounts, transactions, adjustments }: {
 clientAccounts: ClientAccount[];
 transactions: Transaction[];
 adjustments: ClientAdjustment[];
}): Map<number, PendingPricingEntry[]> {
 const accountMap = new Map(clientAccounts.map((account) => [account.id, account]));
 const byClient = new Map<number, PendingPricingEntry[]>();
 const push = (clientId: number, entry: PendingPricingEntry) => {
  const arr = byClient.get(clientId) ?? [];
  arr.push(entry);
  byClient.set(clientId, arr);
 };

 for (const transaction of transactions) {
  if (transaction.isArchived) continue;
  const fromAccount = transaction.accountFromId != null ? accountMap.get(transaction.accountFromId) : undefined;
  if (fromAccount && isPendingTransactionFrom(transaction, fromAccount.currencyId)) {
   push(fromAccount.clientId, {
    key: `t${transaction.id}-from`,
    createdAt: transaction.createdAt,
    counterpartyName: transaction.clientToName,
    amount: transaction.amount,
    currencyCode: transaction.currencyCode,
    currencySymbol: transaction.currencySymbol,
    description: transaction.description,
    kind: 'transaction',
    transactionId: transaction.id,
    side: 'from',
    accountCurrencyCode: fromAccount.currencyCode,
   });
  }
  const toAccount = transaction.accountToId != null ? accountMap.get(transaction.accountToId) : undefined;
  if (toAccount && isPendingTransactionTo(transaction, toAccount.currencyId)) {
   push(toAccount.clientId, {
    key: `t${transaction.id}-to`,
    createdAt: transaction.createdAt,
    counterpartyName: transaction.clientFromName,
    amount: transaction.amount,
    currencyCode: transaction.currencyCode,
    currencySymbol: transaction.currencySymbol,
    description: transaction.description,
    kind: 'transaction',
    transactionId: transaction.id,
    side: 'to',
    accountCurrencyCode: toAccount.currencyCode,
   });
  }
 }

 for (const adj of adjustments) {
  const account = accountMap.get(adj.accountId);
  if (account && isPendingAdjustment(adj, account.currencyId)) {
   push(account.clientId, {
    key: `a${adj.id}`,
    createdAt: adj.createdAt,
    counterpartyName: '',
    amount: adj.amount,
    currencyCode: adj.currencyCode,
    currencySymbol: adj.currencySymbol,
    description: adj.description,
    kind: 'adjustment',
    adjustmentId: adj.id,
    accountCurrencyCode: account.currencyCode,
   });
  }
 }

 // Newest first, to match the ledger's ordering intuition.
 for (const arr of byClient.values()) {
  arr.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
 }
 return byClient;
}
