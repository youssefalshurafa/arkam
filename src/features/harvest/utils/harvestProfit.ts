import { computeTransactionSideNetChange } from '@/features/ledger/utils/ledgerBalances';
import type { ClientAccount, Currency, Transaction } from '@/shared/types';

// ---------------------------------------------------------------------------
// حصاد اليوم (Today's Harvest) — realized daily profit for a currency dealer.
//
// TYPE-DRIVEN model. Rather than inferring each transaction's role from account
// currencies and balance direction (fragile — it produced wrong numbers on real
// data), the user declares the role via the transaction `type`:
//   • buy   → add the traded currency to its weighted-average-cost (WAC) pool at
//             the main-currency cost paid. No profit.
//   • sell  → remove from the pool: realized = main proceeds − WAC × units. Profit
//             is booked here.
//   • exchange (صرف) → convert currency A→B: carry A's cost basis over to B. No
//             profit now (it surfaces when B is later sold).
//   • transfer → debt settlement / money movement: touches no pool, never profit.
//   • adjustment / legacy transfer/exchange → treated as transfer/exchange above.
//
// Magnitudes come from the balance engine's signed net-change
// (computeTransactionSideNetChange), negated to express the house's POSITION
// change (a negative account balance means the client owes the house, i.e. the
// house holds that currency — see ledgerBalances.ts). Commissions/charges are
// already inside those net-changes, so they fold naturally into buy cost and
// sell proceeds.
//
// Pools are seeded from an OPENING inventory (quantity + average cost per
// currency, as of a date the user enters) so currency accumulated before tagging
// began has a correct cost; only transactions on/after that date are replayed.
// ---------------------------------------------------------------------------

// main-currency value of 1 unit of `currencyId`. 1 for the main currency, NaN when
// a foreign currency has no reference rate (only needed for foreign-to-foreign deals).
export type RefRateResolver = (currencyId: number) => number;

// One opening pool: `qty` units of `currencyId` held at `avgCost` (main per unit).
export type HarvestOpeningPool = { currencyId: number; qty: number; avgCost: number };
export type HarvestOpening = { asOf: string | null; pools: HarvestOpeningPool[] };

const EPS = 1e-6;

export type CurrencyPool = { holding: number; costBasisMain: number };

export type HarvestTxKind = 'buy' | 'sell' | 'exchange' | 'transfer' | 'neutral';

type TxLeg = { currencyId: number; kind: 'buy' | 'sell'; units: number; mainValue: number };

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

