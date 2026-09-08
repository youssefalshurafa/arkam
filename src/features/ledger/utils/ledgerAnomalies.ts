import type { ClientLedgerEntry, IgnoredAnomaly, Transaction } from '@/shared/types';
import { DEFAULT_REVIEW_SETTINGS, SENSITIVITY_MULTIPLIER, type ReviewEngineSettings } from './reviewSettings';

// Every tunable below is the DEFAULT for its setting, not a fixed law: the workspace's own
// Second Accountant configuration (reviewSettings.ts) overrides the ones it exposes, and the
// rest describe the shape of a check rather than its strictness. None of it is consulted when
// the engine is switched off — the checks return early instead.
//
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
// Both are scaled by the workspace's chosen sensitivity (SENSITIVITY_MULTIPLIER): a smaller
// multiplier leaves less room around the band, and so flags more.
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
export type RateReference = {
 buckets: Map<string, RateSample[]>;
 // The workspace's configuration, captured when the reference was built so every check made
 // against it judges by the same rules — see reviewSettings.ts.
 settings: ReviewEngineSettings;
};

export function buildRateSamples(transactions: Transaction[], settings: ReviewEngineSettings = DEFAULT_REVIEW_SETTINGS): RateReference {
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
 return { buckets: samples, settings };
}

