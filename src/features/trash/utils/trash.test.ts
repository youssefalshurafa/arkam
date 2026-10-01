import { describe, expect, it } from 'vitest';
import type { TrashBatch } from '@/lib/accountingApi';
import { batchTitle, canPurge, canRestoreBatch, canRestoreTransaction, daysRemaining, describeBlockedRestore, filterBatches, isExpiringSoon, searchTrashTransactions } from './trash';

const t = (key: string, params?: Record<string, string | number>) => (params ? `${key}:${JSON.stringify(params)}` : key);

const batch = (overrides: Partial<TrashBatch>): TrashBatch => ({
 id: 1,
 kind: 'transaction',
 label: '',
 deletedBy: 'u1',
 deletedAt: '2026-09-01T00:00:00.000Z',
 counts: { clients: 0, accounts: 0, transactions: 1 },
 blockedCount: 0,
 blockedBy: [],
 touchesReconciled: false,
 pastEditLocked: false,
 preview: [],
 ...overrides,
});

describe('daysRemaining', () => {
 const deletedAt = '2026-09-01T12:00:00.000Z';

 it('reads the full window right after deleting', () => {
  expect(daysRemaining(deletedAt, '2026-09-01T12:00:01.000Z', 30)).toBe(30);
 });

 it('rounds a partial day up, so the last day reads 1 rather than 0', () => {
  expect(daysRemaining(deletedAt, '2026-10-01T02:00:00.000Z', 30)).toBe(1);
 });

 it('is 0 once the window has passed, never negative', () => {
  expect(daysRemaining(deletedAt, '2026-10-01T12:00:00.000Z', 30)).toBe(0);
  expect(daysRemaining(deletedAt, '2026-11-15T00:00:00.000Z', 30)).toBe(0);
 });

 it('falls back to the full window on an unparseable date instead of NaN', () => {
  expect(daysRemaining('not a date', '2026-09-02T00:00:00.000Z', 30)).toBe(30);
 });
});

describe('isExpiringSoon', () => {
 it('flags the last three days', () => {
  expect(isExpiringSoon(3)).toBe(true);
  expect(isExpiringSoon(0)).toBe(true);
  expect(isExpiringSoon(4)).toBe(false);
 });
});

describe('canRestoreBatch', () => {
 it('lets owner and admin restore anything', () => {
  expect(canRestoreBatch('owner', 'x', batch({ kind: 'all_clients', deletedBy: 'someone' }))).toBe(true);
  expect(canRestoreBatch('admin', 'x', batch({ kind: 'client', deletedBy: 'someone' }))).toBe(true);
 });

 it('lets a member restore only their own transaction deletes', () => {
  expect(canRestoreBatch('member', 'u1', batch({ kind: 'transaction', deletedBy: 'u1' }))).toBe(true);
  expect(canRestoreBatch('member', 'u1', batch({ kind: 'transactions', deletedBy: 'u1' }))).toBe(true);
  expect(canRestoreBatch('member', 'u1', batch({ kind: 'transaction', deletedBy: 'u2' }))).toBe(false);
  expect(canRestoreBatch('member', 'u1', batch({ kind: 'client', deletedBy: 'u1' }))).toBe(false);
  expect(canRestoreBatch('member', 'u1', batch({ kind: 'all_transactions', deletedBy: 'u1' }))).toBe(false);
 });

 it('never lets a viewer or an unknown role restore', () => {
  expect(canRestoreBatch('viewer', 'u1', batch({ deletedBy: 'u1' }))).toBe(false);
  expect(canRestoreBatch(null, 'u1', batch({ deletedBy: 'u1' }))).toBe(false);
  expect(canRestoreBatch('member', null, batch({ deletedBy: null }))).toBe(false);
 });
});

describe('canPurge', () => {
 it('is owner/admin only', () => {
  expect(canPurge('owner')).toBe(true);
  expect(canPurge('admin')).toBe(true);
  expect(canPurge('member')).toBe(false);
  expect(canPurge('viewer')).toBe(false);
  expect(canPurge(null)).toBe(false);
 });
});