export type HarvestTxRow = {
  transactionId: number;
  createdAt: string;
  clientFromName: string;
  clientToName: string;
  type: string;
  kind: HarvestTxKind;
  amount: number;
  currencyCode: string;
  currencySymbol: string;
  boughtMain: number;
  soldMain: number;
  realizedProfitMain: number;
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

// Live (not archived) and two-sided. One-sided rows are treated as archive elsewhere.
function isTradeable(tx: Transaction): boolean {
  return !tx.isArchived && tx.accountFromId != null && tx.accountToId != null;
}

// The house's realized profit/loss from processing one transaction, mutating the
// per-currency WAC pools according to the transaction's declared type.
function processTransaction(
  tx: Transaction,
  pools: Map<number, CurrencyPool>,
  accountCurrencyOf: (accountId: number | null) => number | null,
  mainCurrencyId: number,
  refRate: RefRateResolver,
): TxOutcome {
  const empty: TxOutcome = {
    boughtMain: 0,
    soldMain: 0,
    realizedProfitMain: 0,
    kind: 'neutral',
    hasMissingRate: false,
    hasShortInventory: false,
    legs: [],
    refNeededCurrencyIds: [],
  };

  // Position delta per currency = -(netChange) summed across both legs.
  const deltas = new Map<number, number>();
  const addDelta = (currencyId: number | null, delta: number) => {
    if (currencyId == null || !Number.isFinite(delta)) return;
    deltas.set(currencyId, (deltas.get(currencyId) ?? 0) + delta);
  };
  const fromCcy = accountCurrencyOf(tx.accountFromId);
  const toCcy = accountCurrencyOf(tx.accountToId);
  if (fromCcy != null) addDelta(fromCcy, -computeTransactionSideNetChange(tx, fromCcy, 'from'));
  if (toCcy != null) addDelta(toCcy, -computeTransactionSideNetChange(tx, toCcy, 'to'));

  const mainDelta = deltas.get(mainCurrencyId) ?? 0;
  const mainInvolved = Math.abs(mainDelta) > EPS;
  const foreignEntries = [...deltas.entries()].filter(([ccy, d]) => ccy !== mainCurrencyId && Math.abs(d) > EPS);
  const increases = foreignEntries.filter(([, d]) => d > 0);
  const decreases = foreignEntries.filter(([, d]) => d < 0);

  const refNeededCurrencyIds: number[] = [];
  let hasMissingRate = false;
  let hasShortInventory = false;
  const refValue = (ccy: number, units: number): number => {
    refNeededCurrencyIds.push(ccy);
    const r = refRate(ccy);
    if (!Number.isFinite(r) || r <= 0) {
      hasMissingRate = true;
      return 0;
    }
    return units * r;
  };
  const poolOf = (ccy: number): CurrencyPool => {
    let p = pools.get(ccy);
    if (!p) {
      p = { holding: 0, costBasisMain: 0 };
      pools.set(ccy, p);
    }
    return p;
  };
  const disposeAtCost = (ccy: number, units: number): number => {
    const pool = poolOf(ccy);
    const wac = pool.holding > EPS ? pool.costBasisMain / pool.holding : 0;
    if (pool.holding <= EPS) hasShortInventory = true;
    const basisReleased = wac * units;
    pool.holding -= units; // may go negative (short) — a later buy trues it up
    pool.costBasisMain -= basisReleased;
    return basisReleased;
  };

  const result = (partial: Partial<TxOutcome> & { kind: HarvestTxKind }): TxOutcome => ({
    ...empty,
    ...partial,
    hasMissingRate,
    hasShortInventory,
    refNeededCurrencyIds,
  });

  switch (tx.type) {
    case 'buy': {
      // The house acquires a currency. The acquired currency is the one whose
      // position increases; cost = the main currency it gave up (actual when main
      // is the counter side, else a reference-rate estimate for foreign-funded buys).
      const target = increases[0] ?? foreignEntries[0];
      if (!target) return result({ kind: 'buy' });
      const [ccy, delta] = target;
      const units = Math.abs(delta);
      const cost = mainInvolved && mainDelta < 0 ? Math.abs(mainDelta) : refValue(ccy, units);
      const pool = poolOf(ccy);
      pool.holding += delta; // (delta>0 for a normal buy)
      pool.costBasisMain += cost;
      return result({ kind: 'buy', boughtMain: cost, legs: [{ currencyId: ccy, kind: 'buy', units, mainValue: cost }] });
    }
    case 'sell': {
      // The house disposes a currency. The disposed currency is the one whose
      // position decreases; proceeds = the main currency received.
      const target = decreases[0] ?? foreignEntries[0];
      if (!target) return result({ kind: 'sell' });
      const [ccy, delta] = target;
      const units = Math.abs(delta);
      const basisReleased = disposeAtCost(ccy, units);
      const proceeds = mainInvolved && mainDelta > 0 ? mainDelta : refValue(ccy, units);
      return result({
        kind: 'sell',
        soldMain: proceeds,
        realizedProfitMain: proceeds - basisReleased,
        legs: [{ currencyId: ccy, kind: 'sell', units, mainValue: proceeds }],
      });
    }
    case 'exchange': {
      // Convert one currency to another (within a client or between correspondents).
      // Carry the disposed currency's cost basis onto the acquired currency — no
      // profit now; it surfaces when the acquired currency is later sold.
      const dec = decreases[0];
      const inc = increases[0];
      if (!dec || !inc) return result({ kind: 'exchange' });
      const [decCcy, decDelta] = dec;
      const [incCcy, incDelta] = inc;
      const carriedBasis = disposeAtCost(decCcy, Math.abs(decDelta));
      const incPool = poolOf(incCcy);
      incPool.holding += incDelta;
      incPool.costBasisMain += carriedBasis;
      return result({
        kind: 'exchange',
        legs: [
          { currencyId: decCcy, kind: 'sell', units: Math.abs(decDelta), mainValue: carriedBasis },
          { currencyId: incCcy, kind: 'buy', units: incDelta, mainValue: carriedBasis },
        ],
      });
    }
    default:
      // transfer / adjustment / anything else — a debt settlement or money move.
      // No pool effect, no profit.
      return result({ kind: 'transfer' });
  }
}

/**
 * Seeds each currency's WAC pool from the opening inventory, replays every tagged
 * transaction on/after the opening date in chronological order to keep the pools
 * current, and surfaces only TODAY's transactions and the profit they realized.
 */
export function computeHarvest({
  transactions,
  clientAccounts,
  currencies,
  refRate,
  opening = { asOf: null, pools: [] },
  now = new Date(),
}: {
  transactions: Transaction[];
  clientAccounts: ClientAccount[];
  currencies: Currency[];
  refRate: RefRateResolver;
  opening?: HarvestOpening;
  now?: Date;
}): HarvestResult {
  const main = currencies.find((c) => c.isMain === 1) ?? null;
  const base: HarvestResult = {
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
  if (!main) return base;

  const accountCurrency = new Map(clientAccounts.map((a) => [a.id, a.currencyId]));
  const accountCurrencyOf = (id: number | null) => (id == null ? null : accountCurrency.get(id) ?? null);
  const currencyById = new Map(currencies.map((c) => [c.id, c]));

  // Seed pools from the opening inventory.
  const pools = new Map<number, CurrencyPool>();
  for (const p of opening.pools) {
    if (!Number.isFinite(p.qty) || !Number.isFinite(p.avgCost) || Math.abs(p.qty) < EPS) continue;
    pools.set(p.currencyId, { holding: p.qty, costBasisMain: p.qty * p.avgCost });
  }
  const asOfTime = opening.asOf ? new Date(`${opening.asOf}T00:00:00`).getTime() : -Infinity;

  const ordered = transactions
    .filter(isTradeable)
    .filter((tx) => new Date(tx.createdAt).getTime() >= asOfTime)
    .slice()
    .sort((a, b) => {
      const d = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return d !== 0 ? d : a.id - b.id;
    });

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
      kind: outcome.kind,
      amount: tx.amount,
      currencyCode: tx.currencyCode,
      currencySymbol: tx.currencySymbol,
      boughtMain: outcome.boughtMain,
      soldMain: outcome.soldMain,
      realizedProfitMain: outcome.realizedProfitMain,
      hasMissingRate: outcome.hasMissingRate,
      hasShortInventory: outcome.hasShortInventory,
    });

    for (const leg of outcome.legs) {
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
