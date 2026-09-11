/**
 * Comparing monetary amounts.
 *
 * Every money column in this app is DOUBLE PRECISION (see postgres.js) and balances are
 * replayed in the browser by summing per-transaction net changes across an account's whole
 * history (ledgerBalances.ts, accountBalances.ts). Each of those steps multiplies by a rate and
 * a commission percentage, so the result is a binary float carrying accumulated representation
 * error — an account that is settled in reality routinely lands on -1.16e-10 rather than 0.
 *
 * That is not hypothetical. A sweep of this project's production data (5,964 transactions,
 * 199 accounts) found three such balances, two of them at 1e-10 and 1e-12 — magnitudes no
 * human ever typed.
 *
 * `x === 0` on such a value is false, which is how the drift turns into visible wrongness:
 * a settled account keeps offering its "write off" button, a netted-out organization is never
 * dropped from the overview, and a client's PDF statement declares money owed in one direction
 * or the other instead of saying "settled". Use `isZeroMoney` for those decisions rather than
 * an exact comparison.
 *
 * This does not fix the root cause — that is a migration to an exact decimal type — but it
 * stops float noise from being read as a real balance.
 */

/**
 * Amounts smaller than this are float noise, not money.
 *
 * 1e-6 rather than something tighter because the error accumulates: a balance in the millions
 * has only ~1e-10 of representable precision per operation, and thousands of transactions
 * compound that. It is also the tolerance this codebase already settled on independently in
 * reconciliation.ts and harvestProfit.ts, so this keeps one number rather than adding a fourth.
 *
 * Note it is deliberately far below any real-world smallest unit: 0.003 of a currency unit is a
 * genuine (tiny) balance and stays visible, to be cleared through the write-off flow that
 * exists for exactly that. This constant is only about arithmetic noise.
 */
export const MONEY_EPSILON = 1e-6;

/**
 * True when `value` is zero for accounting purposes — actually 0, or close enough that the
 * difference can only be float drift. NaN is not zero and returns false, as does Infinity.
 */
export function isZeroMoney(value: number): boolean {
 return Math.abs(value) < MONEY_EPSILON;
}

/** True when two amounts are equal for accounting purposes. See `isZeroMoney`. */
export function moneyEquals(a: number, b: number): boolean {
 return isZeroMoney(a - b);
}
