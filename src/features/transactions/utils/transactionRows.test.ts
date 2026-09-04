import { describe, expect, it } from 'vitest';
import { countHiddenArchiveRows, filterDisplayedTransactionRows, isArchiveEligible } from './transactionRows';
import type { TransactionTableRow } from '@/shared/types';

// Archive-eligible = one party missing, no free-text counterparty, not an adjustment.
function row(id: number): TransactionTableRow {
 return {
  id,
  accountFromId: 1,
  accountToId: null,
  counterParty: '',
  type: 'transfer',
  isArchived: 0,
  archiveHidden: 0,
  amount: 100,
  clientFromName: 'Ahmed',
  clientToName: '',
  description: '',
  createdAt: '2026-08-12T10:00:00.000Z',
 } as unknown as TransactionTableRow;
}

const visible = row(1);
const hidden = { ...row(2), archiveHidden: 1 } as TransactionTableRow;
const rows = [visible, hidden];

const archive = (txHiddenFilter: 'exclude' | 'include' | 'only') =>
 filterDisplayedTransactionRows({
  transactionTableRows: rows,
  manualRowOrder: null,
  section: 'archive',
  txFilterSearch: '',
  txFilterWholeWord: false,
  txFilterClient: '',
  txFilterDateFrom: '',
  txFilterDateTo: '',
  txFilterHideExpenses: false,
  txHiddenFilter,
 }).map((r) => r.id);

describe('archive hidden-row filter', () => {
 it('leaves hidden rows out by default', () => {
  expect(archive('exclude')).toEqual([1]);
 });

 it('folds hidden rows back in alongside the rest', () => {
  expect(archive('include')).toEqual([1, 2]);
 });

 // The view that makes hiding reversible: everything you hid, and nothing else.
 it('shows nothing but hidden rows', () => {
  expect(archive('only')).toEqual([2]);
 });

 // Hiding is a display filter only. If it changed eligibility, the hidden-only view would be
 // unable to list what it is meant to list, and a hidden row could never be recovered.
 it('keeps a hidden row archive-eligible', () => {
  expect(isArchiveEligible(hidden)).toBe(true);
 });

 it('counts hidden rows regardless of the active view', () => {
  expect(countHiddenArchiveRows(rows)).toBe(1);
 });

 it('ignores rows that were never archive-eligible', () => {
  const completeRow = { ...row(3), accountToId: 2, archiveHidden: 1 } as TransactionTableRow;
  expect(countHiddenArchiveRows([completeRow])).toBe(0);
 });
});
