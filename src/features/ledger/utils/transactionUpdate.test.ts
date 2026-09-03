import { describe, expect, it } from 'vitest';
import { isSameTransactionUpdate, transactionUpdateSnapshot } from './transactionUpdate';
import type { Transaction, TransactionUpdateInput } from '@/shared/types';

const transaction = {
 id: 7,
 accountFromId: 11,
 accountToId: 12,
 currencyId: 1,
 amount: 12000,
 type: 'transfer',
 exchangeRateFrom: 1,
 commissionFrom: 0,
 exchangeRateTo: 1,
 commissionTo: 0,
 charges: 0,
 chargesCurrencyId: 1,
 chargesPayer: 'from',
 chargesExchangeRate: 1,
 chargesDescription: '',
 charges2: 0,
 charges2CurrencyId: 1,
 chargesPayer2: 'from',
 charges2ExchangeRate: 1,
 charges2Description: '',
 description: 'rent',
 counterParty: 'Ahmed',
 distributionLocationId: null,
 createdAt: '2026-08-12T10:00:00.000Z',
} as unknown as Transaction;

const snapshot = () => transactionUpdateSnapshot(transaction);

describe('isSameTransactionUpdate', () => {
 it('treats a round-trip of the stored row as unchanged', () => {
  expect(isSameTransactionUpdate(snapshot(), snapshot())).toBe(true);
 });

 // The case the whole optimisation rests on: a freshly built payload sets numeric flags the
 // database never stored, so they come back undefined on one side and 0 on the other.
 it('treats an unset numeric flag and 0 as the same value', () => {
  const next: TransactionUpdateInput = { ...snapshot(), exchangeRateFromReversed: 0, exchangeRateToReversed: 0 };
  const previous = { ...snapshot(), exchangeRateFromReversed: undefined, exchangeRateToReversed: undefined } as unknown as TransactionUpdateInput;
  expect(isSameTransactionUpdate(next, previous)).toBe(true);
 });

 it('treats a missing account id as the same whether null or undefined', () => {
  const next: TransactionUpdateInput = { ...snapshot(), accountToId: null };
  // Cast: the type says `number | null`, but a row read back from the database can carry the
  // field absent entirely, which is exactly the shape this has to tolerate.
  const previous = { ...snapshot(), accountToId: undefined } as unknown as TransactionUpdateInput;
  expect(isSameTransactionUpdate(next, previous)).toBe(true);
 });

 it('treats an absent optional string and an empty one as the same', () => {
  const next: TransactionUpdateInput = { ...snapshot(), chargesDescription: '' };
  const previous = { ...snapshot(), chargesDescription: undefined } as unknown as TransactionUpdateInput;
  expect(isSameTransactionUpdate(next, previous)).toBe(true);
 });

 it.each([
  ['amount', { amount: 12000.01 }],
  ['exchange rate', { exchangeRateFrom: 1.0001 }],
  ['commission', { commissionFrom: 5 }],
  ['a charge', { charges: 10 }],
  ['the description', { description: 'rent ' }],
  ['the counterparty', { counterParty: 'Ahmad' }],
  ['the date', { createdAt: '2026-08-13T10:00:00.000Z' }],
  ['the direction', { accountFromId: 12, accountToId: 11 }],
  ['a reversed-rate flag', { exchangeRateFromReversed: 1 }],
 ])('detects a change to %s', (_label, patch) => {
  expect(isSameTransactionUpdate({ ...snapshot(), ...patch }, snapshot())).toBe(false);
 });

 // Erring toward saving is the safe direction: a redundant write costs a round-trip, a missed
 // one silently discards the user's edit.
 it('reports a difference when one side carries a field the other lacks', () => {
  const next = { ...snapshot(), somethingNew: 'x' } as unknown as TransactionUpdateInput;
  expect(isSameTransactionUpdate(next, snapshot())).toBe(false);
 });
});