/**
 * Rates the user has explicitly accepted as normal for a description group, keyed the same way as
 * the grouped sample buckets. Built from the ignore records the user marked as applying to the
 * whole group (`scope: 'description'`) — a small group like a handful of rows for one destination
 * can never reach the minimum sample size on its own, so without this it would keep flagging.
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
 reference: RateReference,
 fromCode: string,
 toCode: string,
 excludeTransactionId: number,
 descriptionKey = '',
): { rate: number; sampleSize: number; low: number; high: number; scopedToDescription: boolean } | null {
 const minSamples = reference.settings.rate.minSamples;
 const others = (key: string) => (reference.buckets.get(key) ?? []).filter((s) => s.transactionId !== excludeTransactionId).map((s) => s.rate);
 // The row's own description group speaks for it when it has enough history of its own; only
 // then does the pair-wide pool step aside. A group below the threshold has no signal to offer,
 // so falling back is what keeps a brand-new label from being unjudged entirely.
 const grouped = descriptionKey ? others(pairDescriptionKey(fromCode, toCode, descriptionKey)) : [];
 const scopedToDescription = grouped.length >= minSamples;
 const pool = scopedToDescription ? grouped : others(pairKey(fromCode, toCode));
 if (pool.length < minSamples) return null;
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
 reference: RateReference,
 descriptionKey = '',
 acceptedRates?: Map<string, number[]>,
): RateAnomaly | null {
 const settings = reference.settings;
 if (!settings.enabled || !settings.rate.enabled) return null;
 if (!(enteredRate > 0)) return null;
 if (fromCode === toCode) {
  if (Math.abs(enteredRate - 1) < SAME_CURRENCY_TOLERANCE) return null;
  return { transactionId, pairKey: pairKey(fromCode, toCode), enteredRate, referenceRate: 1, sampleSize: 0 };
 }
 const ref = referenceRateFor(reference, fromCode, toCode, transactionId, descriptionKey);
 if (!ref) return null;
 const ratio = enteredRate / ref.rate;
 const grosslyOff = ratio > MAX_RATE_RATIO || ratio < MIN_RATE_RATIO;
 // Widen the pair's observed range before comparing — see RATE_SPREAD_MARGIN. Both bounds are
 // checked (not just the low one) so a rate borrowed from a stronger currency is caught the same
 // way as one borrowed from a weaker one.
 const sensitivity = SENSITIVITY_MULTIPLIER[settings.rate.sensitivity];
 const margin = Math.max((ref.high - ref.low) * RATE_SPREAD_MARGIN * sensitivity, ref.rate * RATE_FLOOR_MARGIN * sensitivity);
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
 reference: RateReference,
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
  reference,
  normalizeDescriptionKey(entry.description ?? ''),
  acceptedRates,
 );
}

// Commissions below this are treated as "effectively zero" — for deciding whether a scope's mode
// is a zero-commission convention, for comparing an entered value to it, and for keeping the
// blank rows out of the ceiling's pool.
const COMMISSION_ZERO_EPSILON = 0.01;
const MAX_COMMISSION_RATIO = 1.5;
const MIN_COMMISSION_RATIO = 1 / MAX_COMMISSION_RATIO;

// Even with the scope ladder below, a value that is absurd on its face goes unjudged when there
// is no history at all to compare it against — a brand-new workspace, or an account's very first
// transactions. So there is also a ceiling on what can be a commission at all.
//
// That ceiling is measured from the workspace's own books rather than fixed in code: what counts
// as a large commission is a fact about this business, and no number written here would stay true
// for the next one. The pool is every non-zero commission the workspace has recorded, on both
// sides of every transaction — the widest possible statement of "what this workspace calls a
// commission" — and the ceiling is a high percentile of it with room on top.
//
// The percentile rather than the maximum, for the same reason the rate band is trimmed (see
// RATE_LOW_PERCENTILE): real history already contains earlier instances of this very mistake, and
// measuring to the worst thing that ever happened teaches the check to accept it next time. The
// headroom on top is what keeps the ceiling a backstop against the grossly wrong rather than a
// second opinion on ordinary practice — that job belongs to the ladder, which knows far more
// about the row than a workspace-wide number ever can.
const CEILING_PERCENTILE = 0.98;
const CEILING_HEADROOM = 2;
// Below this many recorded commissions the workspace hasn't said enough about its own practice
// for a percentile to mean anything, and no ceiling is applied at all.
const MIN_CEILING_SAMPLE = 20;

export type CommissionAnomaly = {
 transactionId: number;
 accountId: number;
 enteredCommission: number;
 // Why this was flagged: 'convention' means it broke an established practice, in which case
 // referenceCommission/sampleSize/matchCount describe that practice and `scope` says whose it
 // was; 'implausible' means the value is too large to be a commission in this workspace at all,
 // and referenceCommission holds the ceiling it exceeded, with no sample behind it. The UI has
 // to explain the two differently — "you usually charge 2%" is meaningless with no history.
 reason: 'convention' | 'implausible';
 // Which rung of the ladder actually spoke (see COMMISSION_SCOPES). The UI must say what the
 // comparison was really against: claiming "transactions with this counterparty" when the
 // evidence was the whole ledger would send the user looking at the wrong rows.
 scope: CommissionScope;
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

// How far out a commission is judged. Narrowest first: each rung drops one dimension of
// specificity, and checkCommission uses the first that has enough history to speak.
//
//   description  — this account, this counterparty, this direction, rows labelled like this one
//   counterparty — this account and this counterparty in this direction, any label
//   direction    — this account in this direction, against anyone
//
// Only the narrowest rung existed before, which meant a client with hundreds of transactions and
// never once a commission was still unjudged the moment they dealt with a new counterparty, or
// used a new label, or had merely fewer rows than the minimum with that particular one.
// That is the miss this ladder fixes: 412 transactions on one ledger, every one of them at 0%,
// and a 5% typo on a counterparty with only three prior rows sailed through unremarked.
//
// Falling back is safe precisely because the agreement threshold is applied at whichever rung
// answers. Widening the pool can only ever mix in more practices, and a mixed pool fails the
// near-unanimity test and stays silent. So the wider rungs speak only when the account is
// consistent across everything they cover — which is exactly when their evidence is worth having.
// The narrow-first order is what preserves the reason the buckets were narrowed originally: a
// description group with enough history of its own is still judged against itself alone, so a
// client charging 0.9% on one kind of business and nothing on another is not flagged for either.
//
// The ladder stops at `direction` and there is deliberately no rung above it. Every dimension it
// does drop is a question of WHO or WHAT the transaction was; direction is a question of which
// way the money moved, and commission practice in this business routinely differs between the
// two — a client who charges 0.5% on everything he receives and nothing at all on what he sends
// is completely ordinary. A pool that merges the two directions is therefore not a wider view of
// one practice, it is two practices stacked, and the near-unanimity test cannot protect against
// that: the direction being judged is exactly the one with too little history to outvote anything,
// so the other direction's habit wins 11-to-1 and the row is flagged for obeying its own rule.
// That is a real miss this rung caused (observed live: a 0% row on a client's second-ever outgoing
// transfer, flagged against the 0.5% he charges on everything incoming). An account with too
// little history in the direction being judged is simply not judged.
type CommissionScope = 'description' | 'counterparty' | 'direction';

const COMMISSION_SCOPES: CommissionScope[] = ['description', 'counterparty', 'direction'];

function commissionKey(scope: CommissionScope, accountId: number, counterpartyAccountId: number | null, role: CommissionRole, descriptionKey: string): string {
 switch (scope) {
  case 'description':
   return `d:${accountId}:${counterpartyAccountId}:${role}:${descriptionKey}`;
  case 'counterparty':
   return `c:${accountId}:${counterpartyAccountId}:${role}`;
  case 'direction':
   return `r:${accountId}:${role}`;
 }
}

// Two commissions count as "the same value" when they agree at the commission input's own
// precision, so near-identical entries are one convention rather than several.
function roundCommission(value: number): number {
 return Math.round(value * 100) / 100;
}

// The most frequent value in a sample, how many samples share it,
// and its share of the sample — used to decide whether a pair's history is consistent enough to
// compare against, and to explain the flag to the user.
function modeWithShare(values: number[]): { mode: number; count: number; share: number } {
 const counts = new Map<number, number>();
 for (const v of values) {
  const key = roundCommission(v);
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

// Everything checkCommission compares a row against: the sample buckets at every scope of the
// ladder, plus the workspace's own implausibility ceiling. Built once and passed through, so the
// whole reference is derived from the same set of transactions.
export type CommissionReference = {
 buckets: Map<string, CommissionSample[]>;
 // What this workspace's books say is too large to be a commission at all, or null when they
 // haven't recorded enough commissions to say — see CEILING_PERCENTILE. A workspace that has
 // pinned the ceiling by hand gets that value here instead, measured from nothing.
 ceiling: number | null;
 // The workspace's configuration, captured when the reference was built so every check made
 // against it judges by the same rules — see reviewSettings.ts.
 settings: ReviewEngineSettings;
};

// Historical commission pools, one per scope of the ladder — see CommissionScope. Commission
// practice is specific to one client-to-client relationship, to which way the money moved, AND to
// what kind of business the transaction is: the same two accounts routinely charge on one kind
// and never on another (observed live: a client charging ~0.9% on "turk euro" transfers while 46
// of their 49 "factura" transfers carry none). Keeping those separate is why the narrow buckets
// exist and why they are consulted first; the wider ones exist so an account with a clear habit
// isn't left unjudged just because this particular pairing is new. Descriptions are whatever each
// workspace actually types — nothing here is specific to any user's vocabulary; a workspace that
// leaves descriptions blank simply forms one group per pairing, as it always did.
//
// Commission is a universal field applied the same way for every transaction type except
// `adjustment` (a balance correction, not a real settled trade) — see
// computeTransactionSideNetChange, which has no type gate on commission either.
export function buildCommissionSamples(transactions: Transaction[], settings: ReviewEngineSettings = DEFAULT_REVIEW_SETTINGS): CommissionReference {
 const buckets = new Map<string, CommissionSample[]>();
 const magnitudes: number[] = [];
 const addLeg = (accountId: number, counterpartyAccountId: number, role: CommissionRole, tx: Transaction, commission: number, ts: number) => {
  const sample = { transactionId: tx.id, commission, ts };
  const descriptionKey = sideDescription(tx, role);
  for (const scope of COMMISSION_SCOPES) {
   addSample(buckets, commissionKey(scope, accountId, counterpartyAccountId, role, descriptionKey), sample);
  }
  if (Math.abs(commission) >= COMMISSION_ZERO_EPSILON) magnitudes.push(Math.abs(commission));
 };
 for (const tx of transactions) {
  if (tx.isArchived || tx.type === 'adjustment') continue;
  if (tx.accountFromId != null && tx.accountToId != null) {
   const ts = new Date(tx.createdAt).getTime();
   addLeg(tx.accountFromId, tx.accountToId, 'from', tx, tx.commissionFrom, ts);
   addLeg(tx.accountToId, tx.accountFromId, 'to', tx, tx.commissionTo, ts);
  }
 }
 // Chronological, tie-broken by id — the same ordering the ledger itself uses — so checkCommission
 // can take a prefix and get exactly "everything that happened before this transaction".
 for (const bucket of buckets.values()) {
  bucket.sort((a, b) => a.ts - b.ts || a.transactionId - b.transactionId);
 }
 magnitudes.sort((a, b) => a - b);
 // A pinned ceiling is used as given; otherwise it is measured, and stays null until the books
 // have said enough for a percentile to mean anything.
 const measured = magnitudes.length >= MIN_CEILING_SAMPLE ? percentile(magnitudes, CEILING_PERCENTILE) * CEILING_HEADROOM : null;
 const ceiling = settings.commission.ceiling.mode === 'fixed' ? settings.commission.ceiling.value : measured;
 return { buckets, ceiling, settings };
}

// One recorded commission behind the measured ceiling, identified well enough to open the row
// it came from.
export type CommissionCeilingSample = {
 transactionId: number;
 accountId: number;
 commission: number;
 createdAt: string;
 // True for the sample the percentile actually landed on (or the nearer of the two it was
 // interpolated between) — the single row that most directly sets where the ceiling sits.
 isAnchor: boolean;
};

/**
 * The ceiling the engine would measure from these transactions on its own, regardless of whether
 * the workspace has pinned one, together with the evidence it rests on.
 *
 * The settings screen shows the number so the choice between measured and pinned is informed, and
 * the samples so it can be audited: a derived figure the user cannot trace back to real rows is
 * exactly the kind of thing that gets distrusted and overridden for no reason. `percentileValue`
 * is the raw percentile before the headroom multiplier, which is the value the listed commissions
 * can actually be compared against — the ceiling itself is deliberately larger than anything the
 * workspace has ever charged, so no row will ever equal it.
 */
