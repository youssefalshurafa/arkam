import { describe, expect, it } from 'vitest';
import { ledgerEntryMatchesSearchTags } from './ledgerEntries';
import type { ClientLedgerEntry, SearchTag } from '@/shared/types';

function entry(transactionId: number, fields: Partial<ClientLedgerEntry>): ClientLedgerEntry {
 return {
  transactionId,
  counterpartyName: '',
  amount: 100,
  currencyCode: 'USD',
  description: '',
  createdAt: '2026-10-01T10:00:00.000Z',
  ...fields,
 } as unknown as ClientLedgerEntry;
}

const entries = [
 entry(1, { counterpartyName: 'Omar', amount: 500 }),
 entry(2, { counterpartyName: 'Sami', amount: -1500, description: 'Rent payment' }),
 entry(3, { counterpartyName: 'Omar', amount: 1500, currencyCode: 'EUR' }),
 entry(4, { counterpartyName: 'Nour', amount: 500, description: 'rent for march' }),
];

const ids = (tags: SearchTag[]) => entries.filter((e) => ledgerEntryMatchesSearchTags(e, tags)).map((e) => e.transactionId);

describe('ledgerEntryMatchesSearchTags', () => {
 it('matches everything with no tags', () => {
  expect(ids([])).toEqual([1, 2, 3, 4]);
 });

 it('treats a client tag as the counterparty', () => {
  expect(ids([{ kind: 'client', value: 'Omar' }])).toEqual([1, 3]);
 });

 it('ORs several counterparties, since a row only has one', () => {
  expect(ids([{ kind: 'client', value: 'Omar' }, { kind: 'client', value: 'Sami' }])).toEqual([1, 2, 3]);
 });

 it('ANDs counterparties with the other kinds', () => {
  expect(ids([{ kind: 'client', value: 'Omar' }, { kind: 'client', value: 'Sami' }, { kind: 'amount', value: '1500' }])).toEqual([2, 3]);
  expect(ids([{ kind: 'client', value: 'Omar' }, { kind: 'currency', value: 'EUR' }])).toEqual([3]);
 });

 it('compares amounts by magnitude and supports ranges', () => {
  expect(ids([{ kind: 'amount', value: '>1000' }])).toEqual([2, 3]);
  expect(ids([{ kind: 'amount', value: '100-600' }])).toEqual([1, 4]);
 });

 it('matches description case-insensitively', () => {
  expect(ids([{ kind: 'description', value: 'RENT' }])).toEqual([2, 4]);
  expect(ids([{ kind: 'description', value: 'rent' }, { kind: 'amount', value: '500' }])).toEqual([4]);
 });
});
