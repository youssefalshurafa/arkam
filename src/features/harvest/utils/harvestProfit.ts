import { computeTransactionSideNetChange } from '@/features/ledger/utils/ledgerBalances';
import type { ClientAccount, Currency, Transaction } from '@/shared/types';

// ---------------------------------------------------------------------------
// حصاد اليوم (Today's Harvest) — realized daily profit for a currency dealer.
//
// Profit in this business is NOT per-transaction: the house buys the same
// currency from many clients at different rates in different cities and sells
// from the *total pooled balance*. So cost is tracked as ONE weighted-average
// cost (WAC) pool per currency, and profit realizes only when a currency is
// genuinely sold (or paid away as a correspondent's commission).
//
// The driver is the house's NET POSITION change per currency, not per leg.
// The ledger's sign convention (see ledgerBalances.ts): a *negative* account
// balance means the client owes the house — i.e. the house HOLDS that currency.
// Therefore  house position = -(balance)  and, for a transaction,
//   Δposition(currency) = -(sum of that transaction's netChange on that currency's accounts).
// We reuse computeTransactionSideNetChange (the exact balance-engine formula,
// incl. commission, charges and pending-rate handling) and negate it, so the
// classification is independent of how "from"/"to" were entered.
//
// Per transaction, once we have the position delta of each currency it touched:
//   • Δ > 0  → the house ACQUIRED that currency (a buy). Cost = the main-currency
//     value it gave up (the counter currency's decrease). WAC updates.
//   • Δ < 0 with counter-value received → a SELL. realized = proceeds − WAC·|Δ|.
//   • Δ < 0 with NO counter-value → a realized COST at WAC (a correspondent's
//     commission the house paid, or the shrinking side of a same-currency
//     relocation). This is the correspondent's gain, never the house's.
//
// Valuation into the main currency prefers the ACTUAL main amount when the main
// currency is one side of the trade (the real dealt rate); it only falls back to
// the user-entered daily reference rate for foreign-to-foreign trades and for
// pricing free position gains.
// ---------------------------------------------------------------------------

// main-currency value of 1 unit of `currencyId`. Returns 1 for the main currency
// and NaN when a foreign currency has no reference rate set for the day.
export type RefRateResolver = (currencyId: number) => number;

const EPS = 1e-6;

export type CurrencyPool = { holding: number; costBasisMain: number };

type TxLeg = { currencyId: number; kind: 'buy' | 'sell' | 'cost'; units: number; mainValue: number };

type TxOutcome = {
  boughtMain: number;
  soldMain: number;
  realizedProfitMain: number;
  kind: HarvestTxKind;
  hasMissingRate: boolean;
  hasShortInventory: boolean;
  legs: TxLeg[];
  refNeededCurrencyIds: number[];
};

export type HarvestTxKind = 'buy' | 'sell' | 'cost' | 'mixed' | 'neutral';

export type HarvestTxRow = {
  transactionId: number;
  createdAt: string;
  clientFromName: string;
  clientToName: string;
  type: string;
  amount: number;
  currencyCode: string;
  currencySymbol: string;
  boughtMain: number;
  soldMain: number;
  realizedProfitMain: number;
  kind: HarvestTxKind;
  hasMissingRate: boolean;
  hasShortInventory: boolean;
};

export type HarvestCurrencyTurnover = {
  currencyId: number;
  code: string;
  symbol: string;
  boughtUnits: number;
  soldUnits: number;
  boughtMain: number;
  soldMain: number;
};

export type HarvestResult = {
  hasMainCurrency: boolean;
  mainCurrencyCode: string;
  rows: HarvestTxRow[];
  totalProfitMain: number;
  totalBoughtMain: number;
  totalSoldMain: number;
  turnover: HarvestCurrencyTurnover[];
  currenciesTradedToday: number;
  missingRateCount: number;
  neededRateCurrencyIds: number[];
};

function isSameLocalDay(iso: string, now: Date): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