describe('filterBatches', () => {
 const all = [
  batch({ id: 1, kind: 'transaction' }),
  batch({ id: 2, kind: 'transactions' }),
  batch({ id: 3, kind: 'all_transactions' }),
  batch({ id: 4, kind: 'client' }),
  batch({ id: 5, kind: 'client_account' }),
  batch({ id: 6, kind: 'all_clients' }),
 ];

 it('splits transaction deletes from client/account deletes', () => {
  expect(filterBatches(all, 'all').map((b) => b.id)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(filterBatches(all, 'transactions').map((b) => b.id)).toEqual([1, 2, 3]);
  expect(filterBatches(all, 'clients').map((b) => b.id)).toEqual([4, 5, 6]);
 });
});

describe('batchTitle', () => {
 it('names the client for a client delete and counts for bulk ones', () => {
  expect(batchTitle(batch({ kind: 'client', label: 'Ahmed' }), t)).toBe('trash_kind_client:{"name":"Ahmed"}');
  expect(batchTitle(batch({ kind: 'transactions', counts: { clients: 0, accounts: 0, transactions: 7 } }), t)).toBe('trash_kind_transactions:{"count":7}');
  expect(batchTitle(batch({ kind: 'transaction' }), t)).toBe('trash_kind_transaction');
 });
});

describe('describeBlockedRestore', () => {
 it('is empty when everything came back', () => {
  expect(describeBlockedRestore({ blockedCount: 0, blocked: [] }, t)).toBe('');
 });

 it('names the clients to restore first', () => {
  const message = describeBlockedRestore(
   {
    blockedCount: 2,
    blocked: [
     { kind: 'transaction', id: 1, reason: 'account_in_trash', name: 'B' },
     { kind: 'transaction', id: 2, reason: 'account_in_trash', name: 'B' },
    ],
   },
   t,
  );
  expect(message).toBe('trash_blocked_restore_first:{"count":2,"names":"B"}');
 });

 it('explains an account left behind because it was re-created', () => {
  const message = describeBlockedRestore({ blockedCount: 1, blocked: [{ kind: 'account', id: 9, reason: 'account_exists', name: 'A' }] }, t);
  expect(message).toBe('trash_blocked_account_exists');
 });
});

describe('canRestoreTransaction', () => {
 it('lets a member restore a row from their own transaction delete', () => {
  expect(canRestoreTransaction('member', 'u1', { batchKind: 'transactions', deletedBy: 'u1' })).toBe(true);
 });

 it("refuses a member a row from someone else's delete, or from a client delete", () => {
  expect(canRestoreTransaction('member', 'u1', { batchKind: 'transaction', deletedBy: 'u2' })).toBe(false);
  expect(canRestoreTransaction('member', 'u1', { batchKind: 'client', deletedBy: 'u1' })).toBe(false);
 });

 it('lets owners and admins restore any row', () => {
  expect(canRestoreTransaction('admin', 'u1', { batchKind: 'client', deletedBy: 'u2' })).toBe(true);
 });
});

describe('searchTrashTransactions', () => {
 const rows = [
  { id: 1, description: 'Rent', clientFromName: 'Ahmed', clientToName: 'Milano Lyon', counterParty: '', currencyCode: 'USD', amount: 1500 },
  { id: 2, description: '', clientFromName: '', clientToName: 'Turkiye Trading', counterParty: 'Bank fee', currencyCode: 'TRY', amount: 20 },
 ];

 it('returns everything for an empty search', () => {
  expect(searchTrashTransactions(rows, '  ')).toHaveLength(2);
 });

 it('matches names, counterparty and currency case-insensitively', () => {
  expect(searchTrashTransactions(rows, 'milano').map((r) => r.id)).toEqual([1]);
  expect(searchTrashTransactions(rows, 'BANK').map((r) => r.id)).toEqual([2]);
  expect(searchTrashTransactions(rows, 'try').map((r) => r.id)).toEqual([2]);
 });

 it('matches an amount typed with a thousands separator', () => {
  expect(searchTrashTransactions(rows, '1,500').map((r) => r.id)).toEqual([1]);
 });

 it('requires every term to match', () => {
  expect(searchTrashTransactions(rows, 'ahmed try')).toHaveLength(0);
 });
});
