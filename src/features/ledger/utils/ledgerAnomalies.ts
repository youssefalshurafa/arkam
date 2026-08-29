import type { ClientLedgerEntry, IgnoredAnomaly, Transaction } from '@/shared/types';

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

// Below this many other same-pair samples, there's no meaningful baseline — never flag, to
// avoid false positives on new/rarely-used client relationships.
const MIN_COMMISSION_SAMPLE = 5;
// A pair's commission history must agree on one value at least this often to count as an
// established convention. Commission is frequently negotiated per-deal (unlike exchange rates,
// which track a real market), so unlike the rate check, deviation from a loose statistical
// center (e.g. a median) is not a reliable signal — plenty of genuinely-variable relationships
// would trip it. Requiring near-unanimous agreement first means we only compare against pairs
// that actually have a convention to break.
const MODE_SHARE_THRESHOLD = 0.9;
// Commissions below this are treated as "effectively zero" — both for deciding whether the
// pair's mode itself is a zero-commission convention, and for comparing an entered value to it.
const COMMISSION_ZERO_EPSILON = 0.01;
const MAX_COMMISSION_RATIO = 1.5;
const MIN_COMMISSION_RATIO = 1 / MAX_COMMISSION_RATIO;

export type CommissionAnomaly = {
 transactionId: number;
 accountId: number;
 enteredCommission: number;
 referenceCommission: number;
 sampleSize: number;
 // How many of `sampleSize` prior transactions actually carried `referenceCommission` — lets
 // the UI explain the flag ("0% in 51 of 51 previous transactions with this client") rather
 // than just stating a bare reference number.
 matchCount: number;
};

type CommissionSample = { transactionId: number; commission: number };

// Which side of the transaction `accountId` sat on: 'from' (it sent/converted out) or 'to' (it
// received). Commission convention is frequently direction-dependent for a given relationship —
// e.g. a client who is never charged when paying out, only when receiving — so this must be part
// of the bucket key, not folded into a single "this account with this counterparty" pool.
type CommissionRole = 'from' | 'to';

function commissionPairKey(accountId: number, counterpartyAccountId: number, role: CommissionRole): string {
 return `${accountId}:${counterpartyAccountId}:${role}`;
}

// The most frequent value in a sample (rounded to the commission input's own precision, 2
// decimals, so near-identical entries count as the same convention), how many samples share it,
// and its share of the sample — used to decide whether a pair's history is consistent enough to
// compare against, and to explain the flag to the user.
function modeWithShare(values: number[]): { mode: number; count: number; share: number } {
 const counts = new Map<number, number>();
 for (const v of values) {
  const key = Math.round(v * 100) / 100;
  counts.set(key, (counts.get(key) ?? 0) + 1);
 }
 let mode = values[0];
 let best = 0;
 for (const [key, count] of counts) {
  if (count > best) {
   best = count;
   mode = key;
  }
 }
 return { mode, count: best, share: best / values.length };
}

// Historical commission pool per (account, counterparty-account, role) — not per account alone,
// not workspace-wide, and not even merged across both transaction directions for the same pair.
// Commission practice is specific to one client-to-client relationship *and* which way the money
// moved: the same two accounts can legitimately charge commission only when converting out and
// never when receiving (or vice versa), so pooling both directions together would average two
// different conventions into one and misflag whichever direction is less common. Commission is a
// universal field applied the same way for every transaction type except `adjustment` (a balance
// correction, not a real settled trade) — see computeTransactionSideNetChange, which has no type
// gate on commission either.
export function buildCommissionSamples(transactions: Transaction[]): Map<string, CommissionSample[]> {
 const samples = new Map<string, CommissionSample[]>();
 for (const tx of transactions) {
  if (tx.isArchived || tx.type === 'adjustment') continue;
  if (tx.accountFromId != null && tx.accountToId != null) {
   addSample(samples, commissionPairKey(tx.accountFromId, tx.accountToId, 'from'), { transactionId: tx.id, commission: tx.commissionFrom });
   addSample(samples, commissionPairKey(tx.accountToId, tx.accountFromId, 'to'), { transactionId: tx.id, commission: tx.commissionTo });
  }
 }
 return samples;
}

// Core commission check, reused by both the export gate and the ledger-row badge.
export function checkCommission(
 enteredCommission: number,
 accountId: number,
 counterpartyAccountId: number | null,
 role: CommissionRole,
 transactionId: number,
 samples: Map<string, CommissionSample[]>,
): CommissionAnomaly | null {
 if (counterpartyAccountId == null) return null;
 const bucket = samples.get(commissionPairKey(accountId, counterpartyAccountId, role));
 if (!bucket) return null;
 const others = bucket.filter((s) => s.transactionId !== transactionId).map((s) => s.commission);
 if (others.length < MIN_COMMISSION_SAMPLE) return null;
 const { mode, count, share } = modeWithShare(others);
 // No established convention for this pair (commission genuinely varies deal-to-deal) — nothing
 // to compare against, so never flag.
 if (share < MODE_SHARE_THRESHOLD) return null;

 const entered = enteredCommission;
 const modeIsZero = Math.abs(mode) < COMMISSION_ZERO_EPSILON;
 let flagged: boolean;
 if (modeIsZero) {
  // This pair has never carried commission — any nontrivial commission is a break.
  flagged = Math.abs(entered) >= COMMISSION_ZERO_EPSILON;
 } else if (Math.sign(entered) !== Math.sign(mode) && Math.abs(entered) >= COMMISSION_ZERO_EPSILON) {
  // A fee became a rebate (or vice versa) — a clear break regardless of magnitude.
  flagged = true;
 } else {
  // Magnitude break either way: entered back to zero when the pair always carries commission
  // (ratio 0/mode falls outside the bounds below, so this is covered by the same check), or an
  // outsized/undersized value relative to the established amount.
  const ratio = Math.abs(entered) / Math.abs(mode);
  flagged = !(ratio <= MAX_COMMISSION_RATIO && ratio >= MIN_COMMISSION_RATIO);
 }
 if (!flagged) return null;
 return { transactionId, accountId, enteredCommission, referenceCommission: mode, sampleSize: others.length, matchCount: count };
}

