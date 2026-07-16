import { computeTransactionSideNetChange } from '@/features/ledger/utils/ledgerBalances';
import { localDateKey } from '@/shared/utils/date';
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
// buy/sell also has a pool-bypassing special case: a PASS-THROUGH SPREAD TRADE, where
// each side either settles in the MAIN currency (a real rate was dealt) or directly in
// the traded currency itself (that account already holds it, so there's no MAIN-currency
// figure for that leg — it's marked to today's reference rate instead; both legs can be
// traded-currency, e.g. a EUR client paying another EUR client through the house).
// Neither leg ever touches a pool; profit is simply proceeds − cost.
//
// Today's reference rate is looked up PER ACCOUNT, not once globally per currency —
// different organizations (or standalone clients with no organization) trade the same
// currency at different rates, so RefRateResolver takes the specific account being
// priced and resolves that account's own rate-group (see harvestRatesStore.ts).
//
// Magnitudes come from the balance engine's signed net-change
// (computeTransactionSideNetChange), negated to express the house's POSITION
// change (a negative account balance means the client owes the house, i.e. the
// house holds that currency — see ledgerBalances.ts). Commissions/charges are
// already inside those net-changes, so they fold naturally into buy cost and
// sell proceeds.
//
// The pools are built purely by replaying tagged buy/sell/exchange transactions in
// chronological order. Currency the house held before it started tagging simply has
// no cost until the relevant buys are tagged (a sell against an untagged/empty pool
// surfaces the short-inventory ⚠ marker); this converges as history gets tagged.
// ---------------------------------------------------------------------------

// main-currency value of 1 unit of `currencyId`, as traded by the client account
// `accountId` (different organizations/standalone clients can trade the same currency
// at different rates). 1 for the main currency, NaN when no reference rate is set for
// that account's rate-group (only needed for foreign-to-foreign deals).
export type RefRateResolver = (currencyId: number, accountId: number | null) => number;

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

