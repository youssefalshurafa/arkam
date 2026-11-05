import { describe, expect, it } from 'vitest';
import { buildAcceptedCommissions, buildAcceptedRates, buildCommissionSamples, buildRateSamples, buildWorkspaceAnomalies, checkCommission, checkRate, describeCommissionCeiling, referenceRateFor } from './ledgerAnomalies';
import { DEFAULT_REVIEW_SETTINGS, type ReviewEngineSettings } from './reviewSettings';
import type { IgnoredAnomaly, Transaction } from '@/shared/types';

let nextId = 1;

// One cross-currency leg: `amount` is in `currencyCode`, credited to a MAD account at `rate`.
// `description` is what the workspace typed on the row — the engine groups by it without ever
// interpreting it, so these labels are arbitrary stand-ins for whatever any workspace uses.
function tx(currencyCode: string, rate: number, description = ''): Transaction {
 return {
  id: nextId++,
  isArchived: 0,
  currencyCode,
  accountFromId: null,
  accountFromCurrencyCode: null,
  accountToId: 10,
  accountToCurrencyCode: 'MAD',
  exchangeRateFrom: 0,
  exchangeRateTo: rate,
  description,
 } as unknown as Transaction;
}

// The record written when the user answers "normal for this description" on the ignore prompt.
function acceptedFor(row: Transaction): IgnoredAnomaly {
 return { id: row.id, kind: 'rate', transactionId: row.id, accountId: 10, scope: 'description', createdAt: '2026-09-04T00:00:00.000Z' };
}

function samplesFor(rows: Transaction[]) {
 return buildRateSamples(rows);
}

