/**
 * Tracking for writes the UI no longer waits on.
 *
 * Saves across the app are optimistic: the row is patched, the editor closes, and the request
 * goes out behind it (see onSaveLedgerTransaction, onTransactionSubmit). That window is short,
 * but this is accounting data — closing the tab inside it would drop the edit with nothing on
 * screen to suggest it hadn't landed. Counting what is still in flight lets the browser ask
 * before unloading, and the listener only exists while something is genuinely pending.
 *
 * Module-level rather than per-hook: the ledger and the transactions form both save in the
 * background, and a counter each would mean two listeners, each blind to the other's writes.
 */

let pendingWrites = 0;

// One stable listener identity for the process's whole life — a fresh closure per call would be
// added under one identity and removed under another, leaving the warning armed forever.
const warnOnUnload = (event: BeforeUnloadEvent) => event.preventDefault();

export function trackPendingWrite<T>(request: Promise<T>): Promise<T> {
 if (typeof window !== 'undefined' && pendingWrites === 0) window.addEventListener('beforeunload', warnOnUnload);
 pendingWrites += 1;
 return request.finally(() => {
  pendingWrites -= 1;
  if (typeof window !== 'undefined' && pendingWrites === 0) window.removeEventListener('beforeunload', warnOnUnload);
 });
}

/** How many optimistic writes are still on the wire. For tests, and for any future "saving…" hint. */
export function pendingWriteCount(): number {
 return pendingWrites;
}
