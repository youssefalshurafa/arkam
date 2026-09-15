import { beforeEach, describe, expect, it } from 'vitest';
import {
 TEMP_TRANSACTION_ID_MIN,
 TransactionNotSavedError,
 canonicalTransactionKey,
 commitPendingCreate,
 failPendingCreate,
 isTempTransactionId,
 mintTempTransactionId,
 notePendingCreatedAt,
 pendingCreatedAtFloor,
 pendingTransactionRows,
 queueTransactionWrite,
 registerPendingCreate,
 resetPendingTransactionWrites,
 resolveTransactionId,
 resolveTransactionIds,
} from './pendingTransactionWrites';
import { NEW_ROW_REF_ID } from '@/features/ledger/utils/reconciliation';
import type { Transaction } from '@/shared/types';

const row = (id: number) => ({ id }) as Transaction;

// A promise whose settling this test controls, standing in for a create still on the wire.
function deferred<T>() {
 let resolve!: (value: T) => void;
 let reject!: (error: unknown) => void;
 const promise = new Promise<T>((res, rej) => {
  resolve = res;
  reject = rej;
 });
 return { promise, resolve, reject };
}

beforeEach(() => {
 resetPendingTransactionWrites();
});

describe('temporary ids', () => {
 it('never collides with a real id or the new-row sentinel', () => {
  // Real ids are int4 serials; the sentinel is MAX_SAFE_INTEGER.
  expect(isTempTransactionId(1)).toBe(false);
  expect(isTempTransactionId(2_147_483_647)).toBe(false);
  expect(isTempTransactionId(NEW_ROW_REF_ID)).toBe(false);
  expect(isTempTransactionId(mintTempTransactionId())).toBe(true);
 });

 it('ascends, so a newer row sorts after an older one on an id tie-break', () => {
  const first = mintTempTransactionId();
  const second = mintTempTransactionId();
  expect(second).toBeGreaterThan(first);
  expect(first).toBeGreaterThan(TEMP_TRANSACTION_ID_MIN);
 });
});

describe('resolveTransactionId', () => {
 it('passes a real id straight through', async () => {
  await expect(resolveTransactionId(42)).resolves.toBe(42);
 });

 it('waits for a create that is still in flight, then returns the real id', async () => {
  const tempId = mintTempTransactionId();
  const create = deferred<number>();
  registerPendingCreate(tempId, row(tempId), create.promise);

  const pending = resolveTransactionId(tempId);
  create.resolve(900);
  commitPendingCreate(tempId, 900);
  await expect(pending).resolves.toBe(900);
 });

 it('still resolves long after the create settled', async () => {
  const tempId = mintTempTransactionId();
  registerPendingCreate(tempId, row(tempId), Promise.resolve(901));
  commitPendingCreate(tempId, 901);
  await expect(resolveTransactionId(tempId)).resolves.toBe(901);
  expect(canonicalTransactionKey(tempId)).toBe(901);
 });

 it('rejects for a row whose create failed, rather than sending a temporary id', async () => {
  const tempId = mintTempTransactionId();
  registerPendingCreate(tempId, row(tempId), Promise.reject(new Error('nope')).catch(() => 0) as Promise<number>);
  failPendingCreate(tempId);
  await expect(resolveTransactionId(tempId)).rejects.toBeInstanceOf(TransactionNotSavedError);
 });

 it('resolves a whole list, mixing real and pending ids', async () => {
  const tempId = mintTempTransactionId();
  registerPendingCreate(tempId, row(tempId), Promise.resolve(902));
  commitPendingCreate(tempId, 902);
  await expect(resolveTransactionIds([7, tempId, 9])).resolves.toEqual([7, 902, 9]);
 });
});

describe('pendingTransactionRows', () => {
 it('lists rows whose create is in flight, and drops them once it settles', () => {
  const tempId = mintTempTransactionId();
  registerPendingCreate(tempId, row(tempId), Promise.resolve(903));
  expect(pendingTransactionRows().map((r) => r.id)).toEqual([tempId]);
  commitPendingCreate(tempId, 903);
  expect(pendingTransactionRows()).toEqual([]);
 });
});

describe('queueTransactionWrite', () => {
 it('runs writes to one row in order, so a later edit cannot be overtaken by an earlier one', async () => {
  const order: string[] = [];
  const first = deferred<void>();

  const a = queueTransactionWrite(5, async () => {
   order.push('a:start');
   await first.promise;
   order.push('a:end');
  });
  const b = queueTransactionWrite(5, async () => {
   order.push('b:start');
  });

  // The second write must not have begun while the first is outstanding.
  expect(order).toEqual(['a:start']);
  first.resolve();
  await Promise.all([a, b]);
  expect(order).toEqual(['a:start', 'a:end', 'b:start']);
 });

 it('does not serialize different rows against each other', async () => {
  const order: string[] = [];
  const blocked = deferred<void>();
  const a = queueTransactionWrite(1, async () => {
   await blocked.promise;
   order.push('a');
  });
  const b = queueTransactionWrite(2, async () => {
   order.push('b');
  });
  await b;
  expect(order).toEqual(['b']);
  blocked.resolve();
  await a;
 });

 it('lets the next write run after one fails', async () => {
  const failed = queueTransactionWrite(3, async () => {
   throw new Error('write failed');
  });
  await expect(failed).rejects.toThrow('write failed');
  await expect(queueTransactionWrite(3, async () => 'ok')).resolves.toBe('ok');
 });
});

describe('pendingCreatedAtFloor', () => {
 it('remembers the latest timestamp handed out for a day, and only that day', () => {
  expect(pendingCreatedAtFloor('2026-09-15')).toBeNull();
  notePendingCreatedAt('2026-09-15', 1000);
  notePendingCreatedAt('2026-09-15', 3000);
  notePendingCreatedAt('2026-09-15', 2000);
  expect(pendingCreatedAtFloor('2026-09-15')).toBe(3000);
  expect(pendingCreatedAtFloor('2026-09-16')).toBeNull();
 });
});
