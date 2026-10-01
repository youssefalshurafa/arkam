import { describe, expect, it } from 'vitest';
import { compareLedgerOrder, ledgerPositionOf, spreadLedgerPositions, timeOfDayMs, withLedgerPosition } from './ledgerOrder';

const tx = (overrides: Partial<{ accountFromId: number | null; accountToId: number | null; createdAt: string; ledgerPosFrom: number | null; ledgerPosTo: number | null }>) => ({
 accountFromId: 1,
 accountToId: 2,
 createdAt: '2026-09-29T10:00:00.000Z',
 ledgerPosFrom: null,
 ledgerPosTo: null,
 ...overrides,
});

describe('timeOfDayMs', () => {
 it('reads the wall-clock time off the digits, whatever the format', () => {
  expect(timeOfDayMs('2026-09-29T10:00:00.000Z')).toBe(36_000_000);
  expect(timeOfDayMs('2026-09-29 10:00:00')).toBe(36_000_000);
  expect(timeOfDayMs('2026-09-29T00:00:01.5Z')).toBe(1_500);
  expect(timeOfDayMs('2026-09-29')).toBe(0);
 });
});

describe('ledgerPositionOf', () => {
 it('falls back to the time of day when this side has no position', () => {
  expect(ledgerPositionOf(tx({}), 1)).toBe(36_000_000);
 });

 it('uses only THIS side\'s position — the counterparty keeps its own', () => {
  const moved = withLedgerPosition(tx({}), 1, 5);
  expect(ledgerPositionOf(moved, 1)).toBe(5);
  expect(ledgerPositionOf(moved, 2)).toBe(36_000_000);
 });

 it('positions both sides of a transaction booked against the same account', () => {
  const self = withLedgerPosition(tx({ accountFromId: 3, accountToId: 3 }), 3, 7);
  expect(self.ledgerPosFrom).toBe(7);
  expect(self.ledgerPosTo).toBe(7);
 });
});

describe('compareLedgerOrder', () => {
 const entry = (createdAt: string, transactionId: number, ledgerPosition?: number) => ({ createdAt, transactionId, ledgerPosition });

 it('orders by day before anything else, so a position never crosses days', () => {
  expect(compareLedgerOrder(entry('2026-09-28T23:00:00Z', 2, 99_999_999), entry('2026-09-29T00:00:00Z', 1, -5))).toBeLessThan(0);
 });

 it('orders by position within a day, then by id', () => {
  expect(compareLedgerOrder(entry('2026-09-29T10:00:00Z', 1, 500), entry('2026-09-29T09:00:00Z', 2, 100))).toBeGreaterThan(0);
  expect(compareLedgerOrder(entry('2026-09-29T10:00:00Z', 1), entry('2026-09-29T10:00:00Z', 2))).toBeLessThan(0);
 });
});

describe('spreadLedgerPositions', () => {
 it('spreads rows evenly inside the day\'s current range, never past its latest row', () => {
  expect(spreadLedgerPositions([1000, 4000, 2500], 3)).toEqual([1000, 2500, 4000]);
  const spread = spreadLedgerPositions([0, 90_000], 4);
  expect(spread[0]).toBe(0);
  expect(spread[3]).toBe(90_000);
  expect(new Set(spread).size).toBe(4);
 });

 it('stacks rows 1ms apart ending at the shared time when they all share one timestamp', () => {
  expect(spreadLedgerPositions([0, 0, 0], 3)).toEqual([-2, -1, 0]);
 });

 it('keeps a single row where it is', () => {
  expect(spreadLedgerPositions([42], 1)).toEqual([42]);
 });

 it('always returns strictly increasing positions', () => {
  for (const current of [[5, 5], [5, 6], [0, 1, 2, 3], [100, 100, 101]]) {
   const out = spreadLedgerPositions(current, current.length + 1);
   for (let i = 1; i < out.length; i++) expect(out[i]).toBeGreaterThan(out[i - 1]);
  }
 });
});
