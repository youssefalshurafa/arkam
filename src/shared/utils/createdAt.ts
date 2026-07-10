import type { ClientAdjustment, Transaction } from '@/shared/types';

/**
 * Places a newly created transaction/adjustment strictly after every existing row on
 * `dateStr`, so it lands at the END of that date's sequence: the top of the descending
 * transactions table and the bottom of the ascending client ledger. This keeps a new
 * entry with today's date at the very top even when other same-day rows were manually
 * drag-reordered (which rewrites their timestamps across the day).
 */
export function nextCreatedAtForDate(dateStr: string, transactions: Transaction[], adjustments: ClientAdjustment[]): string {
 const dayStart = Date.parse(`${dateStr}T00:00:00.000Z`);
 const dayEnd = Date.parse(`${dateStr}T23:59:59.999Z`);
 let maxEpoch = dayStart;
 for (const tx of transactions) {
  if (tx.createdAt.slice(0, 10) === dateStr) {
   const e = Date.parse(tx.createdAt);
   if (Number.isFinite(e)) maxEpoch = Math.max(maxEpoch, e);
  }
 }
 for (const adj of adjustments) {
  if (adj.createdAt.slice(0, 10) === dateStr) {
   const e = Date.parse(adj.createdAt);
   if (Number.isFinite(e)) maxEpoch = Math.max(maxEpoch, e);
  }
 }
 const next = Math.min(maxEpoch + 1000, dayEnd);
 return new Date(next).toISOString();
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
