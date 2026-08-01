import type { ClientLedgerEntry, Reconciliation } from '@/shared/types';

/**
 * The effective lock line for one client account: the newest reconciliation on it.
 * `anchorCreatedAt` + `anchorRefId` reproduce the ledger's (createdAt, id) sort order,
 * so any entry at or before this point is considered reconciled/locked.
 */
export type LockBoundary = {
 anchorCreatedAt: string;
 anchorRefId: number;
 balance: number;
 note: string;
};

// The id used to order an entry within a single timestamp, matching the ledger sort tie-break
// in computeClientLedgers — every entry is backed by a real Transaction row now.
export function reconciliationRefId(entry: Pick<ClientLedgerEntry, 'transactionId'>): number {
 return entry.transactionId;
}

// Live createdAt per anchor row, keyed `transaction:${anchorRefId}`. A reconciliation's
// `anchorCreatedAt` is a one-time snapshot taken when the mark was created; drag-to-reorder
// (onLedgerRowDrop) later reflows the createdAt of every row sharing the anchor's date —
// including rows that weren't even dragged — to keep them evenly spaced in the new order, so
// that snapshot silently goes stale the moment anything on the anchor's day gets reordered.
// Passing this lookup into `buildLockBoundaries` makes every boundary re-resolve its anchor's
// CURRENT position instead of trusting the frozen snapshot, so the locked/unlocked split
// self-heals after a reorder rather than drifting out of sync with it.
export type LiveAnchorTimes = Map<string, string>;

export function buildLiveAnchorTimes(transactions: Array<{ id: number; createdAt: string }>): LiveAnchorTimes {
 const map: LiveAnchorTimes = new Map();
 for (const tx of transactions) map.set(`transaction:${tx.id}`, tx.createdAt);
 return map;
}

// Newest reconciliation per account id. "Newest" uses the same ordering as the ledger:
// later anchorCreatedAt wins, breaking ties by the higher anchorRefId. `liveAnchorTimes`
// (see above) overrides each anchor's stored createdAt snapshot with its current one when
// available, so the boundary always reflects the anchor row's true current position.
export function buildLockBoundaries(reconciliations: Reconciliation[], liveAnchorTimes?: LiveAnchorTimes): Map<number, LockBoundary> {
 const byAccount = new Map<number, LockBoundary>();
 for (const rec of reconciliations) {
  const candidate: LockBoundary = {
   anchorCreatedAt: liveAnchorTimes?.get(`${rec.anchorKind}:${rec.anchorRefId}`) ?? rec.anchorCreatedAt,
   anchorRefId: rec.anchorRefId,
   balance: rec.balance,
   note: rec.note,
  };
  const existing = byAccount.get(rec.accountId);
  if (!existing || isAfterBoundary(candidate.anchorCreatedAt, candidate.anchorRefId, existing)) {
   byAccount.set(rec.accountId, candidate);
  }
 }
 return byAccount;
}

// True when (createdAt, refId) sorts strictly after the boundary row.
function isAfterBoundary(createdAt: string, refId: number, boundary: LockBoundary): boolean {
 const a = new Date(createdAt).getTime();
 const b = new Date(boundary.anchorCreatedAt).getTime();
 if (a !== b) return a > b;
 return refId > boundary.anchorRefId;
}

/**
 * True when a row at (createdAt, refId) lands at or before the lock line — i.e. the
 * operation would touch reconciled history and should warn. Pass `refId` as a very
 * large number for a brand-new row (it gets the highest id, so at an equal timestamp
 * it sorts after the boundary and is not locked; only a strictly older date warns).
 */
export function isAtOrBeforeBoundary(createdAt: string, refId: number, boundary: LockBoundary | null | undefined): boolean {
 if (!boundary) return false;
 return !isAfterBoundary(createdAt, refId, boundary);
}

// The largest refId sentinel for a not-yet-created row (see isAtOrBeforeBoundary).
export const NEW_ROW_REF_ID = Number.MAX_SAFE_INTEGER;

// Below this magnitude a reconciled-balance change is treated as zero (floating-point noise).
export const RECONCILED_DELTA_EPS = 1e-6;

// State of one row's contribution to a single account's balance, before or after a change.
// `present` is false when the row doesn't touch the account (e.g. it was deleted, or the
// edited row no longer references this account).
export type RowContribution = { createdAt: string; refId: number; net: number; present: boolean };

/**
 * How much a change shifts an account's RECONCILED balance (the running balance at its lock
 * anchor). A row contributes its net change to that balance only while it sits at or before
 * the anchor, so the delta is the new contribution minus the old one. Returns 0 when there's
 * no reconciliation, or when the change nets out at the anchor (e.g. editing a row that stays
 * strictly after the anchor, or moving a zero-net row across it) — those must not warn.
 */
export function reconciledBalanceDelta(boundary: LockBoundary | null | undefined, oldState: RowContribution, newState: RowContribution): number {
 if (!boundary) return 0;
 const oldContribution = oldState.present && isAtOrBeforeBoundary(oldState.createdAt, oldState.refId, boundary) ? oldState.net : 0;
 const newContribution = newState.present && isAtOrBeforeBoundary(newState.createdAt, newState.refId, boundary) ? newState.net : 0;
 return newContribution - oldContribution;
}

/**
 * The first account whose reconciled balance a change actually moves, or null if none do.
 * `contributions` gives, per touched account, that row's before/after contribution state.
 * Used by the edit/create/delete/move guards so they warn only when the saved reconciled
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
 * independently), or null if the change touches no locked history.
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
  if (boundary && isAtOrBeforeBoundary(createdAt, refId, boundary)) return { accountId, boundary };
 }
 return null;
}
