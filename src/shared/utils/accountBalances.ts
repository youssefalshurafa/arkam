import { getCommissionAmount, chargeLedgerEffect } from './commission';
import type { ClientAccount, ClientAdjustment, Transaction } from '@/shared/types';

// chargesExchangeRate converts the charge's own currency into the *payer's* account
// currency — it's meaningless (and must not be applied) for a side whose account currency
// already matches the charge's currency, where the conversion is definitionally 1:1.
// Forcing rate=1 here guards against a stale/incorrect chargesExchangeRate left over from
// when the charge's currency or payer was last changed. Mirrors ledgerBalances.ts's
// effectiveChargeRate exactly — keep both in sync.
function effectiveChargeRate(chargesCurrencyId: number | null, accountCurrencyId: number, chargesExchangeRate: number): number {
 return chargesCurrencyId != null && chargesCurrencyId === accountCurrencyId ? 1 : chargesExchangeRate;
}

// A cross-currency side with no exchange rate entered yet — excluded from the balance
// (see computeAccountBalances below) until the user sets a rate. Exported so callers that
// need to *count* pending rows (rather than sum balances) share the exact same definition.
export function isPendingTransactionFrom(transaction: Transaction, accountCurrencyId: number): boolean {
 return transaction.currencyId !== accountCurrencyId && transaction.exchangeRateFrom === 0;
}

export function isPendingTransactionTo(transaction: Transaction, accountCurrencyId: number): boolean {
 return transaction.currencyId !== accountCurrencyId && transaction.exchangeRateTo === 0;
}

export function isPendingAdjustment(adjustment: ClientAdjustment, accountCurrencyId: number): boolean {
 return adjustment.currencyId != null && adjustment.currencyId !== accountCurrencyId && (adjustment.exchangeRate ?? 0) === 0;
}

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
    const pending = isPendingTransactionFrom(transaction, account.currencyId);
    const chargeRate = effectiveChargeRate(transaction.chargesCurrencyId, account.currencyId, transaction.chargesExchangeRate);
    const chargeEffect = transaction.charges > 0 ? chargeLedgerEffect(transaction.chargesPayer, 'from') * (transaction.charges * chargeRate) : 0;
    const netChange = pending
     ? 0
     : transaction.amount * transaction.exchangeRateFrom + getCommissionAmount(transaction.amount * transaction.exchangeRateFrom, transaction.commissionFrom) + chargeEffect;
    balanceByAccount.set(transaction.accountFromId, (balanceByAccount.get(transaction.accountFromId) ?? 0) + netChange);
   }
  }
  if (transaction.accountToId != null && balanceByAccount.has(transaction.accountToId)) {
   const account = clientAccountMap.get(transaction.accountToId);
   if (account) {
    const pending = isPendingTransactionTo(transaction, account.currencyId);
    const chargeRate = effectiveChargeRate(transaction.chargesCurrencyId, account.currencyId, transaction.chargesExchangeRate);
    const chargeEffect = transaction.charges > 0 ? chargeLedgerEffect(transaction.chargesPayer, 'to') * (transaction.charges * chargeRate) : 0;
    const netChange = pending
     ? 0
     : -(transaction.amount * transaction.exchangeRateTo - getCommissionAmount(transaction.amount * transaction.exchangeRateTo, transaction.commissionTo)) + chargeEffect;
    balanceByAccount.set(transaction.accountToId, (balanceByAccount.get(transaction.accountToId) ?? 0) + netChange);
   }
  }
 }

 for (const adj of adjustments) {
  if (!balanceByAccount.has(adj.accountId)) continue;
  const account = clientAccountMap.get(adj.accountId);
  if (!account) continue;
  const pending = isPendingAdjustment(adj, account.currencyId);
  const netChange = pending ? 0 : (adj.direction === 'credit' ? 1 : -1) * adj.amount * (adj.exchangeRate || 1);
  balanceByAccount.set(adj.accountId, (balanceByAccount.get(adj.accountId) ?? 0) + netChange);
 }

 return balanceByAccount;
}

// Balances at/under this magnitude (in the account's own currency) are treated as
// negligible/settled: hidden from the overview's per-client breakdown and eligible
// for the one-click small-balance write-off.
export const SMALL_BALANCE_THRESHOLD = 100;
