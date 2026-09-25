import type { Transaction } from '@/shared/types';

/**
 * The bookkeeping that lets a brand-new transaction appear on screen before the server has
 * given it an id.
 *
 * A create no longer blocks the UI: the row is inserted with a temporary id and the real one
 * is filled in when the request lands. Everything that could go wrong with that lives here —
 * minting ids that can't be confused with real ones, translating a temporary id into the real
 * one for anything about to be sent to the server, keeping writes to one row in order, and
 * holding the optimistic row so an unrelated refetch can't erase it mid-flight.
 *
 * Deliberately a plain module, not a hook: `accountingApi` has to reach it (see below), it must
 * survive component remounts, and it is then directly unit-testable.
 */

/**
 * Floor for temporary ids. Real ids are Postgres `serial` values (int4, max 2,147,483,647), three
 * orders of magnitude below this, so the two ranges can never meet.
 *
 * Large and ASCENDING rather than negative, which is load-bearing for sort order: every id
 * tie-break in the app reads "higher id = inserted later" (buildTransactionTableRows,
 * computeClientLedgers, harvestProfit). A negative temp id would sort a new row to the wrong end
 * of a same-timestamp group and then visibly jump when the real id arrived; a high ascending one
 * sorts exactly where the real id will.
 */
export const TEMP_TRANSACTION_ID_MIN = 1e12;

// Kept clear of reconciliation.ts's NEW_ROW_REF_ID (Number.MAX_SAFE_INTEGER), the other
// out-of-band id sentinel in the app — the two must never be mistaken for each other.
const TEMP_TRANSACTION_ID_MAX = Number.MAX_SAFE_INTEGER - 1;

let lastTempId = TEMP_TRANSACTION_ID_MIN;

export function mintTempTransactionId(): number {
 lastTempId = Math.min(lastTempId + 1, TEMP_TRANSACTION_ID_MAX);
 return lastTempId;
}

export function isTempTransactionId(id: number): boolean {
 return id >= TEMP_TRANSACTION_ID_MIN && id <= TEMP_TRANSACTION_ID_MAX;
}

/** Raised when something needs a row's real id but that row's create never landed. */
export class TransactionNotSavedError extends Error {
 constructor() {
  super('This transaction was never saved, so it cannot be changed.');
  this.name = 'TransactionNotSavedError';
 }
}

type PendingCreate = {
 // The optimistic row as inserted into the workspace cache, so a refetch can put it back.
 row: Transaction;
 realId: number | null;
 failed: boolean;
 // Resolves with the server-assigned id; used by callers that arrive mid-flight.
 settled: Promise<number>;
};

const pendingByTempId = new Map<number, PendingCreate>();
// Survives its pending entry so a consumer still holding a temp id resolves long after the fact.
const realIdByTempId = new Map<number, number>();

// Bounded so a long session can't grow these without limit; 200 is far more rows than could
// still be referenced by anything on screen.
const MAX_REMEMBERED_IDS = 200;

function rememberRealId(tempId: number, realId: number) {
 realIdByTempId.set(tempId, realId);
 while (realIdByTempId.size > MAX_REMEMBERED_IDS) {
  const oldest = realIdByTempId.keys().next();
  if (oldest.done) break;
  realIdByTempId.delete(oldest.value);
 }
}

export function registerPendingCreate(tempId: number, row: Transaction, settled: Promise<number>): void {
 pendingByTempId.set(tempId, { row, realId: null, failed: false, settled });
}

export function commitPendingCreate(tempId: number, realId: number): void {
 const pending = pendingByTempId.get(tempId);
 if (pending) pending.realId = realId;
 rememberRealId(tempId, realId);
 pendingByTempId.delete(tempId);
}

export function failPendingCreate(tempId: number): void {
 const pending = pendingByTempId.get(tempId);
 if (pending) pending.failed = true;
 pendingByTempId.delete(tempId);
}

/**
 * The id to actually send to the server. A real id passes straight through; a temporary one
 * waits for its create to land and comes back as the real id.
 *
 * This is what makes a temporary id reaching the database impossible rather than merely
 * unlikely: it is applied inside accountingApi — the single door to the server — so no call site
 * can forget it. (A placeholder id sent back on an update was a real bug here once; the server
 * would happily update zero rows and answer ok.)
 */