export function describeCommissionCeiling(transactions: Transaction[]): {
 ceiling: number | null;
 percentileValue: number | null;
 sampleSize: number;
 // The largest recorded commissions, highest first — the top of the distribution the percentile
 // is taken from, which is the part worth looking at when judging whether the ceiling is right.
 samples: CommissionCeilingSample[];
} {
 const all: CommissionCeilingSample[] = [];
 for (const tx of transactions) {
  if (tx.isArchived || tx.type === 'adjustment') continue;
  if (tx.accountFromId == null || tx.accountToId == null) continue;
  const legs: Array<[number, number]> = [
   [tx.accountFromId, tx.commissionFrom],
   [tx.accountToId, tx.commissionTo],
  ];
  for (const [accountId, commission] of legs) {
   if (Math.abs(commission) < COMMISSION_ZERO_EPSILON) continue;
   all.push({ transactionId: tx.id, accountId, commission, createdAt: tx.createdAt, isAnchor: false });
  }
 }
 if (all.length < MIN_CEILING_SAMPLE) return { ceiling: null, percentileValue: null, sampleSize: all.length, samples: [] };
 const byMagnitude = [...all].sort((a, b) => Math.abs(a.commission) - Math.abs(b.commission));
 const percentileValue = percentile(byMagnitude.map((s) => Math.abs(s.commission)), CEILING_PERCENTILE);
 // Whichever recorded commission sits closest to the percentile is the row that set it — the
 // percentile is interpolated, so it rarely equals any single sample exactly.
 let anchorIndex = 0;
 for (let i = 1; i < byMagnitude.length; i++) {
  if (Math.abs(Math.abs(byMagnitude[i].commission) - percentileValue) < Math.abs(Math.abs(byMagnitude[anchorIndex].commission) - percentileValue)) anchorIndex = i;
 }
 byMagnitude[anchorIndex].isAnchor = true;
 return {
  ceiling: percentileValue * CEILING_HEADROOM,
  percentileValue,
  sampleSize: byMagnitude.length,
  samples: [...byMagnitude].reverse(),
 };
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
 reference: CommissionReference,
): CommissionAnomaly | null {
 const settings = reference.settings;
 if (!settings.enabled || !settings.commission.enabled) return null;
 // Before any of the history-based reasoning: a value above the workspace's own ceiling is not a
 // commission at all, and saying so needs no counterparty and no samples — see
 // CEILING_PERCENTILE. Placed above the null-counterparty return on purpose, so a one-sided
 // transaction (an expense, which has no counterparty account and therefore never reaches the
 // ladder below) is covered too.
 if (reference.ceiling != null && Math.abs(enteredCommission) > reference.ceiling) {
  return { transactionId, accountId, reason: 'implausible', scope: 'direction', enteredCommission, referenceCommission: reference.ceiling, sampleSize: 0, matchCount: 0 };
 }
 if (counterpartyAccountId == null) return null;
 const descriptionKey = normalizeDescriptionKey(description);
 // Walk the ladder narrowest-first and stop at the first rung with enough prior history to speak
 // for itself, so the most specific evidence available always wins — see CommissionScope.
 let scope: CommissionScope | null = null;
 let others: number[] = [];
 // Prior rows belonging to the narrower groups that were passed over for being too small. They
 // are too few to establish a convention, but not too few to be precedent — see below.
 const passedOver: number[] = [];
 for (const candidate of COMMISSION_SCOPES) {
  const bucket = reference.buckets.get(commissionKey(candidate, accountId, counterpartyAccountId, role, descriptionKey));
  if (!bucket) continue;
  // The bucket is in chronological order, so everything before this transaction's own position
  // is its prior history. A transaction absent from the bucket (an unsaved edit being previewed)
  // is treated as happening now, so the whole bucket is its history.
  const ownIndex = bucket.findIndex((s) => s.transactionId === transactionId);
  const prior = (ownIndex === -1 ? bucket : bucket.slice(0, ownIndex)).map((s) => s.commission);
  if (prior.length < settings.commission.minSamples) {
   passedOver.push(...prior);
   continue;
  }
  scope = candidate;
  others = prior;
  break;
 }
 if (scope == null) return null;
 const { mode, count, share } = modeWithShare(others);
 // No established convention at this scope (commission genuinely varies deal-to-deal) — nothing
 // to compare against, so never flag. Deliberately no attempt to widen further after a rung has
 // answered: a scope that disagrees with itself is evidence that practice here really is
 // variable, and pooling more of it in to find agreement would be shopping for a verdict.
 if (share < settings.commission.agreement) return null;

 const entered = enteredCommission;
 const modeIsZero = Math.abs(mode) < COMMISSION_ZERO_EPSILON;
 let flagged: boolean;
 if (modeIsZero) {
  // Nothing at this scope has ever carried commission — any nontrivial commission is a break.
  flagged = Math.abs(entered) >= COMMISSION_ZERO_EPSILON;
 } else if (Math.sign(entered) !== Math.sign(mode) && Math.abs(entered) >= COMMISSION_ZERO_EPSILON) {
  // A fee became a rebate (or vice versa) — a clear break regardless of magnitude.
  flagged = true;
 } else {
  // Magnitude break either way: entered back to zero when this scope always carries commission
  // (ratio 0/mode falls outside the bounds below, so this is covered by the same check), or an
  // outsized/undersized value relative to the established amount.
  const ratio = Math.abs(entered) / Math.abs(mode);
  flagged = !(ratio <= MAX_COMMISSION_RATIO && ratio >= MIN_COMMISSION_RATIO);
 }
 if (!flagged) return null;
 // Last word goes to the row's own narrower group. Whichever rung answered, the row also belongs
 // to smaller groups that were passed over for having too little history — and "too little to
 // establish a convention" is not the same as "nothing to say". A single prior row in the row's
 // own group carrying exactly the value entered here means the user has already done this, in
 // this precise situation, deliberately; a wider habit is not evidence against something that
 // narrow. Without this, a standing exception is flagged every single time it is exercised, which
 // is the most corrosive kind of false positive: it is correct behaviour that can never stop
 // being warned about (observed live: a pair settled at 0% twice, flagged both times against the
 // 0.5% the ledger charges everyone else).
 //
 // Deliberately a match against individual prior values rather than a range, exactly as the rate
 // check treats accepted rates: precedent for 0% is not precedent for everything below the norm.
 if (passedOver.some((prior) => roundCommission(prior) === roundCommission(enteredCommission))) return null;
 return { transactionId, accountId, reason: 'convention', scope, enteredCommission, referenceCommission: mode, sampleSize: others.length, matchCount: count };
}

