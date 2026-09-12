import { describe, expect, it } from 'vitest';
import { computeClientLedgers } from './ledgerBalances';
import type { Client, ClientAccount, Currency, Reconciliation, Transaction } from '@/shared/types';

// Two rows on one day in one account — the shape of a ledger the user drags rows around in.
const DAY = '2026-09-11';
const FIRST = 300;
const SECOND = 500;

function account(): ClientAccount {
 return { id: 1, clientId: 1, clientName: 'Client', currencyId: 1, currencyCode: 'EUR', currencySymbol: '€',
  startingBalance: 0, note: '', noteShowInPdf: false, isSystem: false, systemKind: null, ownerUserId: null,
  isDormant: false, createdAt: '2026-01-01T00:00:00.000Z' };
}

// Outgoing rows on account 1, so each one moves the running balance by -amount.
function tx(id: number, createdAt: string, amount: number): Transaction {
 return {
  id, accountFromId: 1, clientFromName: 'Client', accountFromCurrencyCode: 'EUR', accountFromCurrencySymbol: '€',
  accountToId: 2, clientToName: 'Other', accountToCurrencyCode: 'EUR', accountToCurrencySymbol: '€',
  currencyId: 1, currencyCode: 'EUR', currencySymbol: '€', amount, type: 'transfer',
  exchangeRateFrom: 1, commissionFrom: 0, exchangeRateTo: 1, commissionTo: 0,
  exchangeRateFromReversed: false, exchangeRateToReversed: false,
  charges: 0, chargesCurrencyId: null, chargesPayer: '', chargesExchangeRate: 1, chargesDescription: '',
  charges2: 0, charges2CurrencyId: null, chargesPayer2: '', charges2ExchangeRate: 1, charges2Description: '',
  description: '', counterParty: '', archiveNote: '', isArchived: false, createdAt,
 } as unknown as Transaction;
}

const rows = [tx(FIRST, `${DAY}T10:00:00.000Z`, 300000), tx(SECOND, `${DAY}T11:00:00.000Z`, 500000)];

function ledger(transactions: Transaction[], reconciliations: Reconciliation[]) {
 const accounts = [account()];
 const currencies = [{ id: 1, code: 'EUR', name: 'Euro', symbol: '€' } as Currency];
 return computeClientLedgers({
  selectedClientForLedger: { id: 1, name: 'Client' } as Client,
  section: 'client-ledger',
  pdfExportModal: null,
  clientAccounts: accounts,
  transactions,
  reconciliations,
  clientAccountMap: new Map(accounts.map((a) => [a.id, a])),
  currencyMap: new Map(currencies.map((c) => [c.id, c])),
 } as never)[0];
}

// onLedgerRowDrop's same-day reflow: spread the day's rows over evenly spaced timestamps in
// the requested order, which is what makes a drag durable.
function applyReflow(transactions: Transaction[], order: number[]): Transaction[] {
 const dayStart = Date.parse(`${DAY}T00:00:00.000Z`);
 const dayEnd = Date.parse(`${DAY}T23:59:59.999Z`);
 const times = new Map<number, string>();
 order.forEach((id, index) => {
  times.set(id, new Date(dayStart + ((dayEnd - dayStart) * (index + 1)) / (order.length + 1)).toISOString());
 });
 return transactions.map((t) => ({ ...t, createdAt: times.get(t.id) ?? t.createdAt }));
}

function reconciliation(anchorDate: string, lockedTransactionIds: number[]): Reconciliation {
 return { id: 1, accountId: 1, anchorTransactionId: lockedTransactionIds[0], anchorDate, balance: 300000, note: '',
  lockedTransactionIds, createdAt: `${anchorDate}T12:00:00.000Z` } as Reconciliation;
}

// What onLedgerRowDrop compares to decide whether to warn: each ✓'s running balance before
// and after the move.
function markBalances(entries: ReturnType<typeof ledger>['entries']) {
 const out = new Map<number, number>();
 for (const entry of entries) if (entry.reconciledMark) out.set(entry.reconciledMark.id, entry.runningBalance);
 return out;
}

describe('same-day ledger reorder', () => {
 it('sticks when nothing is reconciled', () => {
  expect(ledger(rows, []).entries.map((e) => e.transactionId)).toEqual([FIRST, SECOND]);
  expect(ledger(applyReflow(rows, [SECOND, FIRST]), []).entries.map((e) => e.transactionId)).toEqual([SECOND, FIRST]);
 });

 it('sticks, and is silent, when both rows sit on the same side of the ✓', () => {
  // Anchored on an earlier day: neither row is a member, so the move changes no agreed number.
  const recs = [reconciliation('2026-09-01', [9])];
  const after = ledger(applyReflow(rows, [SECOND, FIRST]), recs);
  expect(after.entries.map((e) => e.transactionId)).toEqual([SECOND, FIRST]);
  expect(markBalances(after.entries)).toEqual(markBalances(ledger(rows, recs).entries));
 });

 it('reorders across a ✓ line once that ✓ is re-pointed, and reports the balance change', () => {
  // The ✓ sits ON the first row: 300,000 is the agreed balance and the 500,000 row is not a
  // member. onLedgerRowDrop lifts the 500,000 row above it by reflowing the timestamps AND
  // re-pointing the reconciliation at what now stands above its line — the balance it warns
  // about, from 300,000 to 800,000.
  const recs = [reconciliation(DAY, [FIRST])];
  const before = ledger(rows, recs);
  expect(before.entries.map((e) => e.transactionId)).toEqual([FIRST, SECOND]);
  expect(markBalances(before.entries).get(1)).toBe(300000);

  // Timestamps alone can't carry the row across: the depth ordering holds it below, which is
  // what keeps a stray-timestamp row from drifting above a ✓ on its own.
  const reflowedOnly = ledger(applyReflow(rows, [SECOND, FIRST]), recs);
  expect(reflowedOnly.entries.map((e) => e.transactionId)).toEqual([FIRST, SECOND]);

  // With the ✓ re-pointed too — the update the confirm dialog buys — the move lands.
  const repointed = [{ ...recs[0], balance: 800000, lockedTransactionIds: [SECOND, FIRST] }];
  const after = ledger(applyReflow(rows, [SECOND, FIRST]), repointed);
  expect(after.entries.map((e) => e.transactionId)).toEqual([SECOND, FIRST]);
  expect(markBalances(after.entries).get(1)).toBe(800000);
 });
});
