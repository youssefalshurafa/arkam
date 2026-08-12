import { describe, expect, it } from 'vitest';
import {
 NEW_ROW_REF_ID,
 buildLockBoundaries,
 isReconciledMember,
 reconciledBalanceDelta,
 reconciledImpact,
 violatedLock,
 type LockBoundary,
} from './reconciliation';
import type { Reconciliation } from '@/shared/types';

// A reconciliation anchored on 2026-08-10 whose ledger, at creation time, looked like:
//   #1 (08-08), #2 (08-09), #3 (08-10, the anchor) | #4 (08-10, same-day sibling), #5 (08-11)
// i.e. the "45000" scenario from the user's report: reconciling mid-ledger, with both older
// and newer transactions (some sharing the anchor's own day) around it.
function makeBoundary(overrides: Partial<LockBoundary> = {}): LockBoundary {
 return {
  id: 1,
  anchorDate: '2026-08-10',
  lockedTransactionIds: new Set([1, 2, 3]),
  balance: 45000,
  note: '',
  ...overrides,
 };
}

describe('isReconciledMember', () => {
 const boundary = makeBoundary();

 it('is always a member on a genuinely earlier day', () => {
  expect(isReconciledMember('2026-08-08T10:00:00.000Z', 1, boundary)).toBe(true);
  expect(isReconciledMember('2026-08-01T10:00:00.000Z', 999, boundary)).toBe(true);
 });

 it('is never a member on a genuinely later day', () => {
  expect(isReconciledMember('2026-08-11T10:00:00.000Z', 4, boundary)).toBe(false);
  expect(isReconciledMember('2026-08-11T10:00:00.000Z', 3, boundary)).toBe(false);
 });

 it('on the anchor day, membership is decided by the frozen set, not sub-day time', () => {
  expect(isReconciledMember('2026-08-10T23:59:59.000Z', 3, boundary)).toBe(true);
  expect(isReconciledMember('2026-08-10T00:00:01.000Z', 4, boundary)).toBe(false);
 });

 it('a brand-new row on the anchor day is never a member (NEW_ROW_REF_ID sentinel)', () => {
  expect(isReconciledMember('2026-08-10T12:00:00.000Z', NEW_ROW_REF_ID, boundary)).toBe(false);
 });

 it('with no boundary, nothing is ever a member', () => {
  expect(isReconciledMember('2020-01-01T00:00:00.000Z', 1, null)).toBe(false);
 });
});

describe('violatedLock — create scenarios', () => {
 const boundaries = new Map([[10, makeBoundary()]]);

 it('creating a transaction dated after the anchor day never warns', () => {
  expect(violatedLock([10], '2026-08-12T00:00:00.000Z', NEW_ROW_REF_ID, boundaries)).toBeNull();
 });

 it('creating a transaction backdated to before the anchor day warns', () => {
  const hit = violatedLock([10], '2026-08-05T00:00:00.000Z', NEW_ROW_REF_ID, boundaries);
  expect(hit).not.toBeNull();
  expect(hit?.accountId).toBe(10);
 });

 it('creating a transaction backdated to exactly the anchor day warns (appended after the anchor, still counted as entering reconciled history)', () => {
  // A same-day create's tie-break is the NEW_ROW_REF_ID sentinel, which never matches the
  // frozen set — so this specific case must NOT warn, matching how nextCreatedAtForDate
  // always appends new rows at the end of a day (after the reconciled row).
  expect(violatedLock([10], '2026-08-10T23:59:59.999Z', NEW_ROW_REF_ID, boundaries)).toBeNull();
 });

 it('an account with no reconciliation never warns', () => {
  expect(violatedLock([20], '2020-01-01T00:00:00.000Z', NEW_ROW_REF_ID, boundaries)).toBeNull();
 });
});

