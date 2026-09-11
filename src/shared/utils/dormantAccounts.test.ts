import { describe, expect, it } from 'vitest';
import { filterActiveClientAccounts } from './dormantAccounts';
import { buildAccountOptions } from '@/features/transactions/utils/accountOptions';
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

describe('filterActiveClientAccounts', () => {
 it('drops dormant accounts and keeps active ones', () => {
  const accounts = [
   makeAccount({ id: 1 }),
   makeAccount({ id: 2, currencyId: 2, currencyCode: 'EUR', isDormant: true }),
  ];
  expect(filterActiveClientAccounts(accounts).map((a) => a.id)).toEqual([1]);
 });

 it('keeps a dormant account that the form already points at', () => {
  const accounts = [makeAccount({ id: 1, isDormant: true }), makeAccount({ id: 2, isDormant: true })];
  expect(filterActiveClientAccounts(accounts, [2, null]).map((a) => a.id)).toEqual([2]);
 });

 it('hides a client from the picker once every one of their accounts is dormant', () => {
  const accounts = [
   makeAccount({ id: 1, clientId: 1, clientName: 'Active Client' }),
   makeAccount({ id: 2, clientId: 2, clientName: 'Idle Client', isDormant: true }),
   makeAccount({ id: 3, clientId: 2, clientName: 'Idle Client', currencyId: 2, currencyCode: 'EUR', isDormant: true }),
  ];
  const options = buildAccountOptions(filterActiveClientAccounts(accounts), '', null);
  expect(options).toEqual([{ kind: 'single', account: accounts[0] }]);
 });

 it('still lists a partly dormant client, without their dormant accounts', () => {
  const accounts = [
   makeAccount({ id: 2, clientId: 2, clientName: 'Half Idle' }),
   makeAccount({ id: 3, clientId: 2, clientName: 'Half Idle', currencyId: 2, currencyCode: 'EUR', isDormant: true }),
  ];
  const options = buildAccountOptions(filterActiveClientAccounts(accounts), '', null);
  // One surviving account means the client renders as a plain row, not an expandable group.
  expect(options).toEqual([{ kind: 'single', account: accounts[0] }]);
 });
});
