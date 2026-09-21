import { beforeEach, describe, expect, it } from 'vitest';
import {
 TEMP_TRANSACTION_ID_MIN,
 TransactionNotSavedError,
 canonicalTransactionKey,
 commitPendingCreate,
 failPendingCreate,
 isTempTransactionId,
 applyPendingTransactionUpdates,
 mintTempTransactionId,
 notePendingCreatedAt,
 noteSettledTransactionUpdate,
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
const rowAt = (id: number, exchangeRateFrom: number) => ({ id, exchangeRateFrom }) as Transaction;

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

describe('applyPendingTransactionUpdates', () => {
 it('keeps an edit whose write is still on the wire over the snapshot that predates it', async () => {
  const write = deferred<void>();
  const request = queueTransactionWrite(7, () => write.promise, rowAt(7, 99));

  // A snapshot that went out while the write is outstanding still holds the old rate.
  const fetchStartedAt = Date.now();
  expect(applyPendingTransactionUpdates([rowAt(7, 1)], fetchStartedAt)[0].exchangeRateFrom).toBe(99);

  write.resolve();
  await request;
  // Still held: this fetch went out BEFORE the write landed, so it cannot contain it — this is
  // the flip the ledger showed, new value → old value → new value.
  expect(applyPendingTransactionUpdates([rowAt(7, 1)], fetchStartedAt)[0].exchangeRateFrom).toBe(99);

  // A fetch started after the write settled is authoritative, and the hold is released.
  expect(applyPendingTransactionUpdates([rowAt(7, 99)], Date.now() + 1)[0].exchangeRateFrom).toBe(99);
  expect(applyPendingTransactionUpdates([rowAt(7, 1)], Date.now() + 1)[0].exchangeRateFrom).toBe(1);
 });

 it('lets the server win again once a write fails, since the caller rolls the row back', async () => {
  const failed = queueTransactionWrite(8, async () => {
   throw new Error('nope');
  }, rowAt(8, 99));
  await expect(failed).rejects.toThrow('nope');
  expect(applyPendingTransactionUpdates([rowAt(8, 1)], Date.now())[0].exchangeRateFrom).toBe(1);
 });

 it('holds the newer of two edits to the same row', async () => {
  const first = deferred<void>();
  const a = queueTransactionWrite(9, () => first.promise, rowAt(9, 10));
  const b = queueTransactionWrite(9, async () => {}, rowAt(9, 20));
  expect(applyPendingTransactionUpdates([rowAt(9, 1)], Date.now())[0].exchangeRateFrom).toBe(20);
  first.resolve();
  await Promise.all([a, b]);
  // The first write settling must not release the hold that belongs to the second edit.
  expect(applyPendingTransactionUpdates([rowAt(9, 1)], Date.now() - 1)[0].exchangeRateFrom).toBe(20);
 });

 it('follows a row edited before its create landed onto its real id', () => {
  const tempId = mintTempTransactionId();
  queueTransactionWrite(tempId, async () => {}, rowAt(tempId, 99));
  commitPendingCreate(tempId, 404);
  const [merged] = applyPendingTransactionUpdates([rowAt(404, 1)], Date.now());
  expect(merged.exchangeRateFrom).toBe(99);
  // The snapshot's real id is kept — the held row still carries the temporary one.
  expect(merged.id).toBe(404);
 });

 it('holds an awaited batch save against a snapshot older than it', () => {
  const fetchStartedAt = Date.now();
  noteSettledTransactionUpdate(11, rowAt(11, 99));
  expect(applyPendingTransactionUpdates([rowAt(11, 1)], fetchStartedAt)[0].exchangeRateFrom).toBe(99);
  expect(applyPendingTransactionUpdates([rowAt(11, 1)], Date.now() + 1)[0].exchangeRateFrom).toBe(1);
 });

 it('leaves rows nobody edited alone', () => {
  const rows = [rowAt(1, 5), rowAt(2, 6)];
  expect(applyPendingTransactionUpdates(rows, Date.now())).toBe(rows);
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
