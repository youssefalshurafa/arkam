import { describe, expect, it } from 'vitest';
import { buildAcceptedRates, buildRateSamples, checkRate, referenceRateFor } from './ledgerAnomalies';
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
});
