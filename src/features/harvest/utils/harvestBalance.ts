import { computeOverviewBalances } from '@/features/overview/utils/overviewBalances';
import type { Client, ClientAccount, ClientAdjustment, Currency, OverviewBalanceGroup, Transaction } from '@/shared/types';

// ---------------------------------------------------------------------------
// حصاد اليوم (Today's Harvest) — general-balance profit/loss.
//
// Sidesteps the whole "was this transaction a buy or a sell" question: net worth
// change over a day IS the profit, regardless of how it moved. "General balance" is
// built on the same underlying numbers as the Overview page's grand total
// (computeOverviewBalances, itself built on the shared computeAccountBalances) —
// just re-run with a cutoff date, once for today and once for the day before — but
// SIGN-FLIPPED from it: Overview's total is signed from the client's side (positive
// = you owe the client), while here we want the owner's own asset position, its
// mirror image, so profit/loss reads correctly (client owing you more = profit).
//
// Rate grouping matches Overview's: balances are grouped by organizationId only
// (every organization-less client merged into one "no organization" bucket), NOT
// harvest's old per-client grouping — "the same general balance as the overview"
// means the same grouping too.
// ---------------------------------------------------------------------------

export type RefRateResolver = (currencyId: number, organizationId: number | null) => number;

export type GeneralBalanceOrgTotal = {
  organizationId: number | null;
  organizationName: string | null;
  totalMain: number;
  rateMissing: boolean;
};

export type GeneralBalanceResult = {
  orgTotals: GeneralBalanceOrgTotal[];
  totalMain: number;
  anyRateMissing: boolean;
  // The raw per-(organization, currency) balance groups the org totals were rolled up
  // from (as of `day`) — exposed so callers needing per-currency detail (e.g. which
  // currencies actually need a price for which organization) don't have to re-run
  // computeOverviewBalances themselves.
  groups: OverviewBalanceGroup[];
};

// Compare the wall-clock DATE embedded in createdAt (its first 10 chars) against the
// cutoff day. A string compare is timezone-proof.
function isOnOrBeforeDay(iso: string, day: string): boolean {
  return iso.slice(0, 10) <= day;
}

export function computeGeneralBalance({
  transactions,
  adjustments,
  clientAccounts,
  clients,
  currencies,
  language,
  day,
  refRate,
}: {
  transactions: Transaction[];
  adjustments: ClientAdjustment[];
  clientAccounts: ClientAccount[];
  clients: Client[];
  currencies: Currency[];
  language: string;
  // The cutoff day (local yyyy-mm-dd, inclusive) balances are computed as of.
  day: string;
  refRate: RefRateResolver;
}): GeneralBalanceResult {
  const cutoffTransactions = transactions.filter((tx) => isOnOrBeforeDay(tx.createdAt, day));
  const cutoffAdjustments = adjustments.filter((adj) => isOnOrBeforeDay(adj.createdAt, day));

  const balances = computeOverviewBalances({
    transactions: cutoffTransactions,
    adjustments: cutoffAdjustments,
    clientAccounts,
    clients,
    currencies,
    language,
  });

  // Iterate balances.byOrg (not the flat .groups) so an organization whose every
  // currency group has settled to exactly zero is dropped here too — same rule
  // computeOverviewBalances already applies for the Overview page's own org list.
  const orgTotals: GeneralBalanceOrgTotal[] = [];
  for (const [, orgGroups] of balances.byOrg) {
    let totalMain = 0;
    let rateMissing = false;
    for (const group of orgGroups) {
      const rate = group.isMain ? 1 : refRate(group.currencyId, group.organizationId);
      if (!Number.isFinite(rate)) {
        rateMissing = true;
        continue;
      }
      totalMain += group.total * rate;
    }
    // computeOverviewBalances totals are signed from the CLIENT's side (positive = you
    // owe the client, negative = the client owes you — see accountBalances.ts /
    // adjustment debit-credit convention). Harvest reports the OWNER's asset position,
    // which is the mirror image, so flip the sign here before it becomes "profit/loss".
    orgTotals.push({ organizationId: orgGroups[0].organizationId, organizationName: orgGroups[0].organizationName, totalMain: -totalMain, rateMissing });
  }
  orgTotals.sort((a, b) => (a.organizationName ?? '').localeCompare(b.organizationName ?? '', language, { sensitivity: 'base' }));
  const totalMain = orgTotals.reduce((s, o) => s + o.totalMain, 0);
  const anyRateMissing = orgTotals.some((o) => o.rateMissing);

  return { orgTotals, totalMain, anyRateMissing, groups: balances.groups };
}