// Convenience for checking an already-computed ledger row against its own account.
export function checkLedgerEntryCommission(
 entry: ClientLedgerEntry,
 accountId: number,
 reference: CommissionReference,
): CommissionAnomaly | null {
 if (entry.type === 'adjustment') return null;
 // 'outgoing' means this account was the transaction's "from" side (it sent/converted out);
 // 'incoming' means it was the "to" side (it received) — mirrors accountFromId/accountToId in
 // computeClientLedgers (ledgerBalances.ts), which is where `direction` is set.
 const role: CommissionRole = entry.direction === 'outgoing' ? 'from' : 'to';
 // entry.description is already the per-side description computeClientLedgers resolved, so it
 // matches the group buildCommissionSamples keyed this same row under.
 return checkCommission(entry.commission, accountId, entry.counterpartyAccountId, role, entry.description, entry.transactionId, reference);
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
export function buildWorkspaceAnomalies(
 transactions: Transaction[],
 ignored: Set<string>,
 ignoredAnomalies: IgnoredAnomaly[] = [],
 settings: ReviewEngineSettings = DEFAULT_REVIEW_SETTINGS,
): FlaggedAnomaly[] {
 // Switched off means the review queue is empty, not merely hidden — the whole scan is skipped.
 if (!settings.enabled) return [];
 const rateSamples = buildRateSamples(transactions, settings);
 const commissionSamples = buildCommissionSamples(transactions, settings);
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