describe('exchange-rate anomaly detection', () => {
 // The reported miss: a ledger holding both USDT rows at 9.67 and EUR rows in the 10.40-10.90
 // band. A EUR row given the USDT rate is only ~9% off the EUR median, so the old +/-1.5x ratio
 // band waved it through even though it sits below every EUR rate ever recorded.
 it('flags a EUR rate borrowed from the USDT column', () => {
  const history = [
   ...[9.67, 9.67, 9.67, 9.67, 9.67, 9.67].map((r) => tx('USDT', r)),
   ...[10.9, 10.73, 10.6, 10.5, 10.45, 10.4].map((r) => tx('EUR', r)),
  ];
  const samples = samplesFor(history);
  const anomaly = checkRate(9.67, 'EUR', 'MAD', 999, samples);
  expect(anomaly).not.toBeNull();
  expect(anomaly?.enteredRate).toBe(9.67);
 });

 it('leaves the USDT rows themselves alone', () => {
  const history = [
   ...[9.67, 9.67, 9.67, 9.67, 9.67, 9.67].map((r) => tx('USDT', r)),
   ...[10.9, 10.73, 10.6, 10.5, 10.45, 10.4].map((r) => tx('EUR', r)),
  ];
  expect(checkRate(9.67, 'USDT', 'MAD', 999, samplesFor(history))).toBeNull();
 });

 it('accepts a rate inside the range the pair has actually traded at', () => {
  const samples = samplesFor([10.9, 10.73, 10.6, 10.5, 10.45, 10.4].map((r) => tx('EUR', r)));
  for (const rate of [10.4, 10.55, 10.9]) {
   expect(checkRate(rate, 'EUR', 'MAD', 999, samples)).toBeNull();
  }
 });

 // Ordinary drift past the edges must not become a nuisance flag — the margin exists for this.
 it('tolerates modest movement just outside the historical range', () => {
  const samples = samplesFor([10.9, 10.73, 10.6, 10.5, 10.45, 10.4].map((r) => tx('EUR', r)));
  expect(checkRate(10.3, 'EUR', 'MAD', 999, samples)).toBeNull();
  expect(checkRate(11.0, 'EUR', 'MAD', 999, samples)).toBeNull();
 });

 // A pair whose rate never moves would have a zero-width range; the floor margin keeps that
 // from flagging every trivial change.
 it('gives a perfectly stable pair room to move', () => {
  const samples = samplesFor([9.67, 9.67, 9.67, 9.67, 9.67, 9.67].map((r) => tx('USDT', r)));
  expect(checkRate(9.7, 'USDT', 'MAD', 999, samples)).toBeNull();
  expect(checkRate(10.6, 'USDT', 'MAD', 999, samples)).not.toBeNull();
 });

 it('still catches a gross multiply/divide mixup', () => {
  const samples = samplesFor([10.9, 10.73, 10.6, 10.5, 10.45, 10.4].map((r) => tx('EUR', r)));
  expect(checkRate(1 / 10.6, 'EUR', 'MAD', 999, samples)).not.toBeNull();
 });

 // Guardrail against noise on a pair with no track record.
 it('says nothing when the pair has too little history', () => {
  const samples = samplesFor([10.9, 10.73, 10.6].map((r) => tx('EUR', r)));
  expect(referenceRateFor(samples, 'EUR', 'MAD', 999)).toBeNull();
  expect(checkRate(9.67, 'EUR', 'MAD', 999, samples)).toBeNull();
 });

 // On a pool this small the trimmed bounds sit only a hair inside the extremes — percentiles
 // degrade gracefully toward min/max when there is no tail worth cutting.
 it('reports the trading band alongside the median', () => {
  const samples = samplesFor([10.9, 10.73, 10.6, 10.5, 10.45, 10.4].map((r) => tx('EUR', r)));
  const ref = referenceRateFor(samples, 'EUR', 'MAD', 999);
  expect(ref?.sampleSize).toBe(6);
  expect(ref?.low).toBeCloseTo(10.41, 2);
  expect(ref?.high).toBeCloseTo(10.88, 2);
 });

 // Shaped after the real EUR->MAD pool: 2242 rates centred on 10.80, and nine strays below 10.40
 // that are earlier instances of this same mistake. Those strays are why the band has to be
 // tail-trimmed — taken as the pair's true minimum they drag the floor down to ~9.3, which is
 // exactly low enough to wave 9.67 through. A check that learns from its own past misses is no
 // check at all.
 describe('with a history that already contains bad rates', () => {
  const realisticPool = () => {
   const rows: Transaction[] = [];
   for (let i = 0; i < 2233; i++) rows.push(tx('EUR', 10.45 + (i % 82) / 100));
   for (const stray of [9.67, 9.72, 10.0, 10.0, 10.0, 10.1, 10.1, 10.12, 10.3]) rows.push(tx('EUR', stray));
   return samplesFor(rows);
  };

  it('flags the USDT rate on a EUR row despite the strays', () => {
   expect(checkRate(9.67, 'EUR', 'MAD', 999, realisticPool())).not.toBeNull();
  });

  it('still accepts rates from the band the pair actually trades in', () => {
   const samples = realisticPool();
   for (const rate of [10.45, 10.8, 11.26]) {
    expect(checkRate(rate, 'EUR', 'MAD', 999, samples)).toBeNull();
   }
  });
 });

 it('excludes the row under test from its own reference', () => {
  const rows = [10.9, 10.73, 10.6, 10.5, 10.45, 10.4].map((r) => tx('EUR', r));
  const target = rows[0];
  const ref = referenceRateFor(samplesFor(rows), 'EUR', 'MAD', target.id);
  expect(ref?.sampleSize).toBe(5);
  expect(ref?.high).toBeCloseTo(10.72, 2);
 });

 // Shaped after the real workspace: one broad EUR pool, plus small and large sub-groups that trade
 // in visibly different bands. The labels below are arbitrary — the engine never reads them, it
 // only compares them for equality, so a workspace using any other vocabulary behaves the same.
 describe('description groups', () => {
  // A big group trading well above the pair-wide centre, and a small one trading below it.
  const wideRows = () => Array.from({ length: 200 }, (_, i) => tx('EUR', 10.55 + (i % 40) / 100, 'GROUP-A'));
  const highRows = () => [11.0, 11.05, 11.1, 11.15, 11.2, 11.25].map((r) => tx('EUR', r, 'GROUP-HIGH'));
  const smallRows = () => [10.0, 10.1, 10.12].map((r) => tx('EUR', r, 'GROUP-SMALL'));

  it('judges a big group against its own band, not the pooled one', () => {
   const samples = samplesFor([...wideRows(), ...highRows()]);
   // Comfortably inside the pooled EUR band, but far below what this group has ever traded at.
   expect(checkRate(10.6, 'EUR', 'MAD', 999, samples, 'group-high')).not.toBeNull();
   expect(checkRate(11.1, 'EUR', 'MAD', 999, samples, 'group-high')).toBeNull();
  });

  it('falls back to the pair-wide pool for a group with too little history', () => {
   const samples = samplesFor([...wideRows(), ...smallRows()]);
   const ref = referenceRateFor(samples, 'EUR', 'MAD', 999, 'group-small');
   expect(ref?.scopedToDescription).toBe(false);
   // Which is exactly why the small group still flags — the case the ignore prompt exists for.
   expect(checkRate(10.1, 'EUR', 'MAD', 999, samples, 'group-small')).not.toBeNull();
  });

  it('leaves a workspace that types no descriptions exactly as it was', () => {
   const samples = samplesFor([10.9, 10.73, 10.6, 10.5, 10.45, 10.4].map((r) => tx('EUR', r)));
   expect(referenceRateFor(samples, 'EUR', 'MAD', 999, '')?.scopedToDescription).toBe(false);
   expect(checkRate(10.55, 'EUR', 'MAD', 999, samples, '')).toBeNull();
   expect(checkRate(9.0, 'EUR', 'MAD', 999, samples, '')).not.toBeNull();
  });
 });

 // The user's own specification: accepting one row teaches the group what normal looks like there,
 // it does not switch the check off — "4 of them were between 10.10 and 10.15 and 1 was 9.5, this
 // one should still be flagged".
 describe('accepting a rate for a description group', () => {
  const wideRows = () => Array.from({ length: 200 }, (_, i) => tx('EUR', 10.55 + (i % 40) / 100, 'GROUP-A'));
  const build = () => {
   const small = [10.0, 10.1, 10.12].map((r) => tx('EUR', r, 'GROUP-SMALL'));
   const rows = [...wideRows(), ...small];
   return { rows, samples: samplesFor(rows), accepted: buildAcceptedRates(rows, [acceptedFor(small[0])]) };
  };

  it('clears the other rows in the group at a nearby rate', () => {
   const { samples, accepted } = build();
   for (const rate of [10.1, 10.12, 10.15]) {
    expect(checkRate(rate, 'EUR', 'MAD', 999, samples, 'group-small', accepted), `rate ${rate}`).toBeNull();
   }
  });

  it('keeps flagging a row in the same group at a clearly different rate', () => {
   const { samples, accepted } = build();
   expect(checkRate(9.5, 'EUR', 'MAD', 999, samples, 'group-small', accepted)).not.toBeNull();
  });

  it('does not leak the acceptance to another description', () => {
   const { samples, accepted } = build();
   expect(checkRate(10.1, 'EUR', 'MAD', 999, samples, 'group-other', accepted)).not.toBeNull();
  });

  // A plain per-row dismissal must not teach anything — that is what the prompt's two answers mean.
  it('ignores row-scoped dismissals as evidence', () => {
   const small = [10.0, 10.1, 10.12].map((r) => tx('EUR', r, 'GROUP-SMALL'));
   const rows = [...wideRows(), ...small];
   const rowScoped: IgnoredAnomaly = { ...acceptedFor(small[0]), scope: 'row' };
   expect(buildAcceptedRates(rows, [rowScoped]).size).toBe(0);
  });
 });

 // The reported nuisance (2026-11-05): the workspace's main currency dropped sharply within a week,
 // so every description group flagged its first row at the new price — "Jeddah" usually ~2.574,
 // this row 2.77. Neither "this row only" nor "normal for Jeddah" was true; the market had moved.
 describe('when the whole market moved', () => {
  const NOW = Date.parse('2026-11-03T12:00:00.000Z');
  const DAY = 24 * 60 * 60 * 1000;
  // A leg credited to `accountId` at `daysAgo` before NOW.
  const dated = (currencyCode: string, rate: number, description: string, accountId: number, daysAgo: number): Transaction =>
   ({ ...tx(currencyCode, rate, description), accountToId: accountId, createdAt: new Date(NOW - daysAgo * DAY).toISOString() }) as Transaction;
  const marketConfirmed = (row: Transaction): IgnoredAnomaly => ({ id: row.id, kind: 'rate', transactionId: row.id, accountId: row.accountToId as number, scope: 'market', createdAt: '2026-11-03T00:00:00.000Z' });

  // Months of history at the old level, each label at its own price.
  const oldHistory = () => [
   ...[2.57, 2.574, 2.578, 2.572, 2.576, 2.574, 2.575].map((r, i) => dated('SAR', r, 'Jeddah', 10, 30 + i * 5)),
   ...Array.from({ length: 20 }, (_, i) => dated('SAR', 2.59 + (i % 5) / 200, 'Riyadh', 11, 20 + i * 3)),
   ...Array.from({ length: 20 }, (_, i) => dated('SAR', 2.54 + (i % 5) / 200, 'Makkah', 12, 20 + i * 3)),
  ];
  const check = (rows: Transaction[], row: Transaction, ignored: IgnoredAnomaly[] = []) =>
   checkRate(row.exchangeRateTo, 'SAR', 'MAD', row.id, buildRateSamples(rows, DEFAULT_REVIEW_SETTINGS, ignored), 'jeddah');

  it('flags the first row at the new price when nothing else corroborates it', () => {
   const row = dated('SAR', 2.77, 'Jeddah', 10, 0);
   expect(check([...oldHistory(), row], row)).not.toBeNull();
  });

  it('clears it once other labels and clients moved by the same ratio this week', () => {
   const recent = [dated('SAR', 2.8, 'Riyadh', 11, 2), dated('SAR', 2.745, 'Makkah', 12, 1), dated('SAR', 2.79, 'Riyadh', 13, 3)];
   const row = dated('SAR', 2.77, 'Jeddah', 10, 0);
   expect(check([...oldHistory(), ...recent, row], row)).toBeNull();
  });

  it('still flags a rate the market did not move to', () => {
   const recent = [dated('SAR', 2.8, 'Riyadh', 11, 2), dated('SAR', 2.745, 'Makkah', 12, 1), dated('SAR', 2.79, 'Riyadh', 13, 3)];
   const row = dated('SAR', 3.05, 'Jeddah', 10, 0);
   expect(check([...oldHistory(), ...recent, row], row)).not.toBeNull();
  });

  // One client's ledger is one voice, however many rows it holds in the window.
  it('does not take several rows from a single account as the market', () => {
   const recent = [dated('SAR', 2.8, 'Riyadh', 11, 2), dated('SAR', 2.79, 'Riyadh', 11, 1), dated('SAR', 2.81, 'Riyadh', 11, 3)];
   const row = dated('SAR', 2.77, 'Jeddah', 10, 0);
   expect(check([...oldHistory(), ...recent, row], row)).not.toBeNull();
  });

  // The incident the band exists for (2026-09-04) must survive: a EUR row given the USDT rate,
  // while the EUR rows around it — the market — stayed where they were. Two copies of the same
  // slip in the row's own ledger must not vouch for it either.
  it('still flags a EUR row given the USDT rate, even repeated in the same ledger', () => {
   const rows = [
    ...Array.from({ length: 300 }, (_, i) => dated('EUR', 10.7 + (i % 5) / 20, 'Roma', 11 + (i % 2), 20 + i)),
    dated('EUR', 10.8, 'Roma', 11, 2),
    dated('EUR', 9.67, 'Roma', 10, 1),
    dated('EUR', 9.67, 'Roma', 10, 1),
   ];
   const row = dated('EUR', 9.67, 'Roma', 10, 0);
   rows.push(row);
   expect(checkRate(9.67, 'EUR', 'MAD', row.id, buildRateSamples(rows), 'roma')).not.toBeNull();
  });

  // A large pool's 98th percentile only moves once ~2% of its whole history sits at the new level;
  // corroboration is what spares the dozens of rows in between.
  it('clears a new-level row in a large pool once the move is corroborated', () => {
   const old = Array.from({ length: 2000 }, (_, i) => dated('EUR', 10.75 + (i % 11) / 100, '', 11 + (i % 3), 10 + (i % 300)));
   const recent = [dated('EUR', 11.6, '', 11, 1), dated('EUR', 11.62, '', 12, 2), dated('EUR', 11.58, '', 13, 3)];
   const row = dated('EUR', 11.6, '', 10, 0);
   const samples = buildRateSamples([...old, ...recent, row]);
   expect(checkRate(11.6, 'EUR', 'MAD', row.id, samples)).toBeNull();
   const alone = buildRateSamples([...old, row]);
   expect(checkRate(11.6, 'EUR', 'MAD', row.id, alone)).not.toBeNull();
  });

  // Shaped after the live SAR->MAD pool that prompted this (2026-11-05): ~2 rows a week, every
  // label following one market that climbed 2.56 -> 2.77 over six weeks. Jeddah's own history was
  // all from before the climb, while the latest rows of other labels sat right beside 2.77.
  it('follows a slow climb on a quiet pair', () => {
   const climb: Array<[number, string, number, number]> = [
    [2.628, 'Makkah', 263, 35], [2.627, 'Makkah', 337, 34], [2.65, 'Makkah', 337, 31], [2.67, 'Makkah', 337, 24],
    [2.67, 'Makkah', 263, 24], [2.69, 'Makkah', 337, 19], [2.693, 'Almadinah', 263, 18], [2.71, 'Almadinah', 263, 15],
    [2.71, 'Makkah', 337, 13], [2.728, 'Makkah', 263, 11], [2.775, 'Makkah', 337, 6],
   ];
   const rows = [
    ...[2.54, 2.56, 2.58, 2.6, 2.574, 2.563, 2.584].map((r, i) => dated('SAR', r, 'Jeddah', 263, 95 - i * 7)),
    ...Array.from({ length: 14 }, (_, i) => dated('SAR', 2.53 + (i % 4) / 100, 'Makkah', 337, 120 - i * 6)),
    ...climb.map(([r, label, account, daysAgo]) => dated('SAR', r, label, account, daysAgo)),
   ];
   const row = dated('SAR', 2.77, 'Jeddah', 267, 0);
   expect(check([...rows, row], row)).toBeNull();
   // …while a Jeddah row nowhere near where the market went still flags.
   const wrong = dated('SAR', 2.95, 'Jeddah', 267, 0);
   expect(check([...rows, wrong], wrong)).not.toBeNull();
  });

  // "The market rate changed" is the owner stating the move outright: one such answer vouches for
  // the pair's other rows around that time with no quorum — but not for rows a season away.
  it('lets a confirmed market move clear other labels nearby in time only', () => {
   const confirmed = dated('SAR', 2.8, 'Riyadh', 11, 1);
   const sameWeek = dated('SAR', 2.77, 'Jeddah', 10, 0);
   const rows = [...oldHistory(), confirmed, sameWeek];
   expect(check(rows, sameWeek)).not.toBeNull();
   expect(check(rows, sameWeek, [marketConfirmed(confirmed)])).toBeNull();

   const weeksLater = dated('SAR', 2.77, 'Jeddah', 10, -45);
   expect(check([...oldHistory(), confirmed, weeksLater], weeksLater, [marketConfirmed(confirmed)])).not.toBeNull();
  });
 });
});


