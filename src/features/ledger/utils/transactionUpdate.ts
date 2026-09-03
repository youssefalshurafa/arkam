import type { Transaction, TransactionUpdateInput } from '@/shared/types';

/**
 * A transaction's currently-persisted state in the same shape an edit produces
 * (`buildLedgerTransactionUpdate`), so a pending edit can be compared against — and undone back
 * to — exactly what is stored. Deliberately the update field set, not the full `Transaction`:
 * fields the server owns (ids of related rows, archive flags) are not part of what an edit writes.
 */
export function transactionUpdateSnapshot(transaction: Transaction): TransactionUpdateInput {
 return {
  id: transaction.id,
  accountFromId: transaction.accountFromId,
  accountToId: transaction.accountToId,
  currencyId: transaction.currencyId,
  amount: transaction.amount,
  type: transaction.type,
  exchangeRateFrom: transaction.exchangeRateFrom,
  commissionFrom: transaction.commissionFrom,
  exchangeRateTo: transaction.exchangeRateTo,
  commissionTo: transaction.commissionTo,
  exchangeRateFromReversed: transaction.exchangeRateFromReversed,
  exchangeRateToReversed: transaction.exchangeRateToReversed,
  exchangeActualAmount: transaction.exchangeActualAmount,
  charges: transaction.charges,
  chargesCurrencyId: transaction.chargesCurrencyId,
  chargesPayer: transaction.chargesPayer,
  chargesExchangeRate: transaction.chargesExchangeRate,
  chargesDescription: transaction.chargesDescription,
  charges2: transaction.charges2,
  charges2CurrencyId: transaction.charges2CurrencyId,
  chargesPayer2: transaction.chargesPayer2,
  charges2ExchangeRate: transaction.charges2ExchangeRate,
  charges2Description: transaction.charges2Description,
  description: transaction.description,
  counterParty: transaction.counterParty,
  distributionLocationId: transaction.distributionLocationId,
  createdAt: transaction.createdAt,
 };
}

/**
 * Whether an edit would write back exactly what is already stored — the signal that a save can be
 * skipped entirely and the row simply closed.
 *
 * Compared field by field rather than by stringifying: the two records are built in different key
 * orders, and the same value legitimately arrives in a different shape on each side. A flag the
 * database never set reads back as `undefined` on the stored transaction but as `0` on a freshly
 * built payload; an absent account id can be either `null` or `undefined`. Neither is a change.
 *
 * Keys are taken from both objects, so a field present on one side and missing from the other
 * reads as a difference. That errs toward performing the save, which is the safe direction — the
 * cost of a false "changed" is a redundant write, the cost of a false "unchanged" is a silently
 * dropped edit.
 */
export function isSameTransactionUpdate(next: TransactionUpdateInput, previous: TransactionUpdateInput): boolean {
 const fields = new Set([...Object.keys(next), ...Object.keys(previous)]) as Set<keyof TransactionUpdateInput>;
 for (const field of fields) {
  const a = next[field];
  const b = previous[field];
  if (typeof a === 'number' || typeof b === 'number') {
   // For every numeric field here — unset flags, absent charges, no commission — null, undefined
   // and 0 all mean the same thing, so they must not read as a change.
   if ((Number(a) || 0) !== (Number(b) || 0)) return false;
  } else if ((a ?? '') !== (b ?? '')) {
   return false;
  }
 }
 return true;
}
