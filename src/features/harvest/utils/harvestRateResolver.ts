import type { HarvestRate } from '@/shared/types';

// Strict per-day lookup: the explicit rate for EXACTLY (targetDay, organizationId,
// currencyId), else NaN. No fallback to an earlier or later day — a day's rate is
// only ever affected by a save that explicitly targets that exact day, so editing
// one day's price can never change what an earlier or later day (including Overview,
// which always resolves for real "today") displays.
export function resolveHarvestRate(harvestRates: HarvestRate[], targetDay: string, organizationId: number | null, currencyId: number): number {
 const row = harvestRates.find((r) => r.day === targetDay && r.currencyId === currencyId && (r.organizationId ?? null) === organizationId);
 return row ? row.rate : NaN;
}
