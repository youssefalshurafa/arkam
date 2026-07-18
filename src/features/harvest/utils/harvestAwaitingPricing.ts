import { computeClientPendingPricingEntries, type PendingPricingEntry } from '@/features/clients/utils/clientBalances';
import type { ClientAccount, ClientAdjustment, Transaction } from '@/shared/types';

// Compare the wall-clock DATE embedded in createdAt (its first 10 chars) against the
// cutoff day. A string compare is timezone-proof — same convention as harvestBalance.ts's
// isOnOrBeforeDay.
function isOnOrBeforeDay(iso: string, day: string): boolean {
  return iso.slice(0, 10) <= day;
}

// Per-client "waiting for pricing" rows as of حصاد اليوم's viewed day — the exact same
// pending definition (and PendingPricingEntry shape) the organization page's client list
// and its popup use (see clientBalances.ts's isPendingTransactionFrom/To/isPendingAdjustment).
// Cumulative (every still-unpriced row created ON OR BEFORE the viewed day), matching the
// General Balance section right above it: a pending row is excluded from EVERY day's balance
// from its creation day onward until someone fixes it, so the backlog can only grow or shrink
// as rows get priced — it must never look smaller just because you moved a day forward, which
// a same-day-only filter would wrongly show. NOT the same thing as a missing harvest daily
// reference price (harvestBalance.ts / harvestRateResolver.ts) — a currency already priced for
// today can still have individual transactions nobody ever entered a rate for, and those stay
// excluded from every balance calc (including this one) until fixed, which is what this surfaces.
export function computeHarvestAwaitingPricingByClient({ transactions, adjustments, clientAccounts, day }: {
  transactions: Transaction[];
  adjustments: ClientAdjustment[];
  clientAccounts: ClientAccount[];
  day: string;
}): Map<number, PendingPricingEntry[]> {
  const cutoffTransactions = transactions.filter((tx) => isOnOrBeforeDay(tx.createdAt, day));
  const cutoffAdjustments = adjustments.filter((adj) => isOnOrBeforeDay(adj.createdAt, day));
  return computeClientPendingPricingEntries({ clientAccounts, transactions: cutoffTransactions, adjustments: cutoffAdjustments });
}
