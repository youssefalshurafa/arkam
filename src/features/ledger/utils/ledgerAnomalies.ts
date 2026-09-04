import type { ClientLedgerEntry, IgnoredAnomaly, Transaction } from '@/shared/types';

// Below this many other same-pair samples, there's no meaningful reference — never flag,
// to avoid false positives on rare/new currency pairs.
const MIN_REFERENCE_SAMPLE = 5;
// A real ×/÷ mixup (e.g. 10.88 entered as 0.092) is off by 10s-to-100s-x, so this bound
// only needs to separate "plausible market fluctuation" from "wrong operator/typo" — no
// need for a reciprocal-specific check, a plain magnitude bound already catches it.
const MAX_RATE_RATIO = 1.5;
const MIN_RATE_RATIO = 1 / MAX_RATE_RATIO;

// The ratio bound above only ever caught gross errors, which left the most common real mistake
// invisible: entering the rate belonging to a DIFFERENT currency. A EUR row given the USDT rate
// of 9.67, against a EUR history centred on 10.80, is off by ~10% — nowhere near 1.5x, so
// nothing fired. What makes it obviously wrong to a person is not its distance from the median
// but that it sits outside the band this pair actually trades in, so that is what gets checked.
//
// That band is deliberately NOT the raw min/max. Real history contains earlier instances of this
// very mistake: of 2242 recorded EUR->MAD rates, nine sit below 10.40 (one of them the 9.67 that
// prompted this), which drags the minimum down to where the next such error slips through — the
// outliers teach the check to accept outliers. Trimming the extreme tails first is what makes the
// band describe normal trading instead of the worst thing that ever happened: for that pool the
// 2nd/98th percentiles are 10.50 and 11.17, against a full range of 9.67 to 11.32.
const RATE_LOW_PERCENTILE = 0.02;
const RATE_HIGH_PERCENTILE = 0.98;
// The margin around that band is the larger of a share of the trimmed spread (a pair that
// genuinely moves around earns proportionally more room) and a floor share of the typical rate
// (so a pair whose rate has never moved doesn't flag on ordinary drift). Erring toward flagging
// is right here: the badge is advisory and one click dismisses it for good, whereas a miss is a
// wrong rate carried silently into a client's balance.
const RATE_SPREAD_MARGIN = 0.25;
const RATE_FLOOR_MARGIN = 0.02;
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

// Which side of a transaction a leg sits on: 'from' (it sent/converted out) or 'to' (it received).
type LegSide = 'from' | 'to';

// Descriptions are compared exactly once case and spacing are normalised — deliberately no fuzzy
// or semantic matching. Two labels that mean the same thing to a person ("turkiye" / "turk euro")
// stay separate groups, which is the safe direction: a group with too little history simply isn't
// judged, whereas guessing that two labels are equivalent could merge genuinely different
// conventions back together — the very bug this grouping exists to fix.
export function normalizeDescriptionKey(description: string): string {
 return description.trim().toLowerCase().replace(/\s+/g, ' ');
}

// The description as it appears on this side's ledger row. Mirrors computeClientLedgers
// (ledgerBalances.ts), so the history a transaction is judged against is exactly the set of rows
// the user sees carrying the same label.
export function sideDescription(tx: Transaction, side: LegSide): string {
 const own = side === 'from' ? tx.descriptionFrom : tx.descriptionTo;
 return normalizeDescriptionKey(own?.trim() || tx.description || '');
}

function pairKey(fromCode: string, toCode: string): string {
 return `${fromCode}:${toCode}`;
}

// A currency pair narrowed to the rows carrying one description. A workspace's rate for a pair is
// not one number — it depends on what the row is FOR, and the description is where that is already
// recorded. Judging every EUR row against one pooled EUR band flags the legitimately-cheap groups
// and, the other way round, accepts a rate that is plainly wrong for the group it belongs to.
// Nothing here interprets the text: it is whatever each workspace types, and a blank description
// simply forms one group per pair, which behaves exactly as the pair-wide pool always did.
function pairDescriptionKey(fromCode: string, toCode: string, descriptionKey: string): string {
 return `${pairKey(fromCode, toCode)}|${descriptionKey}`;
}

