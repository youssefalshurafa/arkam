import { getCommissionAmount } from '@/shared/utils/commission';

// One distinct description found among a set of ledger rows, with its rows' amounts summed.
// The Commission Distribution report groups a client's transactions this way — by their own
// free-text description, not a pre-configured tag — so any name the user already writes on a
// transaction ("Milano", "Turkiye", "Invoice"...) becomes a classifiable bucket at calculation
// time. Sorted by total descending so the biggest buckets surface first. `count` is shown
// alongside the total so the user can tell a big number apart from a single large transaction
// versus many small ones grouped together.
export type DescriptionGroup = {
 description: string;
 total: number;
 count: number;
};

export function groupEntriesByDescription(entries: Array<{ description: string; amount: number }>): DescriptionGroup[] {
 const totals = new Map<string, { total: number; count: number }>();
 for (const entry of entries) {
  const key = entry.description.trim();
  if (!key) continue;
  const existing = totals.get(key);
  if (existing) {
   existing.total += entry.amount;
   existing.count += 1;
  } else {
   totals.set(key, { total: entry.amount, count: 1 });
  }
 }
 return Array.from(totals.entries())
  .map(([description, { total, count }]) => ({ description, total, count }))
  .sort((a, b) => b.total - a.total);
}

export type ReceivingSelection = { included: boolean; rate: number };

export type DistributionLocationBreakdown = {
 description: string;
 total: number;
 count: number;
 // Share of the total received across every *included* receiving description (0 when
 // nothing is included yet).
 percentOfReceived: number;
 // This description's prorated slice of totalSettled, by its percentOfReceived.
 proratedShare: number;
 commissionRate: number;
 commission: number;
};

export type DistributionBreakdown = {
 receiving: DistributionLocationBreakdown[];
 totalReceived: number;
 // Sum of every settlement description the user has marked as "settlement" (not ignored) —
 // multiple settlement descriptions are summed together since proration is driven by the
 // receiving side's percentages, not by which settlement description the money came through.
 totalSettled: number;
 totalCommission: number;
};

// Pure read model over the client's own transaction descriptions (see groupEntriesByDescription
// above) — mirrors the manual spreadsheet calculation the niche "open account" agent clients
// require: total received is split into per-description percentages, the settled total is
// prorated across those percentages, and each description's prorated share is multiplied by a
// commission rate the user assigns at calculation time. Descriptions the user hasn't marked
// "included"/"settlement" are excluded entirely — both from the math and from the totals —
// exactly as if they never happened, so the user opts each one in deliberately. Never touches
// computeAccountBalances/computeClientLedgers — this is a separate reporting dimension.
export function computeDistributionBreakdown({
 receivingGroups,
 settlementGroups,
 receivingSelections,
 settlementSelections,
}: {
 receivingGroups: DescriptionGroup[];
 settlementGroups: DescriptionGroup[];
 receivingSelections: Record<string, ReceivingSelection>;
 settlementSelections: Record<string, boolean>;
}): DistributionBreakdown {
 const includedReceiving = receivingGroups.filter((group) => receivingSelections[group.description]?.included);
 const totalReceived = includedReceiving.reduce((sum, group) => sum + group.total, 0);
 const totalSettled = settlementGroups.filter((group) => settlementSelections[group.description]).reduce((sum, group) => sum + group.total, 0);

 const receiving = includedReceiving.map((group): DistributionLocationBreakdown => {
  const rate = receivingSelections[group.description]?.rate ?? 0;
  const percentOfReceived = totalReceived > 0 ? group.total / totalReceived : 0;
  const proratedShare = percentOfReceived * totalSettled;
  const commission = getCommissionAmount(proratedShare, rate);
  return { description: group.description, total: group.total, count: group.count, percentOfReceived, proratedShare, commissionRate: rate, commission };
 });

 const totalCommission = receiving.reduce((sum, group) => sum + group.commission, 0);

 return { receiving, totalReceived, totalSettled, totalCommission };
}
