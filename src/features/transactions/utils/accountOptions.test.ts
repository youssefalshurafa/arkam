import { describe, expect, it } from 'vitest';
import { buildAccountOptions, buildRecentClientIds } from './accountOptions';
import type { ClientAccount } from '@/shared/types';

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
  isDormant: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
 };
}

const tx = (id: number, accountFromId: number | null, accountToId: number | null) => ({ id, accountFromId, accountToId });

// Clients 1..3, alphabetical by name the way the picker receives them; client 3 has two accounts.
const accounts = [
 makeAccount({ id: 10, clientId: 1, clientName: 'Alpha' }),
 makeAccount({ id: 20, clientId: 2, clientName: 'Beta' }),
 makeAccount({ id: 30, clientId: 3, clientName: 'Gamma' }),
 makeAccount({ id: 31, clientId: 3, clientName: 'Gamma', currencyId: 2, currencyCode: 'EUR', currencySymbol: '€' }),
];

describe('buildRecentClientIds', () => {
 it('ranks clients by their newest transaction, both sides counted', () => {
  const transactions = [tx(1, 10, 20), tx(2, 20, 30), tx(3, 31, null)];
  // 3 last used by tx 3, 2 by tx 2, 1 by tx 1 — newest first.
  expect(buildRecentClientIds(transactions, accounts)).toEqual([3, 2, 1]);
 });

 it('ranks on the transaction id, not the order the list happens to arrive in', () => {
  expect(buildRecentClientIds([tx(9, 10, null), tx(4, 20, null)], accounts)).toEqual([1, 2]);
 });

 it('caps the list and ignores accounts the picker does not offer', () => {
  const transactions = [tx(1, 10, null), tx(2, 20, null), tx(3, 999, null)];
  expect(buildRecentClientIds(transactions, accounts, 1)).toEqual([2]);
  expect(buildRecentClientIds(transactions, accounts)).toEqual([2, 1]);
 });
});

describe('buildAccountOptions with recents', () => {
 it('pins the recent clients on top and keeps them in the alphabetical list too', () => {
  const options = buildAccountOptions(accounts, '', null, [2]);
  expect(options).toEqual([
   { kind: 'header', key: 'recent' },
   { kind: 'single', account: accounts[1], recent: true },
   { kind: 'header', key: 'all' },
   { kind: 'single', account: accounts[0] },
   { kind: 'single', account: accounts[1] },
   { kind: 'group', clientId: 3, clientName: 'Gamma', count: 2, expanded: false },
  ]);
 });

 it('pins recents in recency order, whatever the alphabetical order is', () => {
  const options = buildAccountOptions(accounts, '', null, [3, 1]);
  expect(options.slice(0, 4)).toEqual([
   { kind: 'header', key: 'recent' },
   { kind: 'group', clientId: 3, clientName: 'Gamma', count: 2, expanded: false, recent: true },
   { kind: 'single', account: accounts[0], recent: true },
   { kind: 'header', key: 'all' },
  ]);
 });

 it('drops the recent block while a search is active', () => {
  const options = buildAccountOptions(accounts, 'beta', null, [3, 1]);
  expect(options).toEqual([{ kind: 'single', account: accounts[1] }]);
 });

 it('leaves the list untouched when nothing has been used yet', () => {
  expect(buildAccountOptions(accounts, '', null, [])).toEqual(buildAccountOptions(accounts, '', null));
 });
});