// A two-sided leg between two client accounts, the shape buildCommissionSamples reads. `commission`
// is what the 'from' account charged, which is the side these tests interrogate; the 'to' side is
// left at zero. Account 10 is the ledger under test throughout.
let commissionClock = 0;
function commissionTx(commission: number, counterpartyAccountId = 20, description = ''): Transaction {
 return {
  id: nextId++,
  isArchived: 0,
  type: 'transfer',
  currencyCode: 'MAD',
  accountFromId: 10,
  accountFromCurrencyCode: 'MAD',
  accountToId: counterpartyAccountId,
  accountToCurrencyCode: 'MAD',
  exchangeRateFrom: 1,
  exchangeRateTo: 1,
  commissionFrom: commission,
  commissionTo: 0,
  description,
  descriptionFrom: description,
  descriptionTo: description,
  // Strictly increasing, so "recorded before this one" is well defined and every row built here
  // precedes the transaction id 999 the checks are run for.
  createdAt: new Date(Date.UTC(2026, 0, 1) + commissionClock++ * 86400000).toISOString(),
 } as unknown as Transaction;
}

// The same leg the other way round: account 10 is the 'to' side, i.e. it received.
function incomingTx(commission: number, counterpartyAccountId = 20, description = ''): Transaction {
 const row = commissionTx(0, counterpartyAccountId, description) as unknown as Record<string, unknown>;
 return { ...row, accountFromId: counterpartyAccountId, accountToId: 10, commissionFrom: 0, commissionTo: commission } as unknown as Transaction;
}