// The house's realized profit/loss from processing one transaction, mutating the
// per-currency WAC pools. Returns the main-currency components for that row.
function processTransaction(
  tx: Transaction,
  pools: Map<number, CurrencyPool>,
  accountCurrencyOf: (accountId: number | null) => number | null,
  mainCurrencyId: number,
  refRate: RefRateResolver,
): TxOutcome {
  const fromCcy = accountCurrencyOf(tx.accountFromId);
  const toCcy = accountCurrencyOf(tx.accountToId);

  // Back-to-back pass-through (e.g. رضا → ينجى): both counterparties settle with the
  // house in the MAIN currency, while the deal is denominated in a FOREIGN currency
  // at a buy/sell spread (bought @10.70, sold @10.80). The house never holds the
  // foreign currency, so profit is simply the spread — independent of the WAC pool.
  // The generic position-delta path would net the two main legs together and see it
  // as a main-only cash move with no FX, missing this profit entirely.
  if (fromCcy === mainCurrencyId && toCcy === mainCurrencyId && tx.currencyId !== mainCurrencyId) {
    const boughtMain = computeTransactionSideNetChange(tx, mainCurrencyId, 'from'); // main committed to the buy side
    const soldMain = -computeTransactionSideNetChange(tx, mainCurrencyId, 'to'); // main claimed on the sell side
    const legs: TxLeg[] = [];
    if (boughtMain > EPS) legs.push({ currencyId: tx.currencyId, kind: 'buy', units: tx.amount, mainValue: boughtMain });
    if (soldMain > EPS) legs.push({ currencyId: tx.currencyId, kind: 'sell', units: tx.amount, mainValue: soldMain });
    return {
      boughtMain: Math.max(boughtMain, 0),
      soldMain: Math.max(soldMain, 0),
      realizedProfitMain: soldMain - boughtMain,
      kind: 'mixed', // صرف — a simultaneous buy+sell settled in the main currency
      hasMissingRate: false,
      hasShortInventory: false,
      legs,
      refNeededCurrencyIds: [],
    };
  }

  // Δposition per currency = -(netChange) summed across both legs.
  const deltas = new Map<number, number>();
  const addDelta = (currencyId: number | null, delta: number) => {
    if (currencyId == null || !Number.isFinite(delta)) return;
    deltas.set(currencyId, (deltas.get(currencyId) ?? 0) + delta);
  };
  if (fromCcy != null) addDelta(fromCcy, -computeTransactionSideNetChange(tx, fromCcy, 'from'));
  if (toCcy != null) addDelta(toCcy, -computeTransactionSideNetChange(tx, toCcy, 'to'));

  let boughtMain = 0;
  let soldMain = 0;
  let realized = 0;
  let hasMissingRate = false;
  let hasShortInventory = false;
  const legs: TxLeg[] = [];
  const refNeededCurrencyIds: number[] = [];

  const mainDelta = deltas.get(mainCurrencyId) ?? 0;
  const foreignEntries = [...deltas.entries()].filter(([ccy, d]) => ccy !== mainCurrencyId && Math.abs(d) > EPS);
  const mainInvolved = Math.abs(mainDelta) > EPS;

  const poolOf = (ccy: number): CurrencyPool => {
    let p = pools.get(ccy);
    if (!p) {
      p = { holding: 0, costBasisMain: 0 };
      pools.set(ccy, p);
    }
    return p;
  };

  // Reference-rate value of `units` of a foreign currency, in main. Used only when
  // the main currency is NOT the counter side (foreign-for-foreign / free gains).
  const refValue = (ccy: number, units: number): number => {
    refNeededCurrencyIds.push(ccy);
    const r = refRate(ccy);
    if (!Number.isFinite(r) || r <= 0) {
      hasMissingRate = true;
      return 0;
    }
    return units * r;
  };

  const increases = foreignEntries.filter(([, d]) => d > 0);
  const decreases = foreignEntries.filter(([, d]) => d < 0);
  let kind: HarvestTxKind = 'neutral';

  const disposeAtCost = (ccy: number, units: number): number => {
    const pool = poolOf(ccy);
    const wac = pool.holding > EPS ? pool.costBasisMain / pool.holding : 0;
    if (pool.holding <= EPS) hasShortInventory = true;
    const basisReleased = wac * units;
    pool.holding -= units; // may go negative (short) — a later buy trues it up
    pool.costBasisMain -= basisReleased;
    return basisReleased;
  };

  if (mainInvolved) {
    // A foreign leg settled with the MAIN currency: a buy (main out) or a sell (main in).
    for (const [ccy, delta] of foreignEntries) {
      if (delta > 0) {
        const cost = mainDelta < 0 ? Math.abs(mainDelta) : refValue(ccy, delta);
        const pool = poolOf(ccy);
        pool.holding += delta;
        pool.costBasisMain += cost;
        boughtMain += cost;
        kind = 'buy';
        legs.push({ currencyId: ccy, kind: 'buy', units: delta, mainValue: cost });
      } else {
        const unitCount = Math.abs(delta);
        const basisReleased = disposeAtCost(ccy, unitCount);
        const proceeds = mainDelta > 0 ? mainDelta : refValue(ccy, unitCount);
        soldMain += proceeds;
        realized += proceeds - basisReleased;
        kind = 'sell';
        legs.push({ currencyId: ccy, kind: 'sell', units: unitCount, mainValue: proceeds });
      }
    }
  } else if (increases.length === 1 && decreases.length === 1) {
    // Exchange (صرف) between two foreign currencies — the house converts its OWN
    // position (e.g. 200,000 EUR → USD within one client). No main currency changes
    // hands, so it is NOT a sale: carry the disposed currency's cost basis over to
    // the acquired currency and realize nothing now. Profit is realized later when
    // the acquired currency is sold for the main currency.
    const [decCcy, decDelta] = decreases[0];
    const [incCcy, incDelta] = increases[0];
    const carriedBasis = disposeAtCost(decCcy, Math.abs(decDelta));
    const incPool = poolOf(incCcy);
    incPool.holding += incDelta;
    incPool.costBasisMain += carriedBasis; // basis carries over — no P&L now
    kind = 'mixed';
    legs.push({ currencyId: decCcy, kind: 'sell', units: Math.abs(decDelta), mainValue: carriedBasis });
    legs.push({ currencyId: incCcy, kind: 'buy', units: incDelta, mainValue: carriedBasis });
  } else {
    // One-sided foreign change with no main counter: a correspondent's commission or
    // the shrinking leg of a same-currency relocation (a loss at WAC — the
    // correspondent's gain), or a rare free position gain (valued at the ref rate).
    for (const [ccy, delta] of foreignEntries) {
      if (delta < 0) {
        const unitCount = Math.abs(delta);
        const basisReleased = disposeAtCost(ccy, unitCount);
        realized += -basisReleased;
        kind = 'cost';
        legs.push({ currencyId: ccy, kind: 'cost', units: unitCount, mainValue: basisReleased });
      } else {
        const cost = refValue(ccy, delta);
        const pool = poolOf(ccy);
        pool.holding += delta;
        pool.costBasisMain += cost;
        boughtMain += cost;
        kind = 'buy';
        legs.push({ currencyId: ccy, kind: 'buy', units: delta, mainValue: cost });
      }
    }
  }

  return { boughtMain, soldMain, realizedProfitMain: realized, kind, hasMissingRate, hasShortInventory, legs, refNeededCurrencyIds };
}

