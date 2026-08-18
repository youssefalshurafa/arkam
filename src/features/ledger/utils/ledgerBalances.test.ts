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
