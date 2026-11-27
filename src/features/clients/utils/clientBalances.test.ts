import { describe, expect, it } from 'vitest';
import { computeClientPendingPricingEntries } from './clientBalances';
import type { ClientAccount, Transaction } from '@/shared/types';

// One EUR → MAD client account; every transaction below lands on it unpriced (exchangeRateTo 0).
const account = { id: 10, clientId: 1, currencyId: 2, currencyCode: 'MAD' } as ClientAccount;

const pendingTx = (id: number, createdAt: string, extra: Partial<Transaction> = {}) => ({
 id,
 createdAt,
 accountFromId: null,
 accountToId: 10,
 currencyId: 1,
 currencyCode: 'EUR',
 currencySymbol: '€',
 amount: 100,
 exchangeRateFrom: 0,
 exchangeRateTo: 0,
 description: `tx${id}`,
 clientFromName: 'other',
 clientToName: 'me',
 isArchived: false,
 type: 'transfer',
 ledgerPosFrom: null,
 ledgerPosTo: null,
 ...extra,
}) as unknown as Transaction;

const order = (transactions: Transaction[]) =>
 (computeClientPendingPricingEntries({ clientAccounts: [account], transactions, ignored: new Set() }).get(1) ?? []).map((entry) => entry.transactionId);

describe('computeClientPendingPricingEntries ordering', () => {
 it('lists the oldest day first, whatever order the transactions arrive in', () => {
  // A row that was re-pending (its rate deleted) after newer rows were added keeps its date slot.
  expect(order([
   pendingTx(1, '2026-11-26 10:00:00'),
   pendingTx(2, '2026-11-26 09:00:00'),
   pendingTx(3, '2026-11-25 12:00:00'),
   pendingTx(4, '2026-11-24 18:00:00'),
  ])).toEqual([4, 3, 2, 1]);
 });

 it('orders rows within a day by their position in the client ledger', () => {
  expect(order([
   pendingTx(1, '2026-11-26 08:00:00'),
   pendingTx(2, '2026-11-26 09:00:00', { ledgerPosTo: 1 }),
  ])).toEqual([2, 1]);
 });

 it('compares by wall-clock day across mixed createdAt formats', () => {
  expect(order([
   pendingTx(1, '2026-11-26T01:00:00.000Z'),
   pendingTx(2, '2026-11-25 23:00:00'),
  ])).toEqual([2, 1]);
 });
});
