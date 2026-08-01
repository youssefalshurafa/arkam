import type { ClientLedgerEntry, Transaction } from '@/shared/types';

// Below this many other same-pair samples, there's no meaningful reference — never flag,
// to avoid false positives on rare/new currency pairs.
const MIN_REFERENCE_SAMPLE = 5;
// A real ×/÷ mixup (e.g. 10.88 entered as 0.092) is off by 10s-to-100s-x, so this bound
// only needs to separate "plausible market fluctuation" from "wrong operator/typo" — no
// need for a reciprocal-specific check, a plain magnitude bound already catches it.
const MAX_RATE_RATIO = 1.5;
const MIN_RATE_RATIO = 1 / MAX_RATE_RATIO;
// Same-currency conversion is definitionally 1:1 — this isn't a statistical inference like
// the cross-currency check, so it needs no reference pool and fires unconditionally.
const SAME_CURRENCY_TOLERANCE = 1e-6;

export type RateAnomaly = {
 transactionId: number;
 pairKey: string;
 enteredRate: number;
 referenceRate: number;
 sampleSize: number;
};

type RateSample = { transactionId: number; rate: number };

function pairKey(fromCode: string, toCode: string): string {
 return `${fromCode}:${toCode}`;
}

function median(values: number[]): number {
 const sorted = [...values].sort((a, b) => a - b);
 const mid = Math.floor(sorted.length / 2);
 return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function addSample<K, T>(samples: Map<K, T[]>, key: K, sample: T): void {
 let bucket = samples.get(key);
 if (!bucket) {
  bucket = [];
  samples.set(key, bucket);
 }
 bucket.push(sample);
}

// Workspace-wide reference pool (across all clients — market FX rates don't vary by
// client, and pooling reaches a usable sample size faster), one bucket per ordered
// currency-pair. Mirrors the pending-rate cross-currency condition already used in
// computeTransactionSideNetChange (ledgerBalances.ts) so rate=0 placeholder rows never
// pollute the reference pool.
export function buildRateSamples(transactions: Transaction[]): Map<string, RateSample[]> {
 const samples = new Map<string, RateSample[]>();
 for (const tx of transactions) {
  if (tx.isArchived) continue;
  if (tx.accountFromId != null && tx.currencyCode !== tx.accountFromCurrencyCode && tx.exchangeRateFrom > 0) {
   addSample(samples, pairKey(tx.currencyCode, tx.accountFromCurrencyCode), { transactionId: tx.id, rate: tx.exchangeRateFrom });
  }
  if (tx.accountToId != null && tx.currencyCode !== tx.accountToCurrencyCode && tx.exchangeRateTo > 0) {
   addSample(samples, pairKey(tx.currencyCode, tx.accountToCurrencyCode), { transactionId: tx.id, rate: tx.exchangeRateTo });
  }
 }
 return samples;
}

// Median rate for a pair, excluding the transaction under test; null if too few other
// samples exist to form a meaningful reference.
export function referenceRateFor(
 samples: Map<string, RateSample[]>,
 fromCode: string,
 toCode: string,
 excludeTransactionId: number,
): { rate: number; sampleSize: number } | null {
 const bucket = samples.get(pairKey(fromCode, toCode));
 if (!bucket) return null;
 const others = bucket.filter((s) => s.transactionId !== excludeTransactionId).map((s) => s.rate);
 if (others.length < MIN_REFERENCE_SAMPLE) return null;
 return { rate: median(others), sampleSize: others.length };
}

// Core check, reused by both the export gate and the ledger-row badge.
export function checkRate(
 enteredRate: number,
 fromCode: string,
 toCode: string,
 transactionId: number,
 samples: Map<string, RateSample[]>,
): RateAnomaly | null {
 if (!(enteredRate > 0)) return null;
 if (fromCode === toCode) {
  if (Math.abs(enteredRate - 1) < SAME_CURRENCY_TOLERANCE) return null;
  return { transactionId, pairKey: pairKey(fromCode, toCode), enteredRate, referenceRate: 1, sampleSize: 0 };
 }
 const ref = referenceRateFor(samples, fromCode, toCode, transactionId);
 if (!ref) return null;
 const ratio = enteredRate / ref.rate;
 if (ratio <= MAX_RATE_RATIO && ratio >= MIN_RATE_RATIO) return null;
 return { transactionId, pairKey: pairKey(fromCode, toCode), enteredRate, referenceRate: ref.rate, sampleSize: ref.sampleSize };
}

// Convenience for checking an already-computed ledger row against its account's own currency.
export function checkLedgerEntry(
 entry: ClientLedgerEntry,
 accountCurrencyCode: string,
 samples: Map<string, RateSample[]>,
): RateAnomaly | null {
 if (entry.pendingRate) return null;
 return checkRate(entry.exchangeRate, entry.currencyCode, accountCurrencyCode, entry.transactionId, samples);
}

// Below this many other exchange-transaction samples for the account, there's no meaningful
// baseline — never flag, to avoid false positives on accounts with little exchange history.
const MIN_COMMISSION_SAMPLE = 5;
// Historical commissions below this are treated as "effectively zero" (a commission-free
// account), separately from the ratio bound below (which needs a nonzero reference).
const COMMISSION_ZERO_EPSILON = 0.01;
const MAX_COMMISSION_RATIO = 1.5;
const MIN_COMMISSION_RATIO = 1 / MAX_COMMISSION_RATIO;

export type CommissionAnomaly = {
 transactionId: number;
 accountId: number;
 enteredCommission: number;
 referenceCommission: number;
 sampleSize: number;
};

type CommissionSample = { transactionId: number; commission: number };

// Historical commission pool per account (not workspace-wide — commission practice is
// client/account-specific: some clients get charged commission on exchanges, others never
// do), scoped to `exchange`-type transactions only, since commission on other transaction
// types isn't a comparable practice.
export function buildCommissionSamples(transactions: Transaction[]): Map<number, CommissionSample[]> {
 const samples = new Map<number, CommissionSample[]>();
 for (const tx of transactions) {
  if (tx.isArchived || tx.type !== 'exchange') continue;
  if (tx.accountFromId != null) addSample(samples, tx.accountFromId, { transactionId: tx.id, commission: tx.commissionFrom });
  if (tx.accountToId != null) addSample(samples, tx.accountToId, { transactionId: tx.id, commission: tx.commissionTo });
 }
 return samples;
}

// Core commission check, reused by both the export gate and the ledger-row badge.
export function checkCommission(
 enteredCommission: number,
 accountId: number,
 transactionId: number,
 samples: Map<number, CommissionSample[]>,
): CommissionAnomaly | null {
 const bucket = samples.get(accountId);
 if (!bucket) return null;
 const others = bucket.filter((s) => s.transactionId !== transactionId).map((s) => s.commission);
 if (others.length < MIN_COMMISSION_SAMPLE) return null;
 const ref = median(others);
 const entered = Math.abs(enteredCommission);
 if (Math.abs(ref) < COMMISSION_ZERO_EPSILON) {
  // This account's history is essentially commission-free on exchanges — any nontrivial
  // commission is a break from its own established pattern.
  if (entered < COMMISSION_ZERO_EPSILON) return null;
 } else {
  const ratio = entered / Math.abs(ref);
  if (ratio <= MAX_COMMISSION_RATIO && ratio >= MIN_COMMISSION_RATIO) return null;
 }
 return { transactionId, accountId, enteredCommission, referenceCommission: ref, sampleSize: others.length };
}

// Convenience for checking an already-computed ledger row against its own account.
export function checkLedgerEntryCommission(
 entry: ClientLedgerEntry,
 accountId: number,
 samples: Map<number, CommissionSample[]>,
): CommissionAnomaly | null {
 if (entry.type !== 'exchange') return null;
 return checkCommission(entry.commission, accountId, entry.transactionId, samples);
}
