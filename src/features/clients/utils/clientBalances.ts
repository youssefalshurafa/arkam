import { computeAccountBalances, isPendingAdjustment, isPendingTransactionFrom, isPendingTransactionTo } from '@/shared/utils/accountBalances';
import { buildLockBoundaries, isAtOrBeforeBoundary } from '@/features/ledger/utils/reconciliation';
import type { ClientAccount, ClientAdjustment, Reconciliation, Transaction } from '@/shared/types';

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

// Client ids whose single most-recent ledger entry (across all their currency accounts) is
// reconciled — i.e. sits at or before that account's lock line. Reconciliation is per account,
// so "the client's last transaction is reconciled" means: find the newest entry the client has
// anywhere, and check whether it's locked in its own account. Drives the organization page's
// per-client "reconciled" mark. Entry ordering mirrors the ledger's (createdAt, then id).
export function computeClientReconciledStatus({ clientAccounts, transactions, adjustments, reconciliations }: {
 clientAccounts: ClientAccount[];
 transactions: Transaction[];
 adjustments: ClientAdjustment[];
 reconciliations: Reconciliation[];
}): Set<number> {
 const boundaries = buildLockBoundaries(reconciliations);
 const accountClientId = new Map(clientAccounts.map((account) => [account.id, account.clientId]));

 type EntryRef = { createdAt: string; refId: number };
 // Newest wins, breaking a same-timestamp tie by the higher id — matching computeClientLedgers'
 // sort so "last entry" here is the same row the ledger shows at the bottom.
 const isNewer = (candidate: EntryRef, current: EntryRef) => {
  const a = new Date(candidate.createdAt).getTime();
  const b = new Date(current.createdAt).getTime();
  return a !== b ? a > b : candidate.refId > current.refId;
 };
 const lastByAccount = new Map<number, EntryRef>();
 const consider = (accountId: number | null | undefined, entry: EntryRef) => {
  if (accountId == null || !accountClientId.has(accountId)) return;
  const current = lastByAccount.get(accountId);
  if (!current || isNewer(entry, current)) lastByAccount.set(accountId, entry);
 };

 for (const transaction of transactions) {
  if (transaction.isArchived) continue;
  consider(transaction.accountFromId, { createdAt: transaction.createdAt, refId: transaction.id });
  consider(transaction.accountToId, { createdAt: transaction.createdAt, refId: transaction.id });
 }
 for (const adj of adjustments) {
  consider(adj.accountId, { createdAt: adj.createdAt, refId: adj.id });
 }

 // Per client, pick the newest entry across their accounts and test it against that account's lock.
 const latestByClient = new Map<number, { accountId: number; entry: EntryRef }>();
 for (const [accountId, entry] of lastByAccount) {
  const clientId = accountClientId.get(accountId);
  if (clientId == null) continue;
  const current = latestByClient.get(clientId);
  if (!current || isNewer(entry, current.entry)) latestByClient.set(clientId, { accountId, entry });
 }

 const reconciledClients = new Set<number>();
 for (const [clientId, { accountId, entry }] of latestByClient) {
  if (isAtOrBeforeBoundary(entry.createdAt, entry.refId, boundaries.get(accountId) ?? null)) reconciledClients.add(clientId);
 }
 return reconciledClients;
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
