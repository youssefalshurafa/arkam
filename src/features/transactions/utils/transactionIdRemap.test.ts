import { beforeEach, describe, expect, it } from 'vitest';
import { forgetTransactionId, remapTransactionId } from './transactionIdRemap';
import { useLedgerStore } from '@/features/ledger/store/ledgerStore';
import { useTransactionsStore } from '@/features/transactions/store/transactionsStore';
import type { LedgerTransactionDraft, TransactionTableDraft } from '@/shared/types';

const TEMP = 1_000_000_001;
const REAL = 4242;
const OTHER = 77;

// Every piece of UI state that can end up pointing at a row created a moment ago. Both remap and
// forget must cover all of them — the two paths drifting apart is the likeliest bug here.
function seedStores() {
 const tx = useTransactionsStore.getState();
 tx.setEditingTransaction({ id: TEMP, createdAt: '2026-09-15 10:00:00' });
 tx.setEditingArchiveEntry({ id: TEMP, createdAt: '2026-09-15 10:00:00' });
 tx.setSelectedTransactionIds(new Set([TEMP, OTHER]));
 tx.setEditingRowIds(new Set([TEMP, OTHER]));
 tx.setTransactionTableDrafts({ [TEMP]: { transactionId: TEMP } as TransactionTableDraft });
 tx.setManualRowOrder([OTHER, TEMP]);
 tx.setTableRateFromReversed({ [TEMP]: true });
 tx.setTableRateToReversed({ [TEMP]: true });
 tx.setCommissionExpandedTxns(new Set([TEMP]));
 tx.setExpensesExpandedTxns(new Set([TEMP]));
 tx.setExpensesExpandedTxns2(new Set([TEMP]));
 tx.setInfoTransactionId(TEMP);

 const ledger = useLedgerStore.getState();
 // Ledger keys are `${transactionId}:${accountId}`, with a `:2` variant for the second expense
 // slot, and the same row appears under BOTH of its accounts.
 ledger.setLedgerTransactionDrafts({
  [`${TEMP}:5`]: { transactionId: TEMP } as LedgerTransactionDraft,
  [`${TEMP}:9`]: { transactionId: TEMP } as LedgerTransactionDraft,
  [`${OTHER}:5`]: { transactionId: OTHER } as LedgerTransactionDraft,
 });
 ledger.setEditingLedgerRowKeys(new Set([`${TEMP}:5`, `${OTHER}:5`]));
 ledger.setSelectedLedgerEntryKeys(new Set([`${TEMP}:5`, `${TEMP}:9`]));
 ledger.setLedgerSumSelection(new Set([`${TEMP}:5`]));
 ledger.setLedgerExpensesExpandedKeys(new Set([`${TEMP}:5`, `${TEMP}:5:2`]));
 ledger.setLedgerRateReversed({ [`${TEMP}:5`]: true });
 ledger.setLedgerDisplayRateReversed({ [`${TEMP}:5`]: true });
 ledger.setHighlightedLedgerRows(new Map([[`${TEMP}:5`, 'yellow']]));
}

// Everything above, flattened, so a new entry added to one path and not the other is caught.
function stateMentioning(id: number): string[] {
 const tx = useTransactionsStore.getState();
 const ledger = useLedgerStore.getState();
 const hits: string[] = [];
 const note = (where: string, present: boolean) => {
  if (present) hits.push(where);
 };
 const keyed = (key: string) => key.split(':')[0] === String(id);

 note('editingTransaction', tx.editingTransaction?.id === id);
 note('editingArchiveEntry', tx.editingArchiveEntry?.id === id);
 note('selectedTransactionIds', tx.selectedTransactionIds.has(id));
 note('editingRowIds', tx.editingRowIds.has(id));
 note('transactionTableDrafts', tx.transactionTableDrafts[id] !== undefined);
 note('transactionTableDrafts.transactionId', Object.values(tx.transactionTableDrafts).some((draft) => draft.transactionId === id));
 note('manualRowOrder', (tx.manualRowOrder ?? []).includes(id));
 note('tableRateFromReversed', tx.tableRateFromReversed[id] !== undefined);
 note('tableRateToReversed', tx.tableRateToReversed[id] !== undefined);
 note('commissionExpandedTxns', tx.commissionExpandedTxns.has(id));
 note('expensesExpandedTxns', tx.expensesExpandedTxns.has(id));
 note('expensesExpandedTxns2', tx.expensesExpandedTxns2.has(id));
 note('infoTransactionId', tx.infoTransactionId === id);

 note('ledgerTransactionDrafts', Object.keys(ledger.ledgerTransactionDrafts).some(keyed));
 note('ledgerTransactionDrafts.transactionId', Object.values(ledger.ledgerTransactionDrafts).some((draft) => draft.transactionId === id));
 note('editingLedgerRowKeys', [...ledger.editingLedgerRowKeys].some(keyed));
 note('selectedLedgerEntryKeys', [...ledger.selectedLedgerEntryKeys].some(keyed));
 note('ledgerSumSelection', [...ledger.ledgerSumSelection].some(keyed));
 note('ledgerExpensesExpandedKeys', [...ledger.ledgerExpensesExpandedKeys].some(keyed));
 note('ledgerRateReversed', Object.keys(ledger.ledgerRateReversed).some(keyed));
 note('ledgerDisplayRateReversed', Object.keys(ledger.ledgerDisplayRateReversed).some(keyed));
 note('highlightedLedgerRows', [...ledger.highlightedLedgerRows.keys()].some(keyed));
 return hits;
}

beforeEach(() => {
 seedStores();
});

describe('remapTransactionId', () => {
 it('moves every trace of the row from the temporary id to the real one', () => {
  const before = stateMentioning(TEMP);
  expect(before.length).toBeGreaterThan(20);

  remapTransactionId(TEMP, REAL);

  expect(stateMentioning(TEMP)).toEqual([]);
  expect(stateMentioning(REAL)).toEqual(before);
 });

 it('keeps the account half of a ledger key, and both ledgers the row appears in', () => {
  remapTransactionId(TEMP, REAL);
  expect(Object.keys(useLedgerStore.getState().ledgerTransactionDrafts).sort()).toEqual([`${REAL}:5`, `${REAL}:9`, `${OTHER}:5`].sort());
  // The second expense slot's `:2` suffix survives too.
  expect([...useLedgerStore.getState().ledgerExpensesExpandedKeys].sort()).toEqual([`${REAL}:5`, `${REAL}:5:2`]);
 });

 it('leaves other rows alone', () => {
  remapTransactionId(TEMP, REAL);
  const tx = useTransactionsStore.getState();
  expect(tx.selectedTransactionIds.has(OTHER)).toBe(true);
  expect(tx.editingRowIds.has(OTHER)).toBe(true);
  expect(useLedgerStore.getState().editingLedgerRowKeys.has(`${OTHER}:5`)).toBe(true);
  expect(useTransactionsStore.getState().manualRowOrder).toEqual([OTHER, REAL]);
 });
});

describe('forgetTransactionId', () => {
 it('drops every trace of a row whose create failed', () => {
  forgetTransactionId(TEMP);
  expect(stateMentioning(TEMP)).toEqual([]);
  expect(stateMentioning(REAL)).toEqual([]);
 });

 it('leaves other rows alone', () => {
  forgetTransactionId(TEMP);
  const tx = useTransactionsStore.getState();
  expect(tx.selectedTransactionIds.has(OTHER)).toBe(true);
  expect(tx.manualRowOrder).toEqual([OTHER]);
  expect(useLedgerStore.getState().ledgerTransactionDrafts[`${OTHER}:5`]).toBeDefined();
 });
});
