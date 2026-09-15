import { useLedgerStore } from '@/features/ledger/store/ledgerStore';
import { useTransactionsStore } from '@/features/transactions/store/transactionsStore';

/**
 * Moving every trace of a row from its temporary id to the real one the server assigned — or
 * erasing them when the create failed and the row is going away.
 *
 * A created row is on screen and clickable for the moment its write is in flight, so anything
 * the user does to it in that window lands under the temporary id: a selection tick, an opened
 * editor with typed values, a highlight. When the id changes, every one of those has to come
 * with it, or the user's next action silently targets a row that no longer exists.
 *
 * Both directions live in ONE table so they cannot drift: the likeliest bug here is the failure
 * path forgetting an entry the success path remaps.
 *
 * What is deliberately NOT here, and why:
 *  - `copiedTransaction` — read only as a form template; its id is never sent anywhere.
 *  - drag-lifetime keys (`dragRowId`, `dragLedgerRowKey`, hover keys) — cleared on drop and
 *    re-derived from the DOM.
 *  - `flashLedgerEntry` — a self-expiring deep link from the review list, which only ever names
 *    rows that already exist on the server.
 *  - the PDF/commission modals' `fromEntryKey`/`toEntryKey` — note these use a DIFFERENT key
 *    format (`t-${id}`, see ledgerEntryKey) than the draft keys below, so a future "remap
 *    everything with a colon" pass would miss them. They are opened from live rows by an
 *    explicit action, so a boundary cannot predate the swap, and a miss already falls back to
 *    the whole date window.
 *  - React Query's transactionHistory key — that query only runs when the history section is
 *    expanded, and re-renders under the real id.
 */

// Ledger keys are `${transactionId}:${accountId}` (getLedgerTransactionDraftKey), sometimes with
// a `:2` suffix for the second expense slot. A transaction sits in TWO ledgers, so the account
// part has to be left alone and matched for any value.
function remapLedgerKey(key: string, tempId: number, realId: number): string {
 const separator = key.indexOf(':');
 if (separator === -1) return key;
 return Number(key.slice(0, separator)) === tempId ? `${realId}${key.slice(separator)}` : key;
}

function keyBelongsTo(key: string, id: number): boolean {
 const separator = key.indexOf(':');
 return separator !== -1 && Number(key.slice(0, separator)) === id;
}

function remapNumberSet(set: Set<number>, tempId: number, realId: number): Set<number> {
 if (!set.has(tempId)) return set;
 const next = new Set(set);
 next.delete(tempId);
 next.add(realId);
 return next;
}

function remapKeySet(set: Set<string>, tempId: number, realId: number): Set<string> {
 let changed = false;
 const next = new Set<string>();
 for (const key of set) {
  const mapped = remapLedgerKey(key, tempId, realId);
  if (mapped !== key) changed = true;
  next.add(mapped);
 }
 return changed ? next : set;
}

function remapNumberRecord<T>(record: Record<number, T>, tempId: number, realId: number, patch?: (value: T) => T): Record<number, T> {
 const existing = record[tempId];
 if (existing === undefined) return record;
 const next = { ...record };
 delete next[tempId];
 next[realId] = patch ? patch(existing) : existing;
 return next;
}

function remapKeyRecord<T>(record: Record<string, T>, tempId: number, realId: number, patch?: (value: T) => T): Record<string, T> {
 let changed = false;
 const next: Record<string, T> = {};
 for (const [key, value] of Object.entries(record)) {
  const mapped = remapLedgerKey(key, tempId, realId);
  if (mapped !== key) changed = true;
  next[mapped] = mapped !== key && patch ? patch(value) : value;
 }
 return changed ? next : record;
}