const outgoingTx = commissionTx;

// The check as the ledger runs it: account 10 charging counterparty 20 on an outgoing row.
function checkFor(commission: number, history: Transaction[], counterpartyAccountId: number | null = 20, description = '') {
 return checkCommission(commission, 10, counterpartyAccountId, 'from', description, 999, buildCommissionSamples(history));
}

describe('commission anomaly detection', () => {
 describe('scope ladder', () => {
  // The reported miss, in miniature: a client with a long, unbroken habit of charging nothing,
  // and a 5% typo on a counterparty they have only dealt with three times. The narrow bucket has
  // too little history to speak, so before the ladder existed nothing was flagged at all.
  it('falls back to the ledger-wide habit when this counterparty is too new', () => {
   const history = [
    ...Array.from({ length: 30 }, (_, i) => commissionTx(0, 100 + i)),
    ...[0, 0, 0].map(() => commissionTx(0, 20)),
   ];
   const anomaly = checkFor(5, history);
   expect(anomaly?.reason).toBe('convention');
   expect(anomaly?.scope).toBe('direction');
   expect(anomaly?.referenceCommission).toBe(0);
  });

  it('prefers the counterparty pair once it has enough history of its own', () => {
   const history = [
    ...Array.from({ length: 30 }, (_, i) => commissionTx(0, 100 + i)),
    ...Array.from({ length: 6 }, () => commissionTx(2, 20, 'alpha')),
   ];
   // A label with no history of its own drops to the pair, which always charges 2% — so 2% is
   // right here even though the wider ledger is at 0%, and 0% is the value that looks wrong.
   expect(checkFor(2, history, 20, 'beta')).toBeNull();
   expect(checkFor(0, history, 20, 'beta')?.scope).toBe('counterparty');
  });

  it('lets a label with its own history speak before the pair does', () => {
   const history = [
    ...Array.from({ length: 30 }, (_, i) => commissionTx(0, 100 + i)),
    ...Array.from({ length: 6 }, () => commissionTx(2, 20, 'alpha')),
   ];
   expect(checkFor(0, history, 20, 'alpha')?.scope).toBe('description');
  });

  // The behaviour the narrow buckets were introduced for, which the ladder must not undo: one
  // client charging ~0.9% on one kind of business and nothing on another.
  it('still judges a description group against itself alone', () => {
   const history = [
    ...Array.from({ length: 46 }, () => commissionTx(0, 20, 'factura')),
    ...Array.from({ length: 6 }, () => commissionTx(0.9, 20, 'turk euro')),
   ];
   expect(checkFor(0.9, history, 20, 'turk euro')).toBeNull();
   expect(checkFor(0, history, 20, 'factura')).toBeNull();
  });

  // Widening can only ever mix more practices in, and a mixed pool fails the near-unanimity test.
  it('stays silent when the wider scope has no single convention', () => {
   const history = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4].map((c, i) => commissionTx(c, 100 + i));
   expect(checkFor(5, history)).toBeNull();
  });

  // A rung that answers is the final word — no shopping further out for a pool that agrees.
  it('does not widen past a scope that answered but found no convention', () => {
   const history = [
    ...Array.from({ length: 30 }, (_, i) => commissionTx(0, 100 + i)),
    ...[0, 1, 0, 1, 2, 3].map((c) => commissionTx(c, 20)),
   ];
   expect(checkFor(5, history)).toBeNull();
  });

  it('judges against prior transactions only, never a convention formed later', () => {
   // The whole habit forms after the row under test, so at its own moment there was no habit.
   const subject = commissionTx(5, 20);
   const history = Array.from({ length: 30 }, (_, i) => commissionTx(0, 100 + i));
   expect(checkCommission(5, 10, 20, 'from', '', subject.id, buildCommissionSamples([subject, ...history]))).toBeNull();
  });

  // Direction is never merged away, because commission practice in this business routinely
  // differs between the two: the reported case was a client who charges 0.5% on everything he
  // receives and nothing on what he sends, flagged on his second-ever outgoing transfer.
  it('never judges one direction against the other direction habit', () => {
   const history = [
    // Eleven incoming rows at 0.5%, and one prior outgoing row — at 0.2%, deliberately unlike
    // the 0% entered here, so this tests the direction rule alone and not the precedent guard.
    ...Array.from({ length: 11 }, (_, i) => incomingTx(0.5, 100 + i)),
    outgoingTx(0.2, 20),
   ];
   expect(checkFor(0, history, 20)).toBeNull();
  });

  it('does not judge the first transaction in a new direction at all', () => {
   const history = Array.from({ length: 20 }, (_, i) => incomingTx(0.5, 100 + i));
   expect(checkFor(0, history, 20)).toBeNull();
  });

  // The direction rung still speaks when the direction being judged has its own history — this is
  // the miss the ladder was built for, and removing the merged rung must not take it away.
  it('still flags against the same direction own habit', () => {
   const history = Array.from({ length: 30 }, (_, i) => commissionTx(0, 100 + i));
   expect(checkFor(5, history, 20)?.scope).toBe('direction');
  });
 });

 describe('precedent in the row own group', () => {
  // A standing exception must not be flagged every time it is exercised. One prior row in the
  // row's own group carrying exactly this value is precedent, even though it is far too little
  // to establish a convention of its own.
  it('accepts a value this exact pair has settled at before', () => {
   const history = [
    ...Array.from({ length: 30 }, (_, i) => commissionTx(0.5, 100 + i)),
    ...[0, 0].map(() => commissionTx(0, 20)),
   ];
   expect(checkFor(0, history, 20)).toBeNull();
  });

  it('accepts on a single prior row of precedent', () => {
   const history = [
    ...Array.from({ length: 30 }, (_, i) => commissionTx(0, 100 + i)),
    commissionTx(0.9, 20),
   ];
   expect(checkFor(0.9, history, 20)).toBeNull();
  });

  // Precedent is for the value actually set before, not for "anything unlike the norm".
  it('keeps flagging a value the group has no precedent for', () => {
   const history = [
    ...Array.from({ length: 30 }, (_, i) => commissionTx(0, 100 + i)),
    commissionTx(0.9, 20),
   ];
   expect(checkFor(3, history, 20)?.reason).toBe('convention');
  });

  it('does not let precedent leak in from a different counterparty', () => {
   const history = [
    ...Array.from({ length: 30 }, (_, i) => commissionTx(0, 100 + i)),
    commissionTx(0.9, 77),
   ];
   expect(checkFor(0.9, history, 20)?.reason).toBe('convention');
  });

  // Repeating a value does not make it possible: the ceiling is about the number itself.
  it('does not let precedent excuse an impossible commission', () => {
   const history = [
    ...Array.from({ length: 40 }, (_, i) => commissionTx([0.5, 1, 2, 3, 4][i % 5], 100 + i)),
    commissionTx(10.7, 20),
   ];
   expect(checkFor(10.7, history, 20)?.reason).toBe('implausible');
  });
 });

 describe('implausibility ceiling', () => {
  // Enough recorded commissions for the workspace to have said what its own practice looks like.
  const workspaceHistory = () => Array.from({ length: 40 }, (_, i) => commissionTx([0.5, 1, 2, 3, 4][i % 5], 100 + i));

  // The first report: an exchange rate of 10.70 typed into the commission field, on a pairing with
  // no history behind it. The ladder has nothing to say; the ceiling does.
  it('flags a rate typed into the commission field with no relevant history', () => {
   const anomaly = checkFor(10.7, workspaceHistory(), 999);
   expect(anomaly?.reason).toBe('implausible');
   expect(anomaly?.enteredCommission).toBe(10.7);
  });

  it('measures the ceiling from the workspace, not from a number in the code', () => {
   // A workspace that genuinely deals in large commissions must not be flagged for its own norm.
   const large = Array.from({ length: 40 }, (_, i) => commissionTx([9, 10, 11, 12][i % 4], 100 + i));
   expect(checkFor(10.7, large, 999)?.reason).not.toBe('implausible');
   // Whereas the same value against a workspace of small commissions is out of the question.
   expect(checkFor(10.7, workspaceHistory(), 999)?.reason).toBe('implausible');
  });

  it('says nothing at all until the workspace has recorded enough commissions', () => {
   const barely = Array.from({ length: 4 }, (_, i) => commissionTx(1, 100 + i));
   expect(checkFor(10.7, barely, 999)).toBeNull();
  });

  it('flags a one-sided transaction, which has no counterparty to compare against', () => {
   expect(checkFor(10.7, workspaceHistory(), null)?.reason).toBe('implausible');
  });

  it('flags a negative commission of the same magnitude', () => {
   // The sign is direction (charged to / by the client), so implausibility is about magnitude.
   expect(checkFor(-10.7, workspaceHistory(), 999)?.reason).toBe('implausible');
  });

  it('leaves ordinary commissions alone', () => {
   for (const commission of [0, 0.5, 1, 2.4, 4]) {
    expect(checkFor(commission, workspaceHistory(), 999), `commission ${commission}`).toBeNull();
   }
  });
 });

 // The pre-existing behaviour, which the ladder widens rather than replaces.
 describe('established convention', () => {
  const history = () => Array.from({ length: 6 }, () => commissionTx(2.4, 20));

  it('flags a break from the convention', () => {
   const anomaly = checkFor(0.8, history());
   expect(anomaly?.reason).toBe('convention');
   expect(anomaly?.referenceCommission).toBe(2.4);
   expect(anomaly?.matchCount).toBe(6);
  });

  it('accepts a commission that matches the convention', () => {
   expect(checkFor(2.4, history())).toBeNull();
  });

  it('flags a fee turned into a rebate regardless of magnitude', () => {
   expect(checkFor(-2.4, history())?.reason).toBe('convention');
  });
 });
});

