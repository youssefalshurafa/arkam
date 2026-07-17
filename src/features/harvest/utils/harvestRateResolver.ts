import type { HarvestRate } from '@/shared/types';

// "Last known value" lookup: the explicit rate from the latest day <= targetDay
// that has one for this exact (organizationId, currencyId), else NaN. Never writes;
// a day without its own explicit row simply displays whatever an earlier day set,
// and that earlier day's row is never touched by this lookup — so a past day can
// only ever change via an explicit save targeting that exact day.
export function resolveHarvestRate(harvestRates: HarvestRate[], targetDay: string, organizationId: number | null, currencyId: number): number {
 let best: HarvestRate | null = null;
 for (const r of harvestRates) {
  if (r.currencyId !== currencyId) continue;
  if ((r.organizationId ?? null) !== organizationId) continue;
  if (r.day > targetDay) continue;
  if (!best || r.day > best.day) best = r;
 }
 return best ? best.rate : NaN;
}

// Is there an EXPLICIT row on exactly this day (vs. inherited from an earlier
// day)? Lets a rates UI distinguish "set today" from "shown via fallback".
export function explicitHarvestRate(harvestRates: HarvestRate[], day: string, organizationId: number | null, currencyId: number): number | null {
 const row = harvestRates.find((r) => r.day === day && r.currencyId === currencyId && (r.organizationId ?? null) === organizationId);
 return row ? row.rate : null;
}