/** The real id has arrived: carry everything the user may have done to the row across to it. */
export function remapTransactionId(tempId: number, realId: number): void {
 const tx = useTransactionsStore.getState();
 // Feeds a write: an edit opened on the new row must save against the real id.
 if (tx.editingTransaction?.id === tempId) tx.setEditingTransaction({ ...tx.editingTransaction, id: realId });
 if (tx.editingArchiveEntry?.id === tempId) tx.setEditingArchiveEntry({ ...tx.editingArchiveEntry, id: realId });
 // Feeds a write: a bulk delete reads straight out of this set.
 tx.setSelectedTransactionIds((prev) => remapNumberSet(prev, tempId, realId));
 tx.setEditingRowIds((prev) => remapNumberSet(prev, tempId, realId));
 tx.setTransactionTableDrafts((prev) => remapNumberRecord(prev, tempId, realId, (draft) => ({ ...draft, transactionId: realId })));
 tx.setManualRowOrder((prev) => (prev && prev.includes(tempId) ? prev.map((id) => (id === tempId ? realId : id)) : prev));
 // Changes a DISPLAYED exchange rate (r vs 1/r), so losing one is a correctness bug, not cosmetic.
 tx.setTableRateFromReversed((prev) => remapNumberRecord(prev, tempId, realId));
 tx.setTableRateToReversed((prev) => remapNumberRecord(prev, tempId, realId));
 tx.setCommissionExpandedTxns((prev) => remapNumberSet(prev, tempId, realId));
 tx.setExpensesExpandedTxns((prev) => remapNumberSet(prev, tempId, realId));
 tx.setExpensesExpandedTxns2((prev) => remapNumberSet(prev, tempId, realId));
 if (tx.infoTransactionId === tempId) tx.setInfoTransactionId(realId);

 const ledger = useLedgerStore.getState();
 // The draft carries the id inside it as well as in its key — both have to move, or the save
 // looks the draft up by key and the transaction up by id and silently finds a mismatch.
 ledger.setLedgerTransactionDrafts((prev) => remapKeyRecord(prev, tempId, realId, (draft) => ({ ...draft, transactionId: realId })));
 ledger.setEditingLedgerRowKeys((prev) => remapKeySet(prev, tempId, realId));
 ledger.setSelectedLedgerEntryKeys((prev) => remapKeySet(prev, tempId, realId));
 // Drives the running-total readout; a dropped key shows a wrong sum with nothing to say so.
 ledger.setLedgerSumSelection((prev) => remapKeySet(prev, tempId, realId));
 ledger.setLedgerExpensesExpandedKeys((prev) => remapKeySet(prev, tempId, realId));
 ledger.setLedgerRateReversed((prev) => remapKeyRecord(prev, tempId, realId));
 ledger.setLedgerDisplayRateReversed((prev) => remapKeyRecord(prev, tempId, realId));
 ledger.setHighlightedLedgerRows((prev) => {
  let changed = false;
  const next = new Map<string, string>();
  for (const [key, color] of prev) {
   const mapped = remapLedgerKey(key, tempId, realId);
   if (mapped !== key) changed = true;
   next.set(mapped, color);
  }
  return changed ? next : prev;
 });
}

/** The create failed and the row is being removed: drop everything that pointed at it. */
export function forgetTransactionId(tempId: number): void {
 const tx = useTransactionsStore.getState();
 if (tx.editingTransaction?.id === tempId) tx.setEditingTransaction(null);
 if (tx.editingArchiveEntry?.id === tempId) tx.setEditingArchiveEntry(null);
 const dropFromSet = (prev: Set<number>) => {
  if (!prev.has(tempId)) return prev;
  const next = new Set(prev);
  next.delete(tempId);
  return next;
 };
 const dropFromRecord = <T,>(prev: Record<number, T>) => {
  if (prev[tempId] === undefined) return prev;
  const next = { ...prev };
  delete next[tempId];
  return next;
 };
 tx.setSelectedTransactionIds(dropFromSet);
 tx.setEditingRowIds(dropFromSet);
 tx.setTransactionTableDrafts(dropFromRecord);
 tx.setManualRowOrder((prev) => (prev && prev.includes(tempId) ? prev.filter((id) => id !== tempId) : prev));
 tx.setTableRateFromReversed(dropFromRecord);
 tx.setTableRateToReversed(dropFromRecord);
 tx.setCommissionExpandedTxns(dropFromSet);
 tx.setExpensesExpandedTxns(dropFromSet);
 tx.setExpensesExpandedTxns2(dropFromSet);
 if (tx.infoTransactionId === tempId) tx.setInfoTransactionId(null);

 const ledger = useLedgerStore.getState();
 const dropKeysFromSet = (prev: Set<string>) => {
  const next = new Set([...prev].filter((key) => !keyBelongsTo(key, tempId)));
  return next.size === prev.size ? prev : next;
 };
 const dropKeysFromRecord = <T,>(prev: Record<string, T>) => {
  const entries = Object.entries(prev).filter(([key]) => !keyBelongsTo(key, tempId));
  return entries.length === Object.keys(prev).length ? prev : Object.fromEntries(entries);
 };
 ledger.setLedgerTransactionDrafts(dropKeysFromRecord);
 ledger.setEditingLedgerRowKeys(dropKeysFromSet);
 ledger.setSelectedLedgerEntryKeys(dropKeysFromSet);
 ledger.setLedgerSumSelection(dropKeysFromSet);
 ledger.setLedgerExpensesExpandedKeys(dropKeysFromSet);
 ledger.setLedgerRateReversed(dropKeysFromRecord);
 ledger.setLedgerDisplayRateReversed(dropKeysFromRecord);
 ledger.setHighlightedLedgerRows((prev) => {
  const next = new Map([...prev].filter(([key]) => !keyBelongsTo(key, tempId)));
  return next.size === prev.size ? prev : next;
 });
}
