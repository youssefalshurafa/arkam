import { describe, expect, it } from 'vitest';
import { buildOptimisticTransactionRow, type TransactionCreateInput } from './optimisticRow';
import { nextCreatedAtForDate } from '@/shared/utils/createdAt';
import type { ClientAccount, Currency, Transaction } from '@/shared/types';

const account = (id: number, clientName: string, code: string, symbol: string) =>
 ({ id, clientId: id, clientName, currencyId: 1, currencyCode: code, currencySymbol: symbol }) as ClientAccount & { clientName: string };

const clientAccountMap = new Map([
 [1, account(1, 'Sender Co', 'USD', '$')],
 [2, account(2, 'Receiver Co', 'EUR', '€')],
]);
const currencyMap = new Map<number, Currency>([[7, { id: 7, code: 'USD', symbol: '$' } as Currency]]);

const input: TransactionCreateInput = {
 accountFromId: 1,
 accountToId: 2,
 currencyId: 7,
 amount: 1200,
 type: 'transfer',
 exchangeRateFrom: 1,
 commissionFrom: 0,
 exchangeRateTo: 0.9,
 commissionTo: 2,
 exchangeRateFromReversed: 0,
 // The one-sided modal sends booleans where the form sends 0/1; the column is numeric.
 exchangeRateToReversed: true,
 charges: 5,
 chargesCurrencyId: 7,
 chargesPayer: 'from',
 chargesExchangeRate: 1,
 chargesDescription: '  wire fee  ',
 description: '  September rent  ',
 distributionLocationId: 0,
 createdAt: '2026-09-15 10:00:00',
};

describe('buildOptimisticTransactionRow', () => {
 it('resolves the display fields the table and ledger read off the row', () => {
  const row = buildOptimisticTransactionRow(input, 999, clientAccountMap, currencyMap);
  expect(row).toMatchObject({
   id: 999,
   clientFromName: 'Sender Co',
   accountFromCurrencyCode: 'USD',
   clientToName: 'Receiver Co',
   accountToCurrencyCode: 'EUR',
   accountToCurrencySymbol: '€',
   currencyCode: 'USD',
   currencySymbol: '$',
   chargesCurrencyCode: 'USD',
  });
 });

 it('applies the same normalizations the server does, so nothing shifts at the refetch', () => {
  const row = buildOptimisticTransactionRow(input, 999, clientAccountMap, currencyMap);
  // Trimmed server-side; an untrimmed local value would read as an edit nobody made.
  expect(row.description).toBe('September rent');
  expect(row.chargesDescription).toBe('wire fee');
  // Booleans are stored numerically...
  expect(row.exchangeRateToReversed).toBe(1);
  expect(row.exchangeRateFromReversed).toBe(0);
  // ...and a falsy distribution location is null, not 0.
  expect(row.distributionLocationId).toBeNull();
 });

 it('fills the fields a partial payload omits rather than leaving them undefined', () => {
  const minimal: TransactionCreateInput = { ...input, charges2: undefined, chargesPayer2: undefined, charges2Description: undefined, counterParty: undefined };
  const row = buildOptimisticTransactionRow(minimal, 1, clientAccountMap, currencyMap);
  expect(row.charges2).toBe(0);
  expect(row.charges2ExchangeRate).toBe(1);
  expect(row.chargesPayer2).toBe('');
  expect(row.counterParty).toBe('');
  expect(row.archiveHidden).toBe(0);
 });

 it('marks an archive entry as archived', () => {
  expect(buildOptimisticTransactionRow({ ...input, isArchived: true }, 1, clientAccountMap, currencyMap).isArchived).toBe(1);
  expect(buildOptimisticTransactionRow(input, 1, clientAccountMap, currencyMap).isArchived).toBe(0);
 });

 it('leaves every Transaction field defined, so no consumer sees a hole', () => {
  const row = buildOptimisticTransactionRow(input, 1, clientAccountMap, currencyMap);
  for (const [key, value] of Object.entries(row)) {
   expect(value, `${key} should not be undefined`).not.toBeUndefined();
  }
 });
});

describe('nextCreatedAtForDate with a pending floor', () => {
 const existing = [{ createdAt: '2026-09-10 08:00:00' } as Transaction];

 // Emitted as a local wall-clock string (see localWallClock) — the 'Z' is part of that format
 // and does not mean UTC.
 it('places a past-dated entry after the last row of its day', () => {
  expect(nextCreatedAtForDate('2026-09-10', existing)).toBe('2026-09-10T08:00:01.000Z');
 });

 it('places it after a row saved a moment ago that this list does not hold yet', () => {
  // Without the floor, two quick entries against the same captured list share a timestamp.
  const floor = Date.parse('2026-09-10T08:00:01');
  expect(nextCreatedAtForDate('2026-09-10', existing, floor)).toBe('2026-09-10T08:00:02.000Z');
 });
});