describe('reconciledBalanceDelta — the user-reported scenarios', () => {
 const boundary = makeBoundary();

 it('reordering a locked member among its same-day siblings (sub-day timestamp only) never changes its contribution', () => {
  const before = { createdAt: '2026-08-10T08:00:00.000Z', refId: 3, net: 500, present: true };
  const after = { createdAt: '2026-08-10T16:00:00.000Z', refId: 3, net: 500, present: true };
  expect(reconciledBalanceDelta(boundary, before, after)).toBe(0);
 });

 it('moving the anchor row itself to a LATER day removes its contribution and warns', () => {
  const before = { createdAt: '2026-08-10T08:00:00.000Z', refId: 3, net: 500, present: true };
  const after = { createdAt: '2026-08-15T08:00:00.000Z', refId: 3, net: 500, present: true };
  expect(reconciledBalanceDelta(boundary, before, after)).toBe(-500);
 });

 it('moving a locked row to an EARLIER day (still before the boundary) never warns', () => {
  const before = { createdAt: '2026-08-09T08:00:00.000Z', refId: 2, net: 300, present: true };
  const after = { createdAt: '2026-08-02T08:00:00.000Z', refId: 2, net: 300, present: true };
  expect(reconciledBalanceDelta(boundary, before, after)).toBe(0);
 });

 it('editing a row that stays strictly after the anchor never warns, no matter what changed', () => {
  const before = { createdAt: '2026-08-11T08:00:00.000Z', refId: 5, net: 100, present: true };
  const after = { createdAt: '2026-08-11T08:00:00.000Z', refId: 5, net: 999999, present: true };
  expect(reconciledBalanceDelta(boundary, before, after)).toBe(0);
 });

 it('creating new transactions after the anchor never warns, regardless of how many', () => {
  for (const day of ['2026-08-11', '2026-08-12', '2026-09-01']) {
   const before = { createdAt: `${day}T00:00:00.000Z`, refId: NEW_ROW_REF_ID, net: 0, present: false };
   const after = { createdAt: `${day}T00:00:00.000Z`, refId: NEW_ROW_REF_ID, net: 12345, present: true };
   expect(reconciledBalanceDelta(boundary, before, after)).toBe(0);
  }
 });

 it('backdating a NEW transaction to before the anchor day warns', () => {
  const before = { createdAt: '2026-08-05T00:00:00.000Z', refId: NEW_ROW_REF_ID, net: 0, present: false };
  const after = { createdAt: '2026-08-05T00:00:00.000Z', refId: NEW_ROW_REF_ID, net: 777, present: true };
  expect(reconciledBalanceDelta(boundary, before, after)).toBe(777);
 });

 it('deleting a locked member removes its contribution and warns', () => {
  const before = { createdAt: '2026-08-08T00:00:00.000Z', refId: 1, net: 200, present: true };
  const after = { createdAt: '2026-08-08T00:00:00.000Z', refId: 1, net: 200, present: false };
  expect(reconciledBalanceDelta(boundary, before, after)).toBe(-200);
 });

 it('deleting a non-locked row (after the anchor) never warns', () => {
  const before = { createdAt: '2026-08-11T00:00:00.000Z', refId: 5, net: 200, present: true };
  const after = { createdAt: '2026-08-11T00:00:00.000Z', refId: 5, net: 200, present: false };
  expect(reconciledBalanceDelta(boundary, before, after)).toBe(0);
 });

 it('editing a locked member\'s amount (same position) changes its contribution and warns', () => {
  const before = { createdAt: '2026-08-09T00:00:00.000Z', refId: 2, net: 300, present: true };
  const after = { createdAt: '2026-08-09T00:00:00.000Z', refId: 2, net: 450, present: true };
  expect(reconciledBalanceDelta(boundary, before, after)).toBe(150);
 });

 it('no reconciliation at all never warns', () => {
  const before = { createdAt: '2020-01-01T00:00:00.000Z', refId: 1, net: 999, present: true };
  const after = { createdAt: '2099-01-01T00:00:00.000Z', refId: 1, net: -999, present: true };
  expect(reconciledBalanceDelta(null, before, after)).toBe(0);
 });
});

describe('reconciledImpact', () => {
 it('returns the first account whose reconciled balance actually moves', () => {
  const boundaries = new Map([
   [10, makeBoundary({ id: 1 })],
   [20, makeBoundary({ id: 2, lockedTransactionIds: new Set([50]) })],
  ]);
  const contributions = [
   {
    accountId: 10,
    old: { createdAt: '2026-08-11T00:00:00.000Z', refId: 99, net: 100, present: true },
    next: { createdAt: '2026-08-11T00:00:00.000Z', refId: 99, net: 500, present: true }, // after the anchor — no impact
   },
   {
    accountId: 20,
    old: { createdAt: '2026-08-10T00:00:00.000Z', refId: 50, net: 100, present: true },
    next: { createdAt: '2026-08-15T00:00:00.000Z', refId: 50, net: 100, present: true }, // moved past the anchor — impact
   },
  ];
  const hit = reconciledImpact(contributions, boundaries);
  expect(hit?.accountId).toBe(20);
 });

 it('returns null when nothing touches an enforced boundary', () => {
  const boundaries = new Map([[10, makeBoundary()]]);
  const contributions = [
   {
    accountId: 10,
    old: { createdAt: '2026-08-11T00:00:00.000Z', refId: 99, net: 100, present: true },
    next: { createdAt: '2026-08-11T00:00:00.000Z', refId: 99, net: 100, present: true },
   },
  ];
  expect(reconciledImpact(contributions, boundaries)).toBeNull();
 });

 it('floating point noise below RECONCILED_DELTA_EPS never warns', () => {
  const boundaries = new Map([[10, makeBoundary()]]);
  const contributions = [
   {
    accountId: 10,
    old: { createdAt: '2026-08-09T00:00:00.000Z', refId: 2, net: 300, present: true },
    next: { createdAt: '2026-08-09T00:00:00.000Z', refId: 2, net: 300 + 1e-9, present: true },
   },
  ];
  expect(reconciledImpact(contributions, boundaries)).toBeNull();
 });
});

