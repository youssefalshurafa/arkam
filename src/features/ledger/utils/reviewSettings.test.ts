import { describe, expect, it } from 'vitest';
import { DEFAULT_REVIEW_SETTINGS, REVIEW_LIMITS, resolveReviewSettings } from './reviewSettings';

describe('review settings', () => {
 it('gives a workspace that has never configured anything the shipped defaults', () => {
  // What every existing workspace gets: the column defaults to '{}', which must behave exactly
  // as the engine did before it was configurable.
  for (const stored of [{}, null, undefined, 'nonsense', 42]) {
   expect(resolveReviewSettings(stored), String(stored)).toEqual(DEFAULT_REVIEW_SETTINGS);
  }
 });

 it('keeps the rest of a partial object saved by a version with fewer knobs', () => {
  const resolved = resolveReviewSettings({ enabled: false, commission: { agreement: 0.75 } });
  expect(resolved.enabled).toBe(false);
  expect(resolved.commission.agreement).toBe(0.75);
  // Untouched fields fall back individually rather than dragging the whole object to default.
  expect(resolved.commission.minSamples).toBe(DEFAULT_REVIEW_SETTINGS.commission.minSamples);
  expect(resolved.rate).toEqual(DEFAULT_REVIEW_SETTINGS.rate);
 });

 it('clamps values that would break a check rather than trusting them', () => {
  const resolved = resolveReviewSettings({
   rate: { minSamples: 0 },
   commission: { minSamples: 10_000, agreement: 0.1, ceiling: { mode: 'fixed', value: -5 } },
  });
  expect(resolved.rate.minSamples).toBe(REVIEW_LIMITS.minSamples.min);
  expect(resolved.commission.minSamples).toBe(REVIEW_LIMITS.minSamples.max);
  expect(resolved.commission.agreement).toBe(REVIEW_LIMITS.agreement.min);
  expect(resolved.commission.ceiling).toEqual({ mode: 'fixed', value: REVIEW_LIMITS.ceiling.min });
 });

 it('falls back per field when a value is unreadable', () => {
  const resolved = resolveReviewSettings({ rate: { minSamples: 'abc', sensitivity: 'aggressive' }, warnOnExport: 'yes' });
  expect(resolved.rate.minSamples).toBe(DEFAULT_REVIEW_SETTINGS.rate.minSamples);
  expect(resolved.rate.sensitivity).toBe(DEFAULT_REVIEW_SETTINGS.rate.sensitivity);
  expect(resolved.warnOnExport).toBe(DEFAULT_REVIEW_SETTINGS.warnOnExport);
 });

 it('treats a ceiling without a usable value as measured rather than pinned at zero', () => {
  expect(resolveReviewSettings({ commission: { ceiling: { mode: 'auto', value: 3 } } }).commission.ceiling).toEqual({ mode: 'auto' });
  expect(resolveReviewSettings({ commission: { ceiling: {} } }).commission.ceiling).toEqual({ mode: 'auto' });
 });

 it('round-trips a fully specified object unchanged', () => {
  const settings = {
   enabled: true,
   rate: { enabled: false, sensitivity: 'strict' as const, minSamples: 12 },
   commission: { enabled: true, minSamples: 8, agreement: 0.8, ceiling: { mode: 'fixed' as const, value: 6.5 } },
   warnOnExport: false,
  };
  expect(resolveReviewSettings(settings)).toEqual(settings);
 });
});
