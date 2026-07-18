import { computeClientPendingPricingEntries, type PendingPricingEntry } from '@/features/clients/utils/clientBalances';
import type { ClientAccount, ClientAdjustment, Transaction } from '@/shared/types';

function isSameLocalDay(iso: string, day: string): boolean {
  return iso.slice(0, 10) === day;
}

// Per-client "waiting for pricing" rows for حصاد اليوم's viewed day — the exact same
// pending definition (and PendingPricingEntry shape) the organization page's client list
// and its popup use (see clientBalances.ts's isPendingTransactionFrom/To/isPendingAdjustment),
// just pre-filtered to this one day so Harvest's count/list matches whichever day the
// day-navigator is on. NOT the same thing as a missing harvest daily reference price
// (harvestBalance.ts / harvestRateResolver.ts) — a currency already priced for today can
// still have individual transactions nobody ever entered a rate for, and those are excluded
// from every balance calc (including this one) until fixed, which is what this surfaces.
export function computeHarvestAwaitingPricingByClient({ transactions, adjustments, clientAccounts, day }: {
  transactions: Transaction[];
  adjustments: ClientAdjustment[];
  clientAccounts: ClientAccount[];
  day: string;
}): Map<number, PendingPricingEntry[]> {
  const dayTransactions = transactions.filter((tx) => isSameLocalDay(tx.createdAt, day));
  const dayAdjustments = adjustments.filter((adj) => isSameLocalDay(adj.createdAt, day));
  return computeClientPendingPricingEntries({ clientAccounts, transactions: dayTransactions, adjustments: dayAdjustments });
}
