import { computeTransactionSideNetChange } from '@/features/ledger/utils/ledgerBalances';
import { localDateKey } from '@/shared/utils/date';
import type { ClientAccount, Currency, Transaction } from '@/shared/types';

// ---------------------------------------------------------------------------
// حصاد اليوم (Today's Harvest) — incoming/outgoing daily flow, in the main
// currency, at manually-entered reference prices.
//
// Deliberately simpler than the retired profit engine (harvestProfit.ts, kept
// in the repo unused): no weighted-average-cost pooling, no full-history
// replay. Direction is derived straight from the ledger's from/to legs — NOT
// the transaction's `type` field, because a single transaction can be a buy
// from one client and a sell to another at once (a pass-through), so `type`
// alone is not a reliable classifier. Each leg's house position delta comes
// from computeTransactionSideNetChange (negated — see ledgerBalances.ts): a
// positive delta means the house's holding of that leg's currency increased
// (money flowing IN), negative means it decreased (money flowing OUT).
//
// `type === 'transfer'` transactions are excluded outright (not a trade).
// ---------------------------------------------------------------------------

export type RefRateResolver = (currencyId: number, accountId: number | null) => number;

const EPS = 1e-6;

export type HarvestFlowDirection = 'in' | 'out';

export type HarvestFlowEntry = {
  transactionId: number;
  createdAt: string;
  clientName: string;
  accountId: number | null;
  currencyId: number;
  code: string;
  symbol: string;
  units: number;
  direction: HarvestFlowDirection;
  mainValue: number;
  hasMissingRate: boolean;
};

export type HarvestCurrencyFlowTotal = {
  currencyId: number;
  code: string;
  symbol: string;
  units: number;
  mainValue: number;
};

export type HarvestFlowResult = {
  hasMainCurrency: boolean;
  mainCurrencyCode: string;
  incoming: HarvestFlowEntry[];
  outgoing: HarvestFlowEntry[];
  incomingByCurrency: HarvestCurrencyFlowTotal[];
  outgoingByCurrency: HarvestCurrencyFlowTotal[];
  totalIncomingMain: number;
  totalOutgoingMain: number;
  netMain: number;
  txCount: number;
  missingRateCount: number;
  neededRateCurrencyIds: number[];
};

function isSameLocalDay(iso: string, day: string): boolean {
  return iso.slice(0, 10) === day;
}

// Live (not archived), two-sided, and an actual trade (not a plain transfer).
function isFlowEligible(tx: Transaction): boolean {
  return !tx.isArchived && tx.accountFromId != null && tx.accountToId != null && tx.type !== 'transfer';
}

function currencyTotals(entries: HarvestFlowEntry[]): HarvestCurrencyFlowTotal[] {
  const map = new Map<number, HarvestCurrencyFlowTotal>();
  for (const entry of entries) {
    let row = map.get(entry.currencyId);
    if (!row) {
      row = { currencyId: entry.currencyId, code: entry.code, symbol: entry.symbol, units: 0, mainValue: 0 };
      map.set(entry.currencyId, row);
    }
    row.units += entry.units;
    row.mainValue += entry.mainValue;
  }
  return [...map.values()].sort((a, b) => b.mainValue - a.mainValue);
}

export function computeHarvestFlow({
  transactions,
  clientAccounts,
  currencies,
  refRate,
  day = localDateKey(),
}: {
  transactions: Transaction[];
  clientAccounts: ClientAccount[];
  currencies: Currency[];
  refRate: RefRateResolver;
  day?: string;
}): HarvestFlowResult {
  const main = currencies.find((c) => c.isMain === 1) ?? null;
  const base: HarvestFlowResult = {
    hasMainCurrency: main != null,
    mainCurrencyCode: main?.code ?? '',
    incoming: [],
    outgoing: [],
    incomingByCurrency: [],
    outgoingByCurrency: [],
    totalIncomingMain: 0,
    totalOutgoingMain: 0,
    netMain: 0,
    txCount: 0,
    missingRateCount: 0,
    neededRateCurrencyIds: [],
  };
  if (!main) return base;

  const accountCurrency = new Map(clientAccounts.map((a) => [a.id, a.currencyId]));
  const accountCurrencyOf = (id: number | null) => (id == null ? null : accountCurrency.get(id) ?? null);
  const currencyById = new Map(currencies.map((c) => [c.id, c]));

  const todaysTx = transactions.filter((tx) => isFlowEligible(tx) && isSameLocalDay(tx.createdAt, day));

  const incoming: HarvestFlowEntry[] = [];
  const outgoing: HarvestFlowEntry[] = [];
  const neededRates = new Set<number>();
  let missingRateCount = 0;

  const pushLeg = (tx: Transaction, side: 'from' | 'to') => {
    const accountId = side === 'from' ? tx.accountFromId : tx.accountToId;
    const currencyId = accountCurrencyOf(accountId);
    if (currencyId == null) return;
    const delta = -computeTransactionSideNetChange(tx, currencyId, side);
    if (!Number.isFinite(delta) || Math.abs(delta) < EPS) return;

    const units = Math.abs(delta);
    let mainValue: number;
    let hasMissingRate = false;
    if (currencyId === main!.id) {
      mainValue = units;
    } else {
      neededRates.add(currencyId);
      const rate = refRate(currencyId, accountId);
      if (!Number.isFinite(rate) || rate <= 0) {
        hasMissingRate = true;
        missingRateCount += 1;
        mainValue = 0;
      } else {
        mainValue = units * rate;
      }
    }

    const meta = currencyById.get(currencyId);
    const entry: HarvestFlowEntry = {
      transactionId: tx.id,
      createdAt: tx.createdAt,
      clientName: side === 'from' ? tx.clientFromName : tx.clientToName,
      accountId,
      currencyId,
      code: meta?.code ?? '',
      symbol: meta?.symbol ?? '',
      units,
      direction: delta > 0 ? 'in' : 'out',
      mainValue,
      hasMissingRate,
    };
    (entry.direction === 'in' ? incoming : outgoing).push(entry);
  };

  for (const tx of todaysTx) {
    pushLeg(tx, 'from');
    pushLeg(tx, 'to');
  }

  const byTime = (a: HarvestFlowEntry, b: HarvestFlowEntry) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.transactionId - b.transactionId;
  incoming.sort(byTime);
  outgoing.sort(byTime);

  const totalIncomingMain = incoming.reduce((s, e) => s + e.mainValue, 0);
  const totalOutgoingMain = outgoing.reduce((s, e) => s + e.mainValue, 0);

  return {
    hasMainCurrency: true,
    mainCurrencyCode: main.code,
    incoming,
    outgoing,
    incomingByCurrency: currencyTotals(incoming),
    outgoingByCurrency: currencyTotals(outgoing),
    totalIncomingMain,
    totalOutgoingMain,
    netMain: totalIncomingMain - totalOutgoingMain,
    txCount: todaysTx.length,
    missingRateCount,
    neededRateCurrencyIds: [...neededRates],
  };
}