describe('honouring the workspace configuration', () => {
 // Enough history for both checks to have a firm opinion, so every test below turns on whether
 // the setting was honoured rather than on whether there was evidence.
 const commissionHistory = () => Array.from({ length: 30 }, (_, i) => commissionTx(0, 100 + i));
 const rateHistory = () => [10.9, 10.73, 10.6, 10.5, 10.45, 10.4].map((r) => tx('EUR', r));
 const withSettings = (patch: Partial<ReviewEngineSettings>): ReviewEngineSettings => ({ ...DEFAULT_REVIEW_SETTINGS, ...patch });

 it('says nothing at all when the engine is switched off', () => {
  const off = withSettings({ enabled: false });
  expect(checkRate(9.67, 'EUR', 'MAD', 999, buildRateSamples(rateHistory(), off))).toBeNull();
  expect(checkCommission(5, 10, 20, 'from', '', 999, buildCommissionSamples(commissionHistory(), off))).toBeNull();
  expect(buildWorkspaceAnomalies(rateHistory(), new Set(), [], off)).toEqual([]);
 });

 it('switches the two checks independently', () => {
  const ratesOnly = withSettings({ commission: { ...DEFAULT_REVIEW_SETTINGS.commission, enabled: false } });
  expect(checkRate(9.67, 'EUR', 'MAD', 999, buildRateSamples(rateHistory(), ratesOnly))).not.toBeNull();
  expect(checkCommission(5, 10, 20, 'from', '', 999, buildCommissionSamples(commissionHistory(), ratesOnly))).toBeNull();

  const commissionOnly = withSettings({ rate: { ...DEFAULT_REVIEW_SETTINGS.rate, enabled: false } });
  expect(checkRate(9.67, 'EUR', 'MAD', 999, buildRateSamples(rateHistory(), commissionOnly))).toBeNull();
  expect(checkCommission(5, 10, 20, 'from', '', 999, buildCommissionSamples(commissionHistory(), commissionOnly))).not.toBeNull();
 });

 it('widens and narrows the rate band with the sensitivity setting', () => {
  // A rate just outside the pair's observed range: relaxed lets it pass, strict does not.
  const at = (sensitivity: ReviewEngineSettings['rate']['sensitivity']) =>
   checkRate(11.2, 'EUR', 'MAD', 999, buildRateSamples(rateHistory(), withSettings({ rate: { ...DEFAULT_REVIEW_SETTINGS.rate, sensitivity } })));
  expect(at('strict')).not.toBeNull();
  expect(at('relaxed')).toBeNull();
 });

 it('waits for more history when the minimum sample size is raised', () => {
  const history = commissionHistory();
  expect(checkCommission(5, 10, 20, 'from', '', 999, buildCommissionSamples(history, DEFAULT_REVIEW_SETTINGS))).not.toBeNull();
  const patient = withSettings({ commission: { ...DEFAULT_REVIEW_SETTINGS.commission, minSamples: 50 } });
  expect(checkCommission(5, 10, 20, 'from', '', 999, buildCommissionSamples(history, patient))).toBeNull();
 });

 it('calls a looser habit a rule when the agreement threshold is lowered', () => {
  // Seven of ten prior rows at 0% — a 70% habit, short of the default 90%.
  const history = [
   ...Array.from({ length: 7 }, (_, i) => commissionTx(0, 100 + i)),
   ...Array.from({ length: 3 }, (_, i) => commissionTx(2, 200 + i)),
  ];
  expect(checkCommission(5, 10, 20, 'from', '', 999, buildCommissionSamples(history, DEFAULT_REVIEW_SETTINGS))).toBeNull();
  const eager = withSettings({ commission: { ...DEFAULT_REVIEW_SETTINGS.commission, agreement: 0.6 } });
  expect(checkCommission(5, 10, 20, 'from', '', 999, buildCommissionSamples(history, eager))?.referenceCommission).toBe(0);
 });

 it('uses a pinned ceiling instead of the measured one', () => {
  // Books full of small commissions would measure a ceiling well under 10.
  const history = Array.from({ length: 40 }, (_, i) => commissionTx([0.5, 1, 2, 3, 4][i % 5], 100 + i));
  const pinned = withSettings({ commission: { ...DEFAULT_REVIEW_SETTINGS.commission, ceiling: { mode: 'fixed', value: 20 } } });
  expect(buildCommissionSamples(history, pinned).ceiling).toBe(20);
  expect(checkCommission(10.7, 10, 999, 'from', '', 999, buildCommissionSamples(history, pinned))).toBeNull();
 });

 it('reports the measured ceiling regardless of what is pinned', () => {
  const history = Array.from({ length: 40 }, (_, i) => commissionTx([0.5, 1, 2, 3, 4][i % 5], 100 + i));
  const pinned = withSettings({ commission: { ...DEFAULT_REVIEW_SETTINGS.commission, ceiling: { mode: 'fixed', value: 20 } } });
  // The settings screen shows this next to the 'auto' option, so it must not follow the override.
  expect(buildCommissionSamples(history, pinned).ceiling).toBe(20);
  expect(describeCommissionCeiling(history).ceiling).toBe(buildCommissionSamples(history, DEFAULT_REVIEW_SETTINGS).ceiling);
 });

 it('traces the measured ceiling back to the rows it was taken from', () => {
  const history = Array.from({ length: 40 }, (_, i) => commissionTx([0.5, 1, 2, 3, 4][i % 5], 100 + i));
  const described = describeCommissionCeiling(history);
  expect(described.sampleSize).toBe(40);
  // Highest first, and every listed sample points at a row that can actually be opened.
  expect(described.samples[0].commission).toBe(4);
  expect(described.samples.map((s) => Math.abs(s.commission))).toEqual([...described.samples.map((s) => Math.abs(s.commission))].sort((a, b) => b - a));
  expect(history.some((tx) => tx.id === described.samples[0].transactionId)).toBe(true);
  // Exactly one anchor, and the ceiling is the headroom multiple of the percentile it sits at.
  expect(described.samples.filter((s) => s.isAnchor)).toHaveLength(1);
  expect(described.ceiling).toBeCloseTo((described.percentileValue ?? 0) * 2, 10);
 });

 it('reports no ceiling, and nothing to show, until the books say enough', () => {
  const described = describeCommissionCeiling(Array.from({ length: 4 }, (_, i) => commissionTx(1, 100 + i)));
  expect(described.ceiling).toBeNull();
  expect(described.samples).toEqual([]);
 });
});

