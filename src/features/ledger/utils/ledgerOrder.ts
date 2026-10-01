import type { Transaction } from '@/shared/types';

/**
 * Order of rows WITHIN a day in a client ledger.
 *
 * A transaction sits in two ledgers — its sender's and its receiver's — and each is ordered
 * independently. Across days the order is the date in createdAt, which both ledgers share; within
 * a day each side has its own position (transactions.ledger_pos_from / ledger_pos_to), so dragging
 * a row inside its day in one client's ledger never moves it in the counterparty's. A side with no
 * position of its own falls back to the time of day in createdAt, which is exactly the order every
 * row had before positions existed.
 *
 * Positions are milliseconds after midnight on the row's wall-clock day — the same scale as that
 * fallback, so positioned and unpositioned rows interleave sensibly.
 */

type Positioned = Pick<Transaction, 'accountFromId' | 'accountToId' | 'createdAt' | 'ledgerPosFrom' | 'ledgerPosTo'>;

/** Wall-clock day of a createdAt, as used everywhere in the app (the stored digits ARE local time). */
export function ledgerDayKey(createdAt: string): string {
 return createdAt.slice(0, 10);
}

/**
 * Milliseconds after midnight of the wall-clock time in a createdAt ("YYYY-MM-DD HH:mm:ss",
 * "…THH:mm:ss.sssZ", …). Read off the digits rather than through Date, for the same reason the day
 * is: the stored value is local time labelled as UTC, and a Date would shift it by the viewer's
 * timezone.
 */
export function timeOfDayMs(createdAt: string): number {
 const match = /[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?/.exec(createdAt);
 if (!match) return 0;
 const [, hh, mm, ss = '0', ms = '0'] = match;
 return ((Number(hh) * 60 + Number(mm)) * 60 + Number(ss)) * 1000 + Number(ms.padEnd(3, '0'));
}

/** Which of the transaction's two sides belongs to this ledger's account. */
export function ledgerSideOf(tx: Pick<Transaction, 'accountFromId' | 'accountToId'>, accountId: number): 'from' | 'to' | null {
 if (tx.accountFromId === accountId) return 'from';
 if (tx.accountToId === accountId) return 'to';
 return null;
}

/** This row's position within its day in `accountId`'s ledger. */
export function ledgerPositionOf(tx: Positioned, accountId: number): number {
 const side = ledgerSideOf(tx, accountId);
 const own = side === 'from' ? tx.ledgerPosFrom : side === 'to' ? tx.ledgerPosTo : null;
 return own ?? timeOfDayMs(tx.createdAt);
}

/** The transaction with this ledger's side re-positioned (both sides when it books against itself). */
export function withLedgerPosition<T extends Positioned>(tx: T, accountId: number, position: number | null): T {
 return {
  ...tx,
  ...(tx.accountFromId === accountId ? { ledgerPosFrom: position } : {}),
  ...(tx.accountToId === accountId ? { ledgerPosTo: position } : {}),
 };
}

/** Day first, then position within the day, then id for a stable tie-break. */
export function compareLedgerOrder(
 left: { createdAt: string; ledgerPosition?: number; transactionId: number },
 right: { createdAt: string; ledgerPosition?: number; transactionId: number },
): number {
 const leftDay = ledgerDayKey(left.createdAt);
 const rightDay = ledgerDayKey(right.createdAt);
 if (leftDay !== rightDay) return leftDay < rightDay ? -1 : 1;
 const positionDiff = (left.ledgerPosition ?? timeOfDayMs(left.createdAt)) - (right.ledgerPosition ?? timeOfDayMs(right.createdAt));
 if (positionDiff !== 0) return positionDiff;
 return left.transactionId - right.transactionId;
}

/**
 * Fresh, strictly increasing positions for `count` rows of one day, given the positions the day's
 * rows hold now. They stay inside that day's current [lowest, highest] range rather than being
 * spread across the whole day, so a transaction added to the day later — timed after the day's
 * latest row (see nextCreatedAtForDate) — still lands at the end. When the range is too narrow to
 * fit them (several rows sharing one timestamp, e.g. 00:00:00 expenses), they are stacked one
 * millisecond apart ending at the highest position.
 */
export function spreadLedgerPositions(currentPositions: number[], count: number): number[] {
 if (count <= 0) return [];
 const finite = currentPositions.filter((value) => Number.isFinite(value));
 const hi = finite.length ? Math.max(...finite) : 0;
 const lo = finite.length ? Math.min(...finite) : 0;
 if (count === 1) return [hi];
 if (hi - lo >= count - 1) {
  return Array.from({ length: count }, (_, i) => lo + ((hi - lo) * i) / (count - 1));
 }
 return Array.from({ length: count }, (_, i) => hi - (count - 1 - i));
}