// Whether a transaction should be considered at all: live (not archived) and
// two-sided. One-sided rows are treated as archive elsewhere in the app.
function isTradeable(tx: Transaction): boolean {
  return !tx.isArchived && tx.accountFromId != null && tx.accountToId != null;
}

/**
 * Replays ALL history in chronological order to build each currency's pooled WAC,
 * then surfaces only TODAY's transactions and the realized profit they produced.
 * Today's sells therefore draw down cost accumulated on earlier days.
 */
export function computeHarvest({
  transactions,
  clientAccounts,
  currencies,
  refRate,
  now = new Date(),
}: {
  transactions: Transaction[];
  clientAccounts: ClientAccount[];
  currencies: Currency[];
  refRate: RefRateResolver;
  now?: Date;
}): HarvestResult {
  const main = currencies.find((c) => c.isMain === 1) ?? null;
  const empty: HarvestResult = {
    hasMainCurrency: main != null,
    mainCurrencyCode: main?.code ?? '',
    rows: [],
    totalProfitMain: 0,
    totalBoughtMain: 0,
    totalSoldMain: 0,
    turnover: [],
    currenciesTradedToday: 0,
    missingRateCount: 0,
    neededRateCurrencyIds: [],
  };
  if (!main) return empty;

  const accountCurrency = new Map(clientAccounts.map((a) => [a.id, a.currencyId]));
  const accountCurrencyOf = (id: number | null) => (id == null ? null : accountCurrency.get(id) ?? null);
  const currencyById = new Map(currencies.map((c) => [c.id, c]));

  const ordered = transactions
    .filter(isTradeable)
    .slice()
    .sort((a, b) => {
      const d = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return d !== 0 ? d : a.id - b.id;
    });

  const pools = new Map<number, CurrencyPool>();
  const rows: HarvestTxRow[] = [];
  const turnoverMap = new Map<number, HarvestCurrencyTurnover>();
  const neededRates = new Set<number>();

  for (const tx of ordered) {
    const outcome = processTransaction(tx, pools, accountCurrencyOf, main.id, refRate);
    if (!isSameLocalDay(tx.createdAt, now)) continue; // seed only — not displayed

    rows.push({
      transactionId: tx.id,
      createdAt: tx.createdAt,
      clientFromName: tx.clientFromName,
      clientToName: tx.clientToName,
      type: tx.type,
      amount: tx.amount,
      currencyCode: tx.currencyCode,
      currencySymbol: tx.currencySymbol,
      boughtMain: outcome.boughtMain,
      soldMain: outcome.soldMain,
      realizedProfitMain: outcome.realizedProfitMain,
      kind: outcome.kind,
      hasMissingRate: outcome.hasMissingRate,
      hasShortInventory: outcome.hasShortInventory,
    });

    // Turnover (buys/sells only, not commission costs) — valued consistently with the
    // KPIs since legs carry the actual main value used in the P&L calc.
    for (const leg of outcome.legs) {
      if (leg.kind === 'cost') continue;
      const meta = currencyById.get(leg.currencyId);
      let row = turnoverMap.get(leg.currencyId);
      if (!row) {
        row = { currencyId: leg.currencyId, code: meta?.code ?? '', symbol: meta?.symbol ?? '', boughtUnits: 0, soldUnits: 0, boughtMain: 0, soldMain: 0 };
        turnoverMap.set(leg.currencyId, row);
      }
      if (leg.kind === 'buy') {
        row.boughtUnits += leg.units;
        row.boughtMain += leg.mainValue;
      } else {
        row.soldUnits += leg.units;
        row.soldMain += leg.mainValue;
      }
    }
    // Only currencies whose valuation actually needed a reference rate (foreign-to-
    // foreign trades) — deals priced against the main currency need no input.
    for (const ccy of outcome.refNeededCurrencyIds) neededRates.add(ccy);
  }

  rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.transactionId - a.transactionId);

  const totalProfitMain = rows.reduce((s, r) => s + (Number.isFinite(r.realizedProfitMain) ? r.realizedProfitMain : 0), 0);
  const totalBoughtMain = rows.reduce((s, r) => s + r.boughtMain, 0);
  const totalSoldMain = rows.reduce((s, r) => s + r.soldMain, 0);
  const missingRateCount = rows.filter((r) => r.hasMissingRate).length;

  return {
    hasMainCurrency: true,
    mainCurrencyCode: main.code,
    rows,
    totalProfitMain,
    totalBoughtMain,
    totalSoldMain,
    turnover: [...turnoverMap.values()].sort((a, b) => b.soldMain + b.boughtMain - (a.soldMain + a.boughtMain)),
    currenciesTradedToday: turnoverMap.size,
    missingRateCount,
    neededRateCurrencyIds: [...neededRates],
  };
}
