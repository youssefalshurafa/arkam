import type { ClientLedgerEntry, Reconciliation } from '@/shared/types';

/**
 * The effective lock line for one client account: the newest reconciliation on it.
 *
 * `lockedRefIds`, when present, is the FIXED set of transaction ids captured once at
 * reconciliation time — membership in it is permanent and independent of any row's current
 * position, so reordering rows within it (even the anchor's own row) never changes what's
 * locked. `anchorCreatedAt` + `anchorRefId` still matter as a cutoff for rows that aren't in
 * the set at all (a brand-new transaction, or an existing one created after this
 * reconciliation) — inserting or re-dating one of those to sit at-or-before that cutoff still
 * warns, since that would insert into recorded history that wasn't part of the frozen set. For
 * a new-style boundary this cutoff is NOT frozen at creation time — it's re-resolved to
 * whichever locked member currently sits latest (see `buildLockBoundaries`), because a drag
 * reflow spreads a whole day's rows across evenly-spaced timestamps that bear no relation to
 * the original few-seconds-after-midnight snapshot, which would otherwise permanently strand
 * the cutoff in the past the moment any drag ever touched that day.
 *
 * `lockedRefIds` is null for reconciliations created before this field existed; those fall back
 * entirely to the older (createdAt, refId) position comparison against the anchor, exactly as
 * before, until they're lazily backfilled the next time their account's ledger loads.
 */
export type LockBoundary = {
 id: number;
 anchorCreatedAt: string;
 anchorRefId: number;
 lockedRefIds: Set<number> | null;
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

// The cutoff timestamp used to judge non-members against this reconciliation (see LockBoundary
// doc comment above). Old-style: the anchor transaction's live position, same as ever. New-
// style: the LATEST live position among the fixed member set — self-consistently recomputed
// from current data every time, so it can never go stale the way a frozen one-time snapshot
// would once a drag reflow changes what "a few seconds after midnight" even means for that day.
// Falls back to the stored (possibly frozen) `anchorCreatedAt` when no live times are supplied.
function resolveAnchorCreatedAt(rec: Reconciliation, liveAnchorTimes?: LiveAnchorTimes): string {
 if (!rec.lockedRefIds) return liveAnchorTimes?.get(`${rec.anchorKind}:${rec.anchorRefId}`) ?? rec.anchorCreatedAt;
 if (!liveAnchorTimes) return rec.anchorCreatedAt;
 let latest = rec.anchorCreatedAt;
 for (const id of rec.lockedRefIds) {
  const t = liveAnchorTimes.get(`transaction:${id}`);
  if (t && t > latest) latest = t;
 }
 return latest;
}

// Newest reconciliation per account id, by the reconciliation record's OWN id (creation
// order) — not by anchor position. A reconciliation's identity as "the active lock" should
// never depend on where its anchor row currently sits; that self-reference is exactly what
// made an anchor's own reorder look like it was crossing itself.
export function buildLockBoundaries(reconciliations: Reconciliation[], liveAnchorTimes?: LiveAnchorTimes): Map<number, LockBoundary> {
 const byAccount = new Map<number, LockBoundary>();
 const newestId = new Map<number, number>();
 for (const rec of reconciliations) {
  const prevId = newestId.get(rec.accountId);
  if (prevId != null && prevId > rec.id) continue;
  newestId.set(rec.accountId, rec.id);
  byAccount.set(rec.accountId, {
   id: rec.id,
   anchorCreatedAt: resolveAnchorCreatedAt(rec, liveAnchorTimes),
   anchorRefId: rec.anchorRefId,
   lockedRefIds: rec.lockedRefIds ? new Set(rec.lockedRefIds) : null,
   balance: rec.balance,
   note: rec.note,
  });
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
 * operation would touch reconciled history and should warn.
 *
 * A row that's a permanent member of `boundary.lockedRefIds` is always locked, regardless of
 * its current date/position — that's the whole point of the fixed-set model. Everything else
 * (a brand-new row, an existing row created after this reconciliation, or any row at all when
 * the boundary is old-style with no set) falls back to the date/refId cutoff comparison. Pass
 * `refId` as a very large number for a brand-new row in that fallback (it gets the highest id,
 * so at an equal timestamp it sorts after the boundary and is not locked; only a strictly
 * older date warns).
 */
export function isAtOrBeforeBoundary(createdAt: string, refId: number, boundary: LockBoundary | null | undefined): boolean {
 if (!boundary) return false;
 if (boundary.lockedRefIds?.has(refId)) return true;
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
 *
 * Takes separate old/new boundaries (defaulting `newBoundary` to `oldBoundary`) because the
 * anchor row itself can move (e.g. a ledger drag reflows every same-date row, including the
 * anchor). Evaluating the "before" state against the anchor's old position and the "after"
 * state against its new position keeps a row's comparison to itself trivially zero — only a
 * REAL change in which rows sit at-or-before the anchor produces a nonzero delta.
 */
export function reconciledBalanceDelta(
 oldBoundary: LockBoundary | null | undefined,
 oldState: RowContribution,
 newState: RowContribution,
 newBoundary: LockBoundary | null | undefined = oldBoundary,
): number {
 const oldContribution = oldBoundary && oldState.present && isAtOrBeforeBoundary(oldState.createdAt, oldState.refId, oldBoundary) ? oldState.net : 0;
 const newContribution = newBoundary && newState.present && isAtOrBeforeBoundary(newState.createdAt, newState.refId, newBoundary) ? newState.net : 0;
 return newContribution - oldContribution;
}

/**
 * The first account whose reconciled balance a change actually moves, or null if none do.
 * `contributions` gives, per touched account, that row's before/after contribution state.
 * Used by the edit/create/delete/move guards so they warn only when the saved reconciled
 * balance would really change — not merely because a row sits at or before a lock line.
 *
 * `nextBoundaries` defaults to `boundaries` (the normal single-snapshot case). Pass a
 * separate post-change map when the change itself can move an anchor row (see
 * `reconciledBalanceDelta`) so each account's "after" state is judged against the anchor's
 * new position rather than its stale pre-change one.
 */
export function reconciledImpact(
 contributions: Array<{ accountId: number; old: RowContribution; next: RowContribution }>,
 boundaries: Map<number, LockBoundary>,
 nextBoundaries: Map<number, LockBoundary> = boundaries,
): { accountId: number; boundary: LockBoundary } | null {
 for (const { accountId, old, next } of contributions) {
  const boundary = boundaries.get(accountId);
  const newBoundary = nextBoundaries.get(accountId);
  if (!boundary && !newBoundary) continue;
  if (Math.abs(reconciledBalanceDelta(boundary, old, next, newBoundary)) > RECONCILED_DELTA_EPS) return { accountId, boundary: newBoundary ?? boundary! };
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
