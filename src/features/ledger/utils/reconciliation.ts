import type { ClientLedgerEntry, Reconciliation } from '@/shared/types';

/**
 * The effective lock line for one client account: the newest reconciliation on it.
 *
 * Both fields are frozen at creation time and NEVER re-derived from live data again —
 * this is the key property that keeps the boundary stable under drags/edits elsewhere in
 * the ledger. `anchorDate` is the calendar day (YYYY-MM-DD) the anchor row was on when
 * reconciled; `lockedTransactionIds` is the fixed set of every transaction id that sat at
 * or before the anchor at that moment. See `isReconciledMember` for how the two combine.
 */
export type LockBoundary = {
 id: number;
 anchorDate: string;
 lockedTransactionIds: Set<number>;
 balance: number;
 note: string;
};

// The id used to order an entry within a single day, matching the ledger sort tie-break in
// computeClientLedgers — every entry is backed by a real Transaction row.
export function reconciliationRefId(entry: Pick<ClientLedgerEntry, 'transactionId'>): number {
 return entry.transactionId;
}

// Newest reconciliation per account id, by the reconciliation record's OWN id (creation
// order) — not by anchor position. A reconciliation's identity as "the active lock" should
// never depend on where its anchor row currently sits.
export function buildLockBoundaries(reconciliations: Reconciliation[]): Map<number, LockBoundary> {
 const byAccount = new Map<number, LockBoundary>();
 const newestId = new Map<number, number>();
 for (const rec of reconciliations) {
  const prevId = newestId.get(rec.accountId);
  if (prevId != null && prevId > rec.id) continue;
  newestId.set(rec.accountId, rec.id);
  byAccount.set(rec.accountId, {
   id: rec.id,
   anchorDate: rec.anchorDate,
   lockedTransactionIds: new Set(rec.lockedTransactionIds),
   balance: rec.balance,
   note: rec.note,
  });
 }
 return byAccount;
}

/**
 * True when a row at (createdAt, refId) is part of the reconciled balance — i.e. an
 * operation touching it would move the agreed number and should warn.
 *
 * Day-granularity, not millisecond: a row on a genuinely earlier calendar day is always a
 * member; a row on a genuinely later day never is. Only rows sharing the anchor's exact
 * calendar day fall back to the frozen `lockedTransactionIds` set, since day alone can't
 * order same-day siblings. Because both `anchorDate` and `lockedTransactionIds` are frozen
 * constants (never re-resolved from live positions), this comparison is stable under any
 * later drag/reorder/edit elsewhere in the ledger — reordering same-day siblings never
 * changes any row's day or its frozen membership, so it can never flip this result.
 *
 * Pass `refId` as a very large sentinel (`NEW_ROW_REF_ID`) for a not-yet-created row: it's
 * never a member of the frozen set, so on the anchor's own day it correctly resolves to
 * "not a member" (matching how new rows are actually appended at the end of a day).
 */
export function isReconciledMember(createdAt: string, refId: number, boundary: LockBoundary | null | undefined): boolean {
 if (!boundary) return false;
 const rowDay = createdAt.slice(0, 10);
 if (rowDay !== boundary.anchorDate) return rowDay < boundary.anchorDate;
 return boundary.lockedTransactionIds.has(refId);
}

// The largest refId sentinel for a not-yet-created row (see isReconciledMember).
export const NEW_ROW_REF_ID = Number.MAX_SAFE_INTEGER;

// Below this magnitude a reconciled-balance change is treated as zero (floating-point noise).
export const RECONCILED_DELTA_EPS = 1e-6;

// State of one row's contribution to a single account's balance, before or after a change.
// `present` is false when the row doesn't touch the account (e.g. it was deleted, or the
// edited row no longer references this account).
export type RowContribution = { createdAt: string; refId: number; net: number; present: boolean };

/**
 * How much a change shifts an account's RECONCILED balance (the frozen agreed number). A
 * row contributes its net change to that balance only while it's a reconciled member, so
 * the delta is the new contribution minus the old one. Returns 0 when there's no
 * reconciliation, or when the change doesn't touch membership or amount for a member row
 * (e.g. editing a row that stays strictly after the anchor, or reordering members among
 * themselves) — those must not warn.
 */
export function reconciledBalanceDelta(boundary: LockBoundary | null | undefined, oldState: RowContribution, newState: RowContribution): number {
 const oldContribution = boundary && oldState.present && isReconciledMember(oldState.createdAt, oldState.refId, boundary) ? oldState.net : 0;
 const newContribution = boundary && newState.present && isReconciledMember(newState.createdAt, newState.refId, boundary) ? newState.net : 0;
 return newContribution - oldContribution;
}

/**
 * The first account whose reconciled balance a change actually moves, or null if none do.
 * `contributions` gives, per touched account, that row's before/after contribution state.
 * Used by every guard (edit/create/delete/move) so they warn only when the saved reconciled
 * balance would really change — not merely because a row sits at or before a lock line.
 */
export function reconciledImpact(
 contributions: Array<{ accountId: number; old: RowContribution; next: RowContribution }>,
 boundaries: Map<number, LockBoundary>,
): { accountId: number; boundary: LockBoundary } | null {
 for (const { accountId, old, next } of contributions) {
  const boundary = boundaries.get(accountId);
  if (!boundary) continue;
  if (Math.abs(reconciledBalanceDelta(boundary, old, next)) > RECONCILED_DELTA_EPS) return { accountId, boundary };
 }
 return null;
}

/**
 * Returns the first reconciliation boundary that a proposed change would violate,
 * checking every affected account (a transaction sits in two ledgers, each reconciled
 * independently), or null if the change touches no locked history. Used for create/delete
 * paths where there's no "old vs new net" to diff — the whole row is appearing/disappearing
 * at that position.
 */
export function violatedLock(
 accountIds: Array<number | null | undefined>,
 createdAt: string,
 refId: number,
 boundaries: Map<number, LockBoundary>,
): { accountId: number; boundary: LockBoundary } | null {
 for (const accountId of accountIds) {
  if (accountId == null) continue;
  const boundary = boundaries.get(accountId);
  if (boundary && isReconciledMember(createdAt, refId, boundary)) return { accountId, boundary };
 }
 return null;
}