// Compare the wall-clock DATE embedded in createdAt (its first 10 chars) against the
// target day's local date. A string compare is timezone-proof: it never routes the stored
// value through Date/getDate(), which would re-apply the viewer's UTC offset and could bump
// a late-night transaction onto the wrong day (the reason some rows went missing here).
function isSameLocalDay(iso: string, day: string): boolean {
  return iso.slice(0, 10) === day;
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
  const refValue = (ccy: number, units: number, accountId: number | null): number => {
    refNeededCurrencyIds.push(ccy);
    const r = refRate(ccy, accountId);
    if (!Number.isFinite(r) || r <= 0) {
      hasMissingRate = true;
      return 0;
    }
    return units * r;
  };
  // The generic WAC-pool buy/sell cases only track a net delta per currency (both
  // sides can share a currency in the pass-through branch above, but not here — a
  // pool trade always has exactly one foreign side), so the currency alone identifies
  // which account's rate-group to price it at.
  const accountFor = (ccy: number): number | null => (fromCcy === ccy ? tx.accountFromId : toCcy === ccy ? tx.accountToId : null);
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

  // Pass-through spread trade: one side settles in the MAIN currency (a real MAD
  // amount was dealt) and the other side settles either in MAIN too — the deal
  // currency is only implied via the entered rate, e.g. "bought from A @10.60, sold
  // to B @10.70, both in MAD" — or directly in the DEAL currency itself (the
  // client's account already holds that currency, so there's no MAD figure for that
  // leg at all; it must be marked to today's reference rate instead). Either way the
  // traded currency never enters inventory: profit is simply proceeds − cost. Gated
  // on the buy/sell tag so a both-main `transfer` (paying someone their balance)
  // stays at 0.
  const fromIsMain = fromCcy === mainCurrencyId;
  const toIsMain = toCcy === mainCurrencyId;
  const fromIsDealCcy = !fromIsMain && fromCcy === tx.currencyId;
  const toIsDealCcy = !toIsMain && toCcy === tx.currencyId;
  if ((tx.type === 'buy' || tx.type === 'sell') && (fromIsMain || fromIsDealCcy) && (toIsMain || toIsDealCcy)) {
    const netUnitsFrom = tx.amount * (1 - (tx.commissionFrom || 0) / 100);
    const netUnitsTo = tx.amount * (1 - (tx.commissionTo || 0) / 100);

    // Cost: the real MAD amount dealt on the from-side, or — when that side settles
    // directly in the deal currency — its value marked to today's price.
    const buySide = fromIsMain ? computeTransactionSideNetChange(tx, mainCurrencyId, 'from') : refValue(tx.currencyId, netUnitsFrom, tx.accountFromId);

    // Proceeds: if a MAD rate was entered on the to-side, realize at it. If the
    // to-side settles directly in the deal currency, or the MAD rate was left blank
    // (unpriced), MARK the delivered amount to "today's price" instead.
    const toUnpriced = toIsMain && tx.currencyId !== mainCurrencyId && tx.exchangeRateTo === 0;
    const sellSide = toIsDealCcy || toUnpriced ? refValue(tx.currencyId, netUnitsTo, tx.accountToId) : -computeTransactionSideNetChange(tx, mainCurrencyId, 'to');

    const boughtUnits = fromIsMain ? tx.amount : netUnitsFrom;
    const soldUnits = toIsDealCcy || toUnpriced ? netUnitsTo : tx.amount;

    const legs: TxLeg[] = [];
    if (buySide > EPS) legs.push({ currencyId: tx.currencyId, kind: 'buy', units: boughtUnits, mainValue: buySide });
    if (sellSide > EPS) legs.push({ currencyId: tx.currencyId, kind: 'sell', units: soldUnits, mainValue: sellSide });
    return result({
      kind: 'sell',
      boughtMain: Math.max(buySide, 0),
      soldMain: Math.max(sellSide, 0),
      realizedProfitMain: sellSide - buySide,
      legs,
    });
  }

  switch (tx.type) {
    case 'buy': {
      // The house acquires a currency. The acquired currency is the one whose
      // position increases; cost = the main currency it gave up (actual when main
      // is the counter side, else a reference-rate estimate for foreign-funded buys).
      const target = increases[0] ?? foreignEntries[0];
      if (!target) return result({ kind: 'buy' });
      const [ccy, delta] = target;
      const units = Math.abs(delta);
      const cost = mainInvolved && mainDelta < 0 ? Math.abs(mainDelta) : refValue(ccy, units, accountFor(ccy));
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
      const proceeds = mainInvolved && mainDelta > 0 ? mainDelta : refValue(ccy, units, accountFor(ccy));
      return result({
        kind: 'sell',
        soldMain: proceeds,
        realizedProfitMain: proceeds - basisReleased,
        legs: [{ currencyId: ccy, kind: 'sell', units, mainValue: proceeds }],
      });
    }
    case 'exchange': {
      // Convert one currency to another (within a client or between correspondents).
      // Realize the spread NOW: value both legs at today's reference rates (the main
      // currency prices at 1) and book profit = value received − value given. The
      // acquired currency enters the pool at its marked value so a later sale prices
      // against today's rate and doesn't double-count this spread.
      const dec = decreases[0];
      const inc = increases[0];
      if (!dec || !inc) return result({ kind: 'exchange' });
      const [decCcy, decDelta] = dec;
      const [incCcy, incDelta] = inc;
      const decUnits = Math.abs(decDelta);
      const incUnits = Math.abs(incDelta);
      const givenValue = refValue(decCcy, decUnits, accountFor(decCcy));
      const receivedValue = refValue(incCcy, incUnits, accountFor(incCcy));
      disposeAtCost(decCcy, decUnits);
      const incPool = poolOf(incCcy);
      incPool.holding += incDelta;
      incPool.costBasisMain += receivedValue;
      return result({
        kind: 'exchange',
        boughtMain: Math.max(receivedValue, 0),
        soldMain: Math.max(givenValue, 0),
        realizedProfitMain: receivedValue - givenValue,
        legs: [
          { currencyId: decCcy, kind: 'sell', units: decUnits, mainValue: givenValue },
          { currencyId: incCcy, kind: 'buy', units: incUnits, mainValue: receivedValue },
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
 * Replays every tagged transaction in chronological order to build each currency's
 * weighted-average-cost pool, then surfaces only TODAY's transactions and the profit
 * they realized (earlier days still update the pools, they just aren't displayed).
 */
export function computeHarvest({
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
  // The harvest day to surface, as local `yyyy-mm-dd` (defaults to today). Earlier days
  // still replay into the pools; only this day's transactions are displayed.
  day?: string;
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

  const pools = new Map<number, CurrencyPool>();

  const ordered = transactions
    .filter(isTradeable)
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
    if (!isSameLocalDay(tx.createdAt, day)) continue; // seed only — not displayed

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

  rows.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.transactionId - b.transactionId);

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
