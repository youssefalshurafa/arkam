import { describe, expect, it } from 'vitest';
import { marksAffectedByReorder } from './reconciliation';

// A ledger's rows top-to-bottom, with running balances as the engine would render them.
function row(transactionId: number, netChange: number, runningBalance: number, markId?: number) {
 return { transactionId, netChange, runningBalance, reconciledMark: markId == null ? null : { id: markId } };
}

// Mirrors the reported ledger: a ✓ high up, several rows, then a second ✓ lower down.
//      id  net    running   mark
const A = row(1, -100, -100, 1); // ✓ #1 sits here
const B = row(2, -500, -600);
const C = row(3, -300, -900);
const D = row(4, -60, -960, 2); // ✓ #2 sits here
const E = row(5, -80, -1040);

function reorder(order: Array<ReturnType<typeof row>>) {
 // Recompute running balances for the proposed order, as the engine would.
 let running = 0;
 return order.map((entry) => {
  running += entry.netChange;
  return { ...entry, runningBalance: running };
 });
}

describe('marksAffectedByReorder', () => {
 it('is silent when two rows between the same pair of ✓ lines swap', () => {
  // The exact reported case: rows B and C both sit strictly between ✓ #1 and ✓ #2, so
  // neither mark's set of rows-above changes and no agreed balance moves.
  expect(marksAffectedByReorder([A, B, C, D, E], reorder([A, C, B, D, E]))).toEqual([]);
 });

 it('is silent when rows below the last ✓ are reordered', () => {
  expect(marksAffectedByReorder([A, B, C, D, E], reorder([A, B, C, D, E]))).toEqual([]);
 });

 it('is silent when the rows above a ✓ are reordered among themselves', () => {
  // ✓ #2's set is {1,2,3,4} either way — same rows, different order.
  const swapped = reorder([B, A, C, D, E]);
  const changes = marksAffectedByReorder([A, B, C, D, E], swapped);
  expect(changes.find((c) => c.id === 2)).toBeUndefined();
 });

 it('reports the real before/after when a row genuinely crosses a ✓ line', () => {
  // E (-80) is dragged from below ✓ #2 to above it: ✓ #2 now stands over one more row.
  const changes = marksAffectedByReorder([A, B, C, D, E], reorder([A, B, C, E, D]));
  expect(changes).toHaveLength(1);
  expect(changes[0].id).toBe(2);
  expect(changes[0].from).toBe(-960);
  expect(changes[0].to).toBe(-1040);
  expect(changes[0].lockedTransactionIds).toEqual([1, 2, 3, 5, 4]);
 });

 it('reports a row lifted above the topmost ✓', () => {
  // B (-500) moves above ✓ #1, so that mark now stands over two rows instead of one.
  const changes = marksAffectedByReorder([A, B], reorder([B, A]));
  expect(changes).toEqual([{ id: 1, from: -100, to: -600, lockedTransactionIds: [2, 1] }]);
 });
});