export function resolveTransactionId(id: number): Promise<number> {
 if (!isTempTransactionId(id)) return Promise.resolve(id);
 const known = realIdByTempId.get(id);
 if (known != null) return Promise.resolve(known);
 const pending = pendingByTempId.get(id);
 if (!pending) return Promise.reject(new TransactionNotSavedError());
 return pending.settled;
}

export function resolveTransactionIds(ids: number[]): Promise<number[]> {
 return ids.some(isTempTransactionId) ? Promise.all(ids.map(resolveTransactionId)) : Promise.resolve(ids);
}

/** A row's stable identity across the temp→real swap, for keying anything that must not move. */
export function canonicalTransactionKey(id: number): number {
 return realIdByTempId.get(id) ?? id;
}

/**
 * The optimistic rows whose create is still on the wire.
 *
 * The workspace query refetches on window focus, on the cross-tab signal, and after any other
 * save — any of which can land while a create is in flight and return a snapshot that predates
 * the new row. Merging these back in is what stops the row blinking out and back.
 */
export function pendingTransactionRows(): Transaction[] {
 return [...pendingByTempId.values()].map((pending) => pending.row);
}

/**
 * Writes to ONE row, in the order they were made.
 *
 * Background writes send the whole row, so two edits to the same transaction landing out of
 * order leave the server holding the older one — and the reconciling refetch then paints those
 * stale values back over the newer edit, silently. Different rows still go in parallel.
 */
const writeChains = new Map<number, Promise<unknown>>();

export function queueTransactionWrite<T>(id: number, run: () => Promise<T>, optimisticRow?: Transaction | null): Promise<T> {
 const key = canonicalTransactionKey(id);
 // Registered here, not when `run` finally executes: the moment the caller patched the cache is
 // the moment a snapshot already on the wire stops being able to describe this row (see
 // applyPendingTransactionUpdates).
 const token = optimisticRow ? registerPendingUpdate(key, optimisticRow) : null;
 const write =
  token == null
   ? run
   : () =>
      run().then(
       (value) => {
        settlePendingUpdate(key, token);
        return value;
       },
       (error) => {
        // Never landed, so the server's version is the true one again — the caller rolls the
        // cache back itself, and this row must stop overriding what a refetch brings.
        dropPendingUpdate(key, token);
        throw error;
       },
      );
 const previous = writeChains.get(key);
 // Nothing queued for this row → start now rather than a microtask later; the uncontended case
 // is nearly all of them and should cost nothing. The stored chain is the settled form below, so
 // it never rejects and a failed write can't poison the next one.
 const next = previous ? previous.then(write) : write();
 // The chain tracks the SETTLED form: `next` itself is the caller's to handle, and deriving any
 // other un-caught promise from it would surface a rejection nobody is listening to.
 const settled = next.catch(() => undefined);
 writeChains.set(key, settled);
 void settled.then(() => {
  // Only clear when nothing newer queued behind this one.
  if (writeChains.get(key) === settled) writeChains.delete(key);
 });
 return next;
}

/**
 * The rows an optimistic EDIT has already put on screen, held until a snapshot can be shown to
 * contain that edit.
 *
 * `pendingTransactionRows` above does this for creates; this is the same problem for updates,
 * and the one that was actually reported: change a ledger row's exchange rate, arrow on to the
 * next row, and the new rate appears, flips back to the old one, then returns. The flip is a
 * workspace snapshot that was ALREADY on the wire when the edit was patched in — it was read
 * from the database before the write reached it, so applying it paints the old values back,
 * and the row only settles once the resync that follows the write lands.
 *
 * useWorkspaceResync's "re-arm while a write is pending" check can't see this: it decides when
 * to START a fetch, and the fetch that does the damage here was started by something else — the
 * PREVIOUS row's resync, a window focus, a cross-tab signal — before this write existed.
 *
 * So the decision is made on arrival instead, by comparing when the fetch went out against when
 * the write settled, which is what `settledAt` is for.
 */
type PendingUpdate = {
 // Which registration this is, so a settle/drop belonging to an edit that has since been
 // superseded by a newer one can't touch the newer row's entry.
 token: number;
 row: Transaction;
 startedAt: number;
 // When the write finished, or null while it is still on the wire.
 settledAt: number | null;
};