function median(values: number[]): number {
 const sorted = [...values].sort((a, b) => a - b);
 const mid = Math.floor(sorted.length / 2);
 return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Linear-interpolated percentile over already-sorted values (Postgres percentile_cont). On a
// small pool this collapses toward the plain min/max, which is the conservative thing to do:
// with few samples there is no way to tell an outlier from the pair's genuine range.
function percentile(sorted: number[], q: number): number {
 if (sorted.length === 1) return sorted[0];
 const position = (sorted.length - 1) * q;
 const lowIndex = Math.floor(position);
 const highIndex = Math.ceil(position);
 if (lowIndex === highIndex) return sorted[lowIndex];
 return sorted[lowIndex] + (sorted[highIndex] - sorted[lowIndex]) * (position - lowIndex);
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
 // Every leg lands in two buckets: the pair-wide pool, and the pair narrowed to its own
 // description. referenceRateFor prefers the narrower one when it has enough history to speak
 // for itself and falls back to the wide one otherwise, so a workspace that types nothing keeps
 // exactly the behaviour it had.
 const addLeg = (fromCode: string, toCode: string, side: LegSide, tx: Transaction, rate: number) => {
  const sample = { transactionId: tx.id, rate };
  addSample(samples, pairKey(fromCode, toCode), sample);
  addSample(samples, pairDescriptionKey(fromCode, toCode, sideDescription(tx, side)), sample);
 };
 for (const tx of transactions) {
  if (tx.isArchived) continue;
  if (tx.accountFromId != null && tx.currencyCode !== tx.accountFromCurrencyCode && tx.exchangeRateFrom > 0) {
   addLeg(tx.currencyCode, tx.accountFromCurrencyCode, 'from', tx, tx.exchangeRateFrom);
  }
  if (tx.accountToId != null && tx.currencyCode !== tx.accountToCurrencyCode && tx.exchangeRateTo > 0) {
   addLeg(tx.currencyCode, tx.accountToCurrencyCode, 'to', tx, tx.exchangeRateTo);
  }
 }
 return samples;
}

/**
 * Rates the user has explicitly accepted as normal for a description group, keyed the same way as
 * the grouped sample buckets. Built from the ignore records the user marked as applying to the
 * whole group (`scope: 'description'`) — a small group like a handful of rows for one destination
 * can never reach MIN_REFERENCE_SAMPLE on its own, so without this it would keep flagging forever.
 *
 * Deliberately a list of accepted RATES rather than a blanket exemption for the group: accepting
 * one row teaches the engine what normal looks like there, it does not switch the check off. A row
 * in the same group at a genuinely wrong rate stays flagged — see checkRate.
 */
export function buildAcceptedRates(transactions: Transaction[], ignored: IgnoredAnomaly[]): Map<string, number[]> {
 const groupScoped = new Set(ignored.filter((entry) => entry.kind === 'rate' && entry.scope === 'description').map((entry) => `${entry.transactionId}:${entry.accountId}`));
 if (groupScoped.size === 0) return new Map();
 const accepted = new Map<string, number[]>();
 for (const tx of transactions) {
  if (tx.isArchived) continue;
  if (tx.accountFromId != null && groupScoped.has(`${tx.id}:${tx.accountFromId}`) && tx.currencyCode !== tx.accountFromCurrencyCode && tx.exchangeRateFrom > 0) {
   addSample(accepted, pairDescriptionKey(tx.currencyCode, tx.accountFromCurrencyCode, sideDescription(tx, 'from')), tx.exchangeRateFrom);
  }
  if (tx.accountToId != null && groupScoped.has(`${tx.id}:${tx.accountToId}`) && tx.currencyCode !== tx.accountToCurrencyCode && tx.exchangeRateTo > 0) {
   addSample(accepted, pairDescriptionKey(tx.currencyCode, tx.accountToCurrencyCode, sideDescription(tx, 'to')), tx.exchangeRateTo);
  }
 }
 return accepted;
}

// Median rate for a pair, excluding the transaction under test; null if too few other samples
// exist to form a meaningful reference. `low`/`high` are the tail-trimmed bounds of the band this
// pair actually trades in — the comparison that catches a rate borrowed from another currency,
// and the reason they are percentiles rather than the raw extremes (see RATE_LOW_PERCENTILE).
export function referenceRateFor(
 samples: Map<string, RateSample[]>,
 fromCode: string,
 toCode: string,
 excludeTransactionId: number,
 descriptionKey = '',
): { rate: number; sampleSize: number; low: number; high: number; scopedToDescription: boolean } | null {
 const others = (key: string) => (samples.get(key) ?? []).filter((s) => s.transactionId !== excludeTransactionId).map((s) => s.rate);
 // The row's own description group speaks for it when it has enough history of its own; only
 // then does the pair-wide pool step aside. A group below the threshold has no signal to offer,
 // so falling back is what keeps a brand-new label from being unjudged entirely.
 const grouped = descriptionKey ? others(pairDescriptionKey(fromCode, toCode, descriptionKey)) : [];
 const scopedToDescription = grouped.length >= MIN_REFERENCE_SAMPLE;
 const pool = scopedToDescription ? grouped : others(pairKey(fromCode, toCode));
 if (pool.length < MIN_REFERENCE_SAMPLE) return null;
 const sorted = [...pool].sort((a, b) => a - b);
 return {
  rate: median(sorted),
  sampleSize: sorted.length,
  low: percentile(sorted, RATE_LOW_PERCENTILE),
  high: percentile(sorted, RATE_HIGH_PERCENTILE),
  scopedToDescription,
 };
}

// Core check, reused by both the export gate and the ledger-row badge.
export function checkRate(
 enteredRate: number,
 fromCode: string,
 toCode: string,
 transactionId: number,
 samples: Map<string, RateSample[]>,
 descriptionKey = '',
 acceptedRates?: Map<string, number[]>,
): RateAnomaly | null {
 if (!(enteredRate > 0)) return null;
 if (fromCode === toCode) {
  if (Math.abs(enteredRate - 1) < SAME_CURRENCY_TOLERANCE) return null;
  return { transactionId, pairKey: pairKey(fromCode, toCode), enteredRate, referenceRate: 1, sampleSize: 0 };
 }
 const ref = referenceRateFor(samples, fromCode, toCode, transactionId, descriptionKey);
 if (!ref) return null;
 const ratio = enteredRate / ref.rate;
 const grosslyOff = ratio > MAX_RATE_RATIO || ratio < MIN_RATE_RATIO;
 // Widen the pair's observed range before comparing — see RATE_SPREAD_MARGIN. Both bounds are
 // checked (not just the low one) so a rate borrowed from a stronger currency is caught the same
 // way as one borrowed from a weaker one.
 const margin = Math.max((ref.high - ref.low) * RATE_SPREAD_MARGIN, ref.rate * RATE_FLOOR_MARGIN);
 const outsideObservedRange = enteredRate < ref.low - margin || enteredRate > ref.high + margin;
 if (!grosslyOff && !outsideObservedRange) return null;
 // Last word goes to what the user explicitly accepted for this description group. Judged against
 // each accepted rate individually rather than as a range, so accepting one value never quietly
 // blesses the span between it and some unrelated one: a row far from every accepted rate — the
 // 9.50 among a group of 10.10s — still gets flagged.
 const accepted = descriptionKey ? acceptedRates?.get(pairDescriptionKey(fromCode, toCode, descriptionKey)) : undefined;
 if (accepted?.some((rate) => Math.abs(enteredRate - rate) <= margin)) return null;
 return { transactionId, pairKey: pairKey(fromCode, toCode), enteredRate, referenceRate: ref.rate, sampleSize: ref.sampleSize };
}

// Convenience for checking an already-computed ledger row against its account's own currency.
export function checkLedgerEntry(
 entry: ClientLedgerEntry,
 accountCurrencyCode: string,
 samples: Map<string, RateSample[]>,
 acceptedRates?: Map<string, number[]>,
): RateAnomaly | null {
 if (entry.pendingRate) return null;
 // entry.description is already the per-side description (descriptionFrom/To falling back to the
 // shared one, see computeClientLedgers), i.e. exactly what sideDescription keyed the buckets by.
 return checkRate(
  entry.exchangeRate,
  entry.currencyCode,
  accountCurrencyCode,
  entry.transactionId,
  samples,
  normalizeDescriptionKey(entry.description ?? ''),
  acceptedRates,
 );
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

// `ts` orders a bucket chronologically so a transaction can be judged against only what came
// before it — see checkCommission.
type CommissionSample = { transactionId: number; commission: number; ts: number };

// Commission convention is frequently direction-dependent for a given relationship — e.g. a client
// who is never charged when paying out, only when receiving — so the side must be part of the
// bucket key, not folded into a single "this account with this counterparty" pool.
type CommissionRole = LegSide;

function commissionPairKey(accountId: number, counterpartyAccountId: number, role: CommissionRole, descriptionKey: string): string {
 return `${accountId}:${counterpartyAccountId}:${role}:${descriptionKey}`;
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

// Historical commission pool per (account, counterparty-account, direction, description) — not per
// account alone, not workspace-wide, and not merged across directions or transaction kinds.
// Commission practice is specific to one client-to-client relationship, to which way the money
// moved, AND to what kind of business the transaction is: the same two accounts routinely charge
// on one kind of transaction and never on another (observed live: a client charging ~0.9% on
// "turk euro" transfers while 46 of their 49 "factura" transfers carry none). Pooling those
// together lets the more common kind outvote the rarer one, so every transaction of the rarer kind
// reads as a deviation from a "convention" it never belonged to. Descriptions are whatever each
// workspace actually types — nothing here is specific to any user's vocabulary; a workspace that
// leaves descriptions blank simply forms one group and behaves as it did before.
//
// Commission is a universal field applied the same way for every transaction type except
// `adjustment` (a balance correction, not a real settled trade) — see
// computeTransactionSideNetChange, which has no type gate on commission either.
export function buildCommissionSamples(transactions: Transaction[]): Map<string, CommissionSample[]> {
 const samples = new Map<string, CommissionSample[]>();
 for (const tx of transactions) {
  if (tx.isArchived || tx.type === 'adjustment') continue;
  if (tx.accountFromId != null && tx.accountToId != null) {
   const ts = new Date(tx.createdAt).getTime();
   addSample(samples, commissionPairKey(tx.accountFromId, tx.accountToId, 'from', sideDescription(tx, 'from')), { transactionId: tx.id, commission: tx.commissionFrom, ts });
   addSample(samples, commissionPairKey(tx.accountToId, tx.accountFromId, 'to', sideDescription(tx, 'to')), { transactionId: tx.id, commission: tx.commissionTo, ts });
  }
 }
 // Chronological, tie-broken by id — the same ordering the ledger itself uses — so checkCommission
 // can take a prefix and get exactly "everything that happened before this transaction".
 for (const bucket of samples.values()) {
  bucket.sort((a, b) => a.ts - b.ts || a.transactionId - b.transactionId);
 }
 return samples;
}

// Core commission check, reused by both the export gate and the ledger-row badge.
//
// Only transactions RECORDED BEFORE this one count as evidence. Comparing against the whole
// bucket meant a transaction could be flagged for breaking a convention that only formed after it
// — most starkly the very first transaction of a relationship, which was judged entirely against
// its own future (observed live: a 0.8% transfer flagged because the five that came later were all
// 2.4%). "You've always done X, so why Y this time" is only a meaningful question about the past.
// A side effect worth knowing: deliberately changing a rate flags the first transaction at the new
// rate once, because at that moment it is genuinely indistinguishable from a typo.
export function checkCommission(
 enteredCommission: number,
 accountId: number,
 counterpartyAccountId: number | null,
 role: CommissionRole,
 description: string,
 transactionId: number,
 samples: Map<string, CommissionSample[]>,
): CommissionAnomaly | null {
 if (counterpartyAccountId == null) return null;
 const bucket = samples.get(commissionPairKey(accountId, counterpartyAccountId, role, normalizeDescriptionKey(description)));
 if (!bucket) return null;
 // The bucket is in chronological order, so everything before this transaction's own position is
 // its prior history. A transaction absent from the bucket (an unsaved edit being previewed) is
 // treated as happening now, so the whole bucket is its history.
 const ownIndex = bucket.findIndex((s) => s.transactionId === transactionId);
 const others = (ownIndex === -1 ? bucket : bucket.slice(0, ownIndex)).map((s) => s.commission);
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
 // entry.description is already the per-side description computeClientLedgers resolved, so it
 // matches the group buildCommissionSamples keyed this same row under.
 return checkCommission(entry.commission, accountId, entry.counterpartyAccountId, role, entry.description, entry.transactionId, samples);
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
export function buildWorkspaceAnomalies(transactions: Transaction[], ignored: Set<string>, ignoredAnomalies: IgnoredAnomaly[] = []): FlaggedAnomaly[] {
 const rateSamples = buildRateSamples(transactions);
 const commissionSamples = buildCommissionSamples(transactions);
 const acceptedRates = buildAcceptedRates(transactions, ignoredAnomalies);
 const flagged: FlaggedAnomaly[] = [];
 for (const tx of transactions) {
  if (tx.isArchived) continue;
  if (tx.accountFromId != null && !ignored.has(anomalyKey('rate', tx.id, tx.accountFromId))) {
   const rate = checkRate(tx.exchangeRateFrom, tx.currencyCode, tx.accountFromCurrencyCode, tx.id, rateSamples, sideDescription(tx, 'from'), acceptedRates);
   if (rate) flagged.push({ kind: 'rate', transactionId: tx.id, accountId: tx.accountFromId, enteredValue: rate.enteredRate, referenceValue: rate.referenceRate, sampleSize: rate.sampleSize });
  }
  if (tx.accountToId != null && !ignored.has(anomalyKey('rate', tx.id, tx.accountToId))) {
   const rate = checkRate(tx.exchangeRateTo, tx.currencyCode, tx.accountToCurrencyCode, tx.id, rateSamples, sideDescription(tx, 'to'), acceptedRates);
   if (rate) flagged.push({ kind: 'rate', transactionId: tx.id, accountId: tx.accountToId, enteredValue: rate.enteredRate, referenceValue: rate.referenceRate, sampleSize: rate.sampleSize });
  }
  if (tx.type === 'adjustment') continue;
  if (tx.accountFromId != null && !ignored.has(anomalyKey('commission', tx.id, tx.accountFromId))) {
   const commission = checkCommission(tx.commissionFrom, tx.accountFromId, tx.accountToId, 'from', sideDescription(tx, 'from'), tx.id, commissionSamples);
   if (commission) flagged.push({ kind: 'commission', transactionId: tx.id, accountId: tx.accountFromId, enteredValue: commission.enteredCommission, referenceValue: commission.referenceCommission, sampleSize: commission.sampleSize });
  }
  if (tx.accountToId != null && !ignored.has(anomalyKey('commission', tx.id, tx.accountToId))) {
   const commission = checkCommission(tx.commissionTo, tx.accountToId, tx.accountFromId, 'to', sideDescription(tx, 'to'), tx.id, commissionSamples);
   if (commission) flagged.push({ kind: 'commission', transactionId: tx.id, accountId: tx.accountToId, enteredValue: commission.enteredCommission, referenceValue: commission.referenceCommission, sampleSize: commission.sampleSize });
  }
 }
 return flagged;
}