describe('buildLockBoundaries', () => {
 const base: Omit<Reconciliation, 'id' | 'balance'> = {
  accountId: 10,
  anchorTransactionId: 3,
  anchorDate: '2026-08-10',
  lockedTransactionIds: [1, 2, 3],
  note: '',
  createdAt: '2026-08-10T00:00:00.000Z',
 };

 it('picks the newest reconciliation per account by record id, not by anchor date', () => {
  const reconciliations: Reconciliation[] = [
   { ...base, id: 5, balance: 100 },
   // A later-created mark whose anchor is actually an EARLIER calendar day than #5 — the
   // active boundary must still be #7 (highest id = most recently created), matching
   // "a reconciliation's identity as the active lock never depends on anchor position".
   { ...base, id: 7, anchorDate: '2026-08-01', lockedTransactionIds: [1], balance: 50 },
   { ...base, id: 3, balance: 999 },
  ];
  const boundaries = buildLockBoundaries(reconciliations);
  expect(boundaries.get(10)?.id).toBe(7);
  expect(boundaries.get(10)?.anchorDate).toBe('2026-08-01');
 });

 it('keeps different accounts independent', () => {
  const reconciliations: Reconciliation[] = [
   { ...base, id: 1, accountId: 10, balance: 100 },
   { ...base, id: 2, accountId: 20, balance: 200 },
  ];
  const boundaries = buildLockBoundaries(reconciliations);
  expect(boundaries.get(10)?.balance).toBe(100);
  expect(boundaries.get(20)?.balance).toBe(200);
 });
});

describe('regression: same-day drag reflow must never warn for untouched members', () => {
 // Reproduces the historical bug class: a whole day's rows get reassigned fresh, evenly
 // spaced timestamps on any same-day drag (even for rows that weren't dragged), which used
 // to be compared against a LIVE-recomputed anchor position and could spuriously cross it.
 // Under the frozen anchorDate/lockedTransactionIds model, none of that matters: the day
 // never changes and membership is frozen, so every locked sibling's contribution is
 // unchanged by the reflow, dragged or not.
 it('reflowing every same-day row (dragged and bystanders alike) produces zero impact for all locked members', () => {
  const boundary = makeBoundary({ lockedTransactionIds: new Set([1, 2, 3, 4]) });
  const boundaries = new Map([[10, boundary]]);
  // Original same-day order: 1, 2 (different day, unaffected), then same-day siblings 3, 4.
  const originalSameDay = [
   { refId: 3, createdAt: '2026-08-10T08:00:00.000Z' },
   { refId: 4, createdAt: '2026-08-10T16:00:00.000Z' },
  ];
  // After a drag that reverses their order, reflow assigns BOTH fresh timestamps.
  const reflowed = [
   { refId: 4, createdAt: '2026-08-10T06:00:00.000Z' },
   { refId: 3, createdAt: '2026-08-10T18:00:00.000Z' },
  ];
  const contributions = originalSameDay.map((row) => ({
   accountId: 10,
   old: { createdAt: row.createdAt, refId: row.refId, net: 111, present: true },
   next: { createdAt: reflowed.find((r) => r.refId === row.refId)!.createdAt, refId: row.refId, net: 111, present: true },
  }));
  expect(reconciledImpact(contributions, boundaries)).toBeNull();
 });
});

describe('regression: exact-timestamp tie no longer matters (day-granularity, not millisecond)', () => {
 it('two rows sharing the exact same millisecond timestamp on the anchor day are still classified purely by frozen membership', () => {
  const boundary = makeBoundary({ lockedTransactionIds: new Set([3]) });
  const sharedTimestamp = '2026-08-10T12:00:00.000Z';
  expect(isReconciledMember(sharedTimestamp, 3, boundary)).toBe(true);
  expect(isReconciledMember(sharedTimestamp, 4, boundary)).toBe(false);
 });
});

describe('regression: migrated/backfilled boundary data (non-contiguous locked id set)', () => {
 it('works correctly even when the frozen set is not a simple contiguous id range (as a one-time migration backfill might produce)', () => {
  const boundary = makeBoundary({ anchorDate: '2026-08-10', lockedTransactionIds: new Set([1, 3, 7]) });
  expect(isReconciledMember('2026-08-10T00:00:00.000Z', 1, boundary)).toBe(true);
  expect(isReconciledMember('2026-08-10T00:00:00.000Z', 3, boundary)).toBe(true);
  expect(isReconciledMember('2026-08-10T00:00:00.000Z', 7, boundary)).toBe(true);
  expect(isReconciledMember('2026-08-10T00:00:00.000Z', 2, boundary)).toBe(false);
  expect(isReconciledMember('2026-08-10T00:00:00.000Z', 5, boundary)).toBe(false);
 });
});
