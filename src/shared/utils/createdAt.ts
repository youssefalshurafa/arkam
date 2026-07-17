import type { ClientAdjustment, Transaction } from '@/shared/types';
import { localDateKey, localWallClock, parseLocalWallClock } from '@/shared/utils/date';

/**
 * Timestamp for a newly created transaction/adjustment dated `dateStr`.
 *
 * When `dateStr` is TODAY, the real current local time is used so displayed times are
 * accurate (the row still sorts to the top of today because real time advances past
 * earlier same-day rows). In the rare case a same-day row was drag-reordered to a time
 * later than "now", we fall back to just after that row so the new entry still lands at
 * the END of the day's sequence — the top of the descending transactions table and the
 * bottom of the ascending client ledger.
 *
 * For a past/future `dateStr` there is no meaningful "now", so we place the row one second
 * after the last existing row on that day (capped at end-of-day). All values are emitted as
 * local wall-clock strings (see localWallClock) so the stored/displayed time is the local
 * time and the embedded date matches the user's calendar day.
 */
export function nextCreatedAtForDate(dateStr: string, transactions: Transaction[], adjustments: ClientAdjustment[]): string {
 let maxEpoch = -Infinity;
 for (const tx of transactions) {
  if (tx.createdAt.slice(0, 10) === dateStr) {
   const e = parseLocalWallClock(tx.createdAt);
   if (Number.isFinite(e)) maxEpoch = Math.max(maxEpoch, e);
  }
 }
 for (const adj of adjustments) {
  if (adj.createdAt.slice(0, 10) === dateStr) {
   const e = parseLocalWallClock(adj.createdAt);
   if (Number.isFinite(e)) maxEpoch = Math.max(maxEpoch, e);
  }
 }

 if (dateStr === localDateKey()) {
  const now = Date.now();
  const next = Number.isFinite(maxEpoch) ? Math.max(now, maxEpoch + 1000) : now;
  return localWallClock(new Date(next));
 }

 // Local (no Z) day bounds so the emitted wall-clock date stays === dateStr regardless
 // of timezone offset.
 const dayStart = Date.parse(`${dateStr}T00:00:00.000`);
 const dayEnd = Date.parse(`${dateStr}T23:59:59.999`);
 const base = Number.isFinite(maxEpoch) ? Math.max(maxEpoch, dayStart) : dayStart;
 const next = Math.min(base + 1000, dayEnd);
 return localWallClock(new Date(next));
}

/**
 * Preserves the original time-of-day when only the date part of a draft
 * changed, so sort order among same-day entries never shifts on an edit that
 * didn't intend to reorder anything.
 */
export function resolveCreatedAt(draftDate: string, originalCreatedAt: string): string {
 const originalDate = originalCreatedAt.slice(0, 10);
 if (draftDate === originalDate) {
  return originalCreatedAt;
 }
 const sep = originalCreatedAt.includes('T') ? 'T' : ' ';
 const timePart = originalCreatedAt.includes(sep) ? originalCreatedAt.split(sep)[1] : '00:00:00';
 return `${draftDate} ${timePart}`;
}
