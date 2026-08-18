import { describe, expect, it } from 'vitest';
import { computeClientLedgers } from './ledgerBalances';
import type { ClientAccount, Reconciliation, Transaction } from '@/shared/types';

function makeAccount(overrides: Partial<ClientAccount> = {}): ClientAccount {
 return {
  id: 1,
  clientId: 1,
  clientName: 'Client A',
  currencyId: 1,
  currencyCode: 'USD',
  currencySymbol: '$',
  startingBalance: 0,
  note: '',
  noteShowInPdf: false,
  isSystem: false,
  systemKind: null,
  ownerUserId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
 };
}

function makeCounterAccount(overrides: Partial<ClientAccount> = {}): ClientAccount {
 return makeAccount({ id: 2, clientId: 2, clientName: 'Client B', ...overrides });
}

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
 return {
  id: 1,
  accountFromId: 2,
  clientFromName: 'Client B',
  accountFromCurrencyCode: 'USD',
  accountFromCurrencySymbol: '$',
  accountToId: 1,
  clientToName: 'Client A',
  accountToCurrencyCode: 'USD',
  accountToCurrencySymbol: '$',
  currencyId: 1,
  currencyCode: 'USD',
  currencySymbol: '$',
  amount: 100,
  type: 'transfer',
  exchangeRateFrom: 1,
  commissionFrom: 0,
  exchangeRateTo: 1,
  commissionTo: 0,
  exchangeRateFromReversed: 0,
  exchangeRateToReversed: 0,
  charges: 0,
  chargesCurrencyId: null,
  chargesCurrencyCode: null,
  chargesCurrencySymbol: null,
  chargesPayer: '',
  chargesExchangeRate: 1,
  chargesDescription: '',
  charges2: 0,
  charges2CurrencyId: null,
  charges2CurrencyCode: null,
  charges2CurrencySymbol: null,
  chargesPayer2: '',
  charges2ExchangeRate: 1,
  charges2Description: '',
  description: '',
  descriptionFrom: '',
  descriptionTo: '',
  exchangeActualAmount: null,
  archiveNote: '',
  counterParty: '',
  isArchived: 0,
  archiveHidden: 0,
  distributionLocationId: null,
  distributionLocationName: null,
  distributionLocationKind: null,
  createdAt: '2026-08-17T00:00:01.000Z',
  ...overrides,
 };
}

describe('computeClientLedgers — reconciliation-aware sort', () => {
 const account = makeAccount();
 const counterAccount = makeCounterAccount();
 const clientAccounts = [account, counterAccount];
 const clientAccountMap = new Map(clientAccounts.map((a) => [a.id, a]));
 const currencyMap = new Map([[1, { id: 1, code: 'USD', name: 'US Dollar', symbol: '$', isEnabled: 1, isMain: 1, createdAt: '2026-01-01T00:00:00.000Z' }]]);

 it('keeps a reconciled row before a same-day unreconciled row even when the unreconciled row has an (adversarially) earlier raw createdAt', () => {
  // Reproduces the reported bug: a copy-pasted/backdated new transaction (id 2, never
  // reconciled) whose computed createdAt happens to be EARLIER than the already-reconciled
  // anchor's (id 1) — e.g. from a stray timestamp irregularity in older data. Before this
  // fix, the plain createdAt sort would have rendered the new row above the reconciled one.
  const anchorTx = makeTransaction({ id: 1, createdAt: '2026-08-17T23:00:00.000Z' });
  const newTx = makeTransaction({ id: 2, createdAt: '2026-08-17T10:00:00.000Z' }); // earlier, but created AFTER reconciling

  const reconciliations: Reconciliation[] = [
   {
    id: 1,
    accountId: account.id,
    anchorTransactionId: anchorTx.id,
    anchorDate: '2026-08-17',
    lockedTransactionIds: [anchorTx.id],
    balance: 100,
    note: '',
    createdAt: '2026-08-17T23:00:01.000Z',
   },
  ];

  const [ledger] = computeClientLedgers({
   selectedClientForLedger: { id: account.clientId },
   section: 'client-ledger',
   pdfExportModal: null,
   clientAccounts,
   transactions: [anchorTx, newTx],
   reconciliations,
   clientAccountMap,
   currencyMap,
   enabled: true,
  });

  expect(ledger.entries.map((e) => e.transactionId)).toEqual([anchorTx.id, newTx.id]);
  expect(ledger.entries[0].isLocked).toBe(true);
  expect(ledger.entries[1].isLocked).toBe(false);
 });

 it('does not disturb ordering among rows that are all-member or all-non-member (normal createdAt order is preserved)', () => {
  const tx1 = makeTransaction({ id: 1, createdAt: '2026-08-10T08:00:00.000Z' });
  const tx2 = makeTransaction({ id: 2, createdAt: '2026-08-10T09:00:00.000Z' });
  const tx3 = makeTransaction({ id: 3, createdAt: '2026-08-11T08:00:00.000Z' });
  const tx4 = makeTransaction({ id: 4, createdAt: '2026-08-11T09:00:00.000Z' });

  const reconciliations: Reconciliation[] = [
   {
    id: 1,
    accountId: account.id,
    anchorTransactionId: tx2.id,
    anchorDate: '2026-08-10',
    lockedTransactionIds: [tx1.id, tx2.id],
    balance: 200,
    note: '',
    createdAt: '2026-08-10T09:00:01.000Z',
   },
  ];

  const [ledger] = computeClientLedgers({
   selectedClientForLedger: { id: account.clientId },
   section: 'client-ledger',
   pdfExportModal: null,
   clientAccounts,
   transactions: [tx4, tx1, tx3, tx2],
   reconciliations,
   clientAccountMap,
   currencyMap,
   enabled: true,
  });

  expect(ledger.entries.map((e) => e.transactionId)).toEqual([tx1.id, tx2.id, tx3.id, tx4.id]);
 });

 it('is unaffected on an account with no reconciliation at all', () => {
  const tx1 = makeTransaction({ id: 1, createdAt: '2026-08-10T10:00:00.000Z' });
  const tx2 = makeTransaction({ id: 2, createdAt: '2026-08-10T09:00:00.000Z' });

  const [ledger] = computeClientLedgers({
   selectedClientForLedger: { id: account.clientId },
   section: 'client-ledger',
   pdfExportModal: null,
   clientAccounts,
   transactions: [tx1, tx2],
   reconciliations: [],
   clientAccountMap,
   currencyMap,
   enabled: true,
  });

  expect(ledger.entries.map((e) => e.transactionId)).toEqual([tx2.id, tx1.id]);
  expect(ledger.entries.every((e) => !e.isLocked)).toBe(true);
 });
});