// The reported case, in miniature: this client's "factura" work has always been at 0%, and has now
// moved to 1%. Every new factura row is judged against a history that is still overwhelmingly 0%
// (and, with a counterparty it hasn't dealt with before, against the account's ledger-wide 0%
// habit), so dismissing them one at a time could go on forever without the next row being judged
// any differently. Answering "normal for factura" once is what has to end it.
describe('accepting a commission for a description group', () => {
 // The record written when the user answers "normal for this description" on a commission flag.
 const acceptedCommissionFor = (row: Transaction): IgnoredAnomaly => ({
  id: row.id,
  kind: 'commission',
  transactionId: row.id,
  accountId: 10,
  scope: 'description',
  createdAt: '2026-09-12T00:00:00.000Z',
 });

 // A long 0% habit across many counterparties, plus the one row the user accepted at the new rate.
 const build = (acceptedScope: 'description' | 'row' = 'description') => {
  const zeroHabit = Array.from({ length: 30 }, (_, i) => commissionTx(0, 100 + i, 'factura'));
  const acceptedRow = commissionTx(1, 50, 'factura');
  const rows = [...zeroHabit, acceptedRow];
  return { rows, accepted: buildAcceptedCommissions(rows, [{ ...acceptedCommissionFor(acceptedRow), scope: acceptedScope }]) };
 };

 const check = (commission: number, rows: Transaction[], accepted: Map<string, number[]>, counterparty = 20, description = 'factura') =>
  checkCommission(commission, 10, counterparty, 'from', description, 999, buildCommissionSamples(rows), accepted);

 it('flags the new commission until it is accepted', () => {
  const { rows } = build();
  expect(check(1, rows, new Map())?.referenceCommission).toBe(0);
 });

 it('stops flagging the same practice afterwards, on any counterparty', () => {
  const { rows, accepted } = build();
  for (const counterparty of [20, 50, 999]) {
   expect(check(1, rows, accepted, counterparty), `counterparty ${counterparty}`).toBeNull();
  }
 });

 // 0.99% and 1% are the same practice typed twice, and the screenshot that prompted this had both.
 it('covers a value that is plainly the same commission', () => {
  const { rows, accepted } = build();
  for (const commission of [0.99, 1, 1.01]) {
   expect(check(commission, rows, accepted), `commission ${commission}`).toBeNull();
  }
 });

 it('keeps flagging a value that is nothing like the accepted one', () => {
  const { rows, accepted } = build();
  expect(check(0.2, rows, accepted)).not.toBeNull();
  expect(check(5, rows, accepted)).not.toBeNull();
  // A row back at 0% is not covered by the acceptance either — it passes on its own merits,
  // because 0% is still exactly what this account's history says, and both answers can be true
  // at once: the group now has two normal values, which is what a convention in transition is.
  expect(check(0, rows, accepted)).toBeNull();
 });

 it('does not leak the acceptance to another label', () => {
  const { rows, accepted } = build();
  expect(check(1, rows, accepted, 20, 'turk euro')).not.toBeNull();
 });

 // Commission practice routinely differs by direction (see CommissionScope), so accepting 1% on
 // what this account charges says nothing about what it is charged. The incoming rows give that
 // direction a 0% habit of its own, so this is a real flag being kept and not merely a row left
 // unjudged for want of history.
 it('does not leak the acceptance to the other direction', () => {
  const { rows, accepted } = build();
  const withIncoming = [...Array.from({ length: 30 }, (_, i) => incomingTx(0, 200 + i, 'factura')), ...rows];
  expect(checkCommission(1, 10, 20, 'to', 'factura', 999, buildCommissionSamples(withIncoming), accepted)).not.toBeNull();
 });

 // A plain per-row dismissal must teach nothing — that is what the prompt's two answers mean.
 it('ignores row-scoped dismissals as evidence', () => {
  const { rows, accepted } = build('row');
  expect(accepted.size).toBe(0);
  expect(check(1, rows, accepted)).not.toBeNull();
 });

 // A blank label is not a group: one acceptance there would exempt every unlabelled row at once.
 it('records nothing for an unlabelled row', () => {
  const row = commissionTx(1, 50);
  expect(buildAcceptedCommissions([row], [acceptedCommissionFor(row)]).size).toBe(0);
 });
});
