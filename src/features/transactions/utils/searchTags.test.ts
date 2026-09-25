import { describe, expect, it } from 'vitest';
import { parseAmountQuery, rowMatchesSearchTags } from './searchTags';
import { filterDisplayedTransactionRows } from './transactionRows';
import type { TransactionTableRow } from '@/shared/types';

function row(id: number, fields: Partial<TransactionTableRow>): TransactionTableRow {
 return {
  id,
  accountFromId: 1,
  accountToId: 2,
  counterParty: '',
  type: 'transfer',
  isArchived: 0,
  archiveHidden: 0,
  amount: 100,
  clientFromName: '',
  clientToName: '',
  currencyCode: 'USD',
  description: '',
  descriptionFrom: '',
  descriptionTo: '',
  createdAt: '2026-08-12T10:00:00.000Z',
  ...fields,
 } as unknown as TransactionTableRow;
}

const xToY = row(1, { clientFromName: 'Ahmed', clientToName: 'Omar', amount: 500 });
const yToX = row(2, { clientFromName: 'Omar', clientToName: 'Ahmed', amount: 1500, description: 'Rent payment' });
const xToZ = row(3, { clientFromName: 'Ahmed', clientToName: 'Sami', amount: 500, currencyCode: 'EUR' });
const split = row(4, { clientFromName: 'Sami', clientToName: 'Omar', descriptionFrom: 'rent for march' });
const rows = [xToY, yToX, xToZ, split];

const ids = (tags: Parameters<typeof rowMatchesSearchTags>[1]) => rows.filter((r) => rowMatchesSearchTags(r, tags)).map((r) => r.id);

describe('parseAmountQuery', () => {
 it('reads exact values, ignoring thousands separators', () => {
  expect(parseAmountQuery('1,500')?.(1500)).toBe(true);
  expect(parseAmountQuery('1500')?.(150)).toBe(false);
 });

 it('reads ranges in either order, inclusive', () => {
  const range = parseAmountQuery('500-100')!;
  expect([99, 100, 500, 501].map(range)).toEqual([false, true, true, false]);
 });

 it('keeps strict bounds strict', () => {
  expect(parseAmountQuery('>500')?.(500)).toBe(false);
  expect(parseAmountQuery('>=500')?.(500)).toBe(true);
  expect(parseAmountQuery('<500')?.(500)).toBe(false);
 });

 it('rejects text that is not an amount', () => {
  expect(parseAmountQuery('rent')).toBeNull();
  expect(parseAmountQuery('')).toBeNull();
 });
});

describe('rowMatchesSearchTags', () => {
 it('two client tags find transactions between them, both directions', () => {
  expect(ids([{ kind: 'client', value: 'Ahmed' }, { kind: 'client', value: 'Omar' }])).toEqual([1, 2]);
 });

 it('combines a client with an amount', () => {
  expect(ids([{ kind: 'client', value: 'Ahmed' }, { kind: 'amount', value: '500' }])).toEqual([1, 3]);
 });

 it('combines a description with an amount range', () => {
  expect(ids([{ kind: 'description', value: 'RENT' }, { kind: 'amount', value: '>1000' }])).toEqual([2]);
 });

 it('searches split per-side descriptions too', () => {
  expect(ids([{ kind: 'description', value: 'march' }])).toEqual([4]);
 });

 it('filters by currency', () => {
  expect(ids([{ kind: 'currency', value: 'EUR' }])).toEqual([3]);
 });

 it('no tags matches everything', () => {
  expect(ids([])).toEqual([1, 2, 3, 4]);
 });
});

it('filterDisplayedTransactionRows applies tags on top of the other filters', () => {
 const result = filterDisplayedTransactionRows({
  transactionTableRows: rows,
  manualRowOrder: null,
  section: 'transactions',
  txFilterSearch: '',
  txFilterWholeWord: false,
  txFilterClient: '',
  txFilterDateFrom: '',
  txFilterDateTo: '',
  txFilterHideExpenses: false,
  txHiddenFilter: 'exclude',
  txFilterTags: [{ kind: 'client', value: 'Ahmed' }, { kind: 'client', value: 'Omar' }],
 });
 expect(result.map((r) => r.id)).toEqual([1, 2]);
});