// Convenience for checking an already-computed ledger row against its own account.
export function checkLedgerEntryCommission(
 entry: ClientLedgerEntry,
 accountId: number,
 samples: Map<string, CommissionSample[]>,
): CommissionAnomaly | null {
 if (entry.type === 'adjustment') return null;
 // 'outgoing' means this account was the transaction's "from" side (it sent/converted out);
 // 'incoming' means it was the "to" side (it received) — mirrors accountFromId/accountToId in
 // computeClientLedgers (ledgerBalances.ts), which is where `direction` is set.
 const role: CommissionRole = entry.direction === 'outgoing' ? 'from' : 'to';
 return checkCommission(entry.commission, accountId, entry.counterpartyAccountId, role, entry.transactionId, samples);
}

// Identifies one (kind, transaction side) flag for the ignore-list — a transaction's "from"
// and "to" sides belong to different accounts and are dismissed independently.
export function anomalyKey(kind: 'rate' | 'commission' | 'pendingRate', transactionId: number, accountId: number): string {
 return `${kind}:${transactionId}:${accountId}`;
}

export function buildIgnoredAnomalySet(ignored: IgnoredAnomaly[]): Set<string> {
 return new Set(ignored.map((entry) => anomalyKey(entry.kind, entry.transactionId, entry.accountId)));
}

export type FlaggedAnomaly = {
 kind: 'rate' | 'commission';
 transactionId: number;
 accountId: number;
 enteredValue: number;
 referenceValue: number;
 sampleSize: number;
};

// Workspace-wide flagged list (every account, every client) for the Transactions/Overview
// "needs review" indicator — unlike ledgerRateAnomalies/ledgerCommissionAnomalies (page.tsx),
// which only cover the currently open client's ledger, this scans every transaction directly
// (checkRate/checkCommission work off raw transaction fields, no ClientLedgerEntry needed) and
// excludes anything already dismissed via `ignored`.
export function buildWorkspaceAnomalies(transactions: Transaction[], ignored: Set<string>): FlaggedAnomaly[] {
 const rateSamples = buildRateSamples(transactions);
 const commissionSamples = buildCommissionSamples(transactions);
 const flagged: FlaggedAnomaly[] = [];
 for (const tx of transactions) {
  if (tx.isArchived) continue;
  if (tx.accountFromId != null && !ignored.has(anomalyKey('rate', tx.id, tx.accountFromId))) {
   const rate = checkRate(tx.exchangeRateFrom, tx.currencyCode, tx.accountFromCurrencyCode, tx.id, rateSamples);
   if (rate) flagged.push({ kind: 'rate', transactionId: tx.id, accountId: tx.accountFromId, enteredValue: rate.enteredRate, referenceValue: rate.referenceRate, sampleSize: rate.sampleSize });
  }
  if (tx.accountToId != null && !ignored.has(anomalyKey('rate', tx.id, tx.accountToId))) {
   const rate = checkRate(tx.exchangeRateTo, tx.currencyCode, tx.accountToCurrencyCode, tx.id, rateSamples);
   if (rate) flagged.push({ kind: 'rate', transactionId: tx.id, accountId: tx.accountToId, enteredValue: rate.enteredRate, referenceValue: rate.referenceRate, sampleSize: rate.sampleSize });
  }
  if (tx.type === 'adjustment') continue;
  if (tx.accountFromId != null && !ignored.has(anomalyKey('commission', tx.id, tx.accountFromId))) {
   const commission = checkCommission(tx.commissionFrom, tx.accountFromId, tx.accountToId, 'from', tx.id, commissionSamples);
   if (commission) flagged.push({ kind: 'commission', transactionId: tx.id, accountId: tx.accountFromId, enteredValue: commission.enteredCommission, referenceValue: commission.referenceCommission, sampleSize: commission.sampleSize });
  }
  if (tx.accountToId != null && !ignored.has(anomalyKey('commission', tx.id, tx.accountToId))) {
   const commission = checkCommission(tx.commissionTo, tx.accountToId, tx.accountFromId, 'to', tx.id, commissionSamples);
   if (commission) flagged.push({ kind: 'commission', transactionId: tx.id, accountId: tx.accountToId, enteredValue: commission.enteredCommission, referenceValue: commission.referenceCommission, sampleSize: commission.sampleSize });
  }
 }
 return flagged;
}
