import { getCommissionAmount, chargeLedgerEffect, exchangeToBase } from './commission';
import type { ClientAccount, Transaction } from '@/shared/types';

// A cross-currency side with no exchange rate entered yet — excluded from the balance
// (see computeAccountBalances below) until the user sets a rate. Exported so callers that
// need to *count* pending rows (rather than sum balances) share the exact same definition.
export function isPendingTransactionFrom(transaction: Transaction, accountCurrencyId: number): boolean {
 return transaction.currencyId !== accountCurrencyId && transaction.exchangeRateFrom === 0;
}

export function isPendingTransactionTo(transaction: Transaction, accountCurrencyId: number): boolean {
 // An exchange with a recorded actual (الفعلي) destination amount is never pending — we hold a
 // concrete destination-currency figure regardless of whether the rate was left unpriced.
 if (transaction.type === 'exchange' && transaction.exchangeActualAmount != null) return false;
 return transaction.currencyId !== accountCurrencyId && transaction.exchangeRateTo === 0;
}

// Net balance (starting balance + every non-archived transaction) of each client account.
// Shared by every feature that needs a per-account balance: the clients list, the overview
// org/currency cards, and the organizations page.
export function computeAccountBalances({ clientAccounts, transactions }: {
 clientAccounts: ClientAccount[];
 transactions: Transaction[];
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
    // The charge is always entered in the transaction's own currency, so it converts into this
    // side's account currency via the same rate that converts `amount` (see ledgerBalances.ts's
    // computeTransactionSideNetChange for the canonical version of this formula).
    const chargeEffect = transaction.charges > 0 ? chargeLedgerEffect(transaction.chargesPayer, 'from') * (transaction.charges * transaction.exchangeRateFrom) : 0;
    const chargeEffect2 = transaction.charges2 > 0 ? chargeLedgerEffect(transaction.chargesPayer2, 'from') * (transaction.charges2 * transaction.exchangeRateFrom) : 0;
    const netChange = pending
     ? 0
     : transaction.amount * transaction.exchangeRateFrom + getCommissionAmount(transaction.amount * transaction.exchangeRateFrom, transaction.commissionFrom) + chargeEffect + chargeEffect2;
    balanceByAccount.set(transaction.accountFromId, (balanceByAccount.get(transaction.accountFromId) ?? 0) + netChange);
   }
  }
  if (transaction.accountToId != null && balanceByAccount.has(transaction.accountToId)) {
   const account = clientAccountMap.get(transaction.accountToId);
   if (account) {
    const pending = isPendingTransactionTo(transaction, account.currencyId);
    const chargeEffect = transaction.charges > 0 ? chargeLedgerEffect(transaction.chargesPayer, 'to') * (transaction.charges * transaction.exchangeRateTo) : 0;
    const chargeEffect2 = transaction.charges2 > 0 ? chargeLedgerEffect(transaction.chargesPayer2, 'to') * (transaction.charges2 * transaction.exchangeRateTo) : 0;
    const toBase = exchangeToBase(transaction);
    const netChange = pending
     ? 0
     : -(toBase - getCommissionAmount(toBase, transaction.commissionTo)) + chargeEffect + chargeEffect2;
    balanceByAccount.set(transaction.accountToId, (balanceByAccount.get(transaction.accountToId) ?? 0) + netChange);
   }
  }
 }

 return balanceByAccount;
}

// Balances at/under this magnitude (in the account's own currency) are treated as
// negligible/settled: hidden from the overview's per-client breakdown and eligible
// for the one-click small-balance write-off — the default for any currency with no
// explicit margin configured in Settings > Write-off.
export const SMALL_BALANCE_THRESHOLD = 100;

// A currency's write-off margin, falling back to SMALL_BALANCE_THRESHOLD when the
// workspace hasn't configured one for that currency.
export function resolveWriteOffThreshold(currencyId: number, marginByCurrency: Map<number, number>): number {
 return marginByCurrency.get(currencyId) ?? SMALL_BALANCE_THRESHOLD;
}

export function writeOffMarginMap(margins: Array<{ currencyId: number; threshold: number }>): Map<number, number> {
 return new Map(margins.map((margin) => [margin.currencyId, margin.threshold]));
}