const pendingUpdates = new Map<number, PendingUpdate>();
let updateSeq = 0;

// Backstop only: an entry is normally dropped by the first snapshot fetched after its write
// settled. If a settle were somehow missed, this stops the row being pinned to its optimistic
// values for the rest of the session.
const PENDING_UPDATE_MAX_AGE_MS = 60_000;

function registerPendingUpdate(key: number, row: Transaction): number {
 const token = ++updateSeq;
 // A newer edit to the same row simply replaces the older one — it is what the user last saw.
 pendingUpdates.set(key, { token, row, startedAt: Date.now(), settledAt: null });
 return token;
}

function settlePendingUpdate(key: number, token: number): void {
 const entry = pendingUpdates.get(key);
 if (entry?.token === token) entry.settledAt = Date.now();
}

function dropPendingUpdate(key: number, token: number): void {
 const entry = pendingUpdates.get(key);
 if (entry?.token === token) pendingUpdates.delete(key);
}

/**
 * The same hold, for a write that was awaited instead of queued (the batch "save all" paths).
 * The row is stored by the time this is called, so it counts as settled immediately — but a
 * snapshot that went out before it landed still must not repaint the row with the old values.
 */
export function noteSettledTransactionUpdate(id: number, row: Transaction | null): void {
 if (!row) return;
 const key = canonicalTransactionKey(id);
 settlePendingUpdate(key, registerPendingUpdate(key, row));
}

/**
 * Re-applies the optimistic edits a snapshot can't yet know about.
 *
 * `fetchStartedAt` is when the request went out. An edit whose write settled before that is in
 * the snapshot already, so its entry is dropped and the server's row is used; anything else —
 * still in flight, or settled while this fetch was outstanding — is put back over the top.
 */
export function applyPendingTransactionUpdates(rows: Transaction[], fetchStartedAt: number): Transaction[] {
 if (pendingUpdates.size === 0) return rows;

 const now = Date.now();
 for (const [key, entry] of pendingUpdates) {
  // Strictly before: the snapshot can only be trusted to contain a write that had already
  // finished when the request went out, and `Date.now()` is millisecond-grained, so a tie is
  // genuinely unknown. Holding one more cycle costs nothing — the next resync drops it — while
  // guessing wrong is the flicker this exists to prevent.
  const alreadyInSnapshot = entry.settledAt != null && entry.settledAt < fetchStartedAt;
  if (alreadyInSnapshot || now - entry.startedAt > PENDING_UPDATE_MAX_AGE_MS) pendingUpdates.delete(key);
 }
 if (pendingUpdates.size === 0) return rows;

 // Re-key through canonicalTransactionKey: a row edited before its create landed was registered
 // under the temporary id, while the snapshot now carries the real one.
 const byId = new Map<number, PendingUpdate>();
 for (const [key, entry] of pendingUpdates) byId.set(canonicalTransactionKey(key), entry);

 return rows.map((row) => {
  const entry = byId.get(canonicalTransactionKey(row.id));
  // The snapshot's own id is kept: the overlay may predate the temp -> real id swap.
  return entry ? { ...row, ...entry.row, id: row.id } : row;
 });
}

/**
 * The latest timestamp handed out for a day by a create that hasn't reached the cache yet.
 *
 * nextCreatedAtForDate reads the transactions array captured in the render closure, so two
 * entries saved a moment apart can both be timed against a list that has neither of them —
 * landing on the same createdAt for a past-dated day. Distinct timestamps are what give the
 * ledger room to reorder rows between each other.
 */
const createdAtFloorByDay = new Map<string, number>();

export function notePendingCreatedAt(dateKey: string, epoch: number): void {
 const current = createdAtFloorByDay.get(dateKey);
 if (current == null || epoch > current) createdAtFloorByDay.set(dateKey, epoch);
}

export function pendingCreatedAtFloor(dateKey: string): number | null {
 return createdAtFloorByDay.get(dateKey) ?? null;
}

/** Test seam: drops all in-memory state so cases can't leak into each other. */
export function resetPendingTransactionWrites(): void {
 pendingByTempId.clear();
 realIdByTempId.clear();
 pendingUpdates.clear();
 writeChains.clear();
 createdAtFloorByDay.clear();
 lastTempId = TEMP_TRANSACTION_ID_MIN;
 updateSeq = 0;
}