describe('computeClientLedgers — two independent charge slots', () => {
 const account = makeAccount();
 const counterAccount = makeCounterAccount();
 const clientAccounts = [account, counterAccount];
 const clientAccountMap = new Map(clientAccounts.map((a) => [a.id, a]));
 const currencyMap = new Map([[1, { id: 1, code: 'USD', name: 'US Dollar', symbol: '$', isEnabled: 1, isMain: 1, createdAt: '2026-01-01T00:00:00.000Z' }]]);

 // Reproduces the reported bug's scenario: one org-settled charge on the "from" side (charges)
 // and a second, separate org-settled charge on the "to" side (charges2), on the same
 // transaction. Before the second charge slot existed, only one charge could be stored, so it
 // could only ever belong to one side — the other side's charges editor had nothing to show.
 it('keeps two org-settled charges on opposite sides fully independent', () => {
  // makeTransaction defaults accountFromId to counterAccount.id (2) and accountToId to account.id (1).
  const tx = makeTransaction({
   id: 1,
   amount: 100,
   charges: 80,
   chargesPayer: 'from_to_me', // counterAccount's client (from) pays 80 to the org
   charges2: 100,
   chargesPayer2: 'me_to_to', // the org pays 100 to account's client (to)
  });

  const [fromLedger] = computeClientLedgers({
   selectedClientForLedger: { id: counterAccount.clientId },
   section: 'client-ledger',
   pdfExportModal: null,
   clientAccounts,
   transactions: [tx],
   reconciliations: [],
   clientAccountMap,
   currencyMap,
   enabled: true,
  });
  const [toLedger] = computeClientLedgers({
   selectedClientForLedger: { id: account.clientId },
   section: 'client-ledger',
   pdfExportModal: null,
   clientAccounts,
   transactions: [tx],
   reconciliations: [],
   clientAccountMap,
   currencyMap,
   enabled: true,
  });

  const fromEntry = fromLedger.entries[0];
  const toEntry = toLedger.entries[0];

  // The first charge (from -> org) only affects the "from" side.
  expect(fromEntry.chargeAffectsThisAccount).toBe(true);
  expect(fromEntry.isChargesPayerThisAccount).toBe(true);
  expect(toEntry.chargeAffectsThisAccount).toBe(false);

  // The second charge (org -> to) only affects the "to" side, independently of the first.
  expect(toEntry.chargeAffectsThisAccount2).toBe(true);
  expect(toEntry.isChargesPayerThisAccount2).toBe(false);
  expect(fromEntry.chargeAffectsThisAccount2).toBe(false);

  // Both charges fold into their own side's running balance (starting balance 0, one transaction).
  expect(fromEntry.runningBalance).toBe(20); // +100 sent, -80 for the charge it bears
  expect(toEntry.runningBalance).toBe(0); // -100 received, +100 for the charge it's credited
 });
});
