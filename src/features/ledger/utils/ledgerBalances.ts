import { getCommissionAmount, chargeLedgerEffect, exchangeToBase } from '@/shared/utils/commission';
import { buildLockBoundaries, isAtOrBeforeBoundary, reconciliationRefId } from '@/features/ledger/utils/reconciliation';
import type {
 Client,
 ClientAccount,
 ClientAccountLedger,
 ClientAdjustment,
 ClientLedgerEntry,
 Currency,
 Reconciliation,
 Section,
 Transaction,
} from '@/shared/types';

// Minimal shape needed to compute one side's ledger effect — a subset shared by both
// `Transaction` and `TransactionUpdateInput`, so callers can pass either an existing
// transaction or a not-yet-saved edit payload.
export type NetChangeSideInput = {
 currencyId: number;
 type: string;
 amount: number;
 exchangeRateFrom: number;
 commissionFrom: number;
 exchangeRateTo: number;
 commissionTo: number;
 exchangeActualAmount?: number | null;
 charges: number;
 chargesCurrencyId: number | null;
 chargesPayer: string;
 chargesExchangeRate: number;
};

// chargesExchangeRate converts the charge's own currency into the *payer's* account
// currency (see the form's "charges_exchange_rate (chargeCcy → payerAccountCcy)" label) —
// it has no meaning for a side whose account currency already matches the charge's
// currency, where the conversion is definitionally 1:1. Forcing rate=1 here (rather than
// trusting whatever's stored) protects against stale/incorrect chargesExchangeRate values
// left over from when the charge's currency or payer was last changed — e.g. a charge
// entered in the same currency as this account still carrying an earlier cross-currency
// rate, which silently over/under-subtracted this side's balance by that stale factor.
function effectiveChargeRate(chargesCurrencyId: number | null, accountCurrencyId: number, chargesExchangeRate: number): number {
 return chargesCurrencyId != null && chargesCurrencyId === accountCurrencyId ? 1 : chargesExchangeRate;
}

// The net ledger effect of a transaction on ONE side's account balance — must mirror the
// from/to netChange formulas inside computeClientLedgers below exactly. Used by the
// reconciliation guard to tell whether an edit actually changes a given account's balance
// (e.g. changing only the "from" side's exchange rate never affects the "to" account, so
// that account's lock should not be checked).
export function computeTransactionSideNetChange(tx: NetChangeSideInput, accountCurrencyId: number, side: 'from' | 'to'): number {
 const rate = side === 'from' ? tx.exchangeRateFrom : tx.exchangeRateTo;
 const commission = side === 'from' ? tx.commissionFrom : tx.commissionTo;
 // An exchange with a recorded actual (الفعلي) destination amount is never pending on the "to"
 // side — the concrete settled amount stands in for the computed amount × rate.
 const hasExchangeActual = side === 'to' && tx.type === 'exchange' && tx.exchangeActualAmount != null;
 const pendingRate = !hasExchangeActual && tx.currencyId !== accountCurrencyId && rate === 0;
 if (pendingRate) return 0;
 const chargeRate = effectiveChargeRate(tx.chargesCurrencyId, accountCurrencyId, tx.chargesExchangeRate);
 const chargeEffect = tx.charges > 0 ? chargeLedgerEffect(tx.chargesPayer, side) * (tx.charges * chargeRate) : 0;
 if (side === 'from') {
  return tx.amount * rate + getCommissionAmount(tx.amount * rate, commission) + chargeEffect;
 }
 const toBase = exchangeToBase(tx);
 return -(toBase - getCommissionAmount(toBase, commission)) + chargeEffect;
}

type ComputeArgs = {
 selectedClientForLedger: Client | null;
 section: Section;
 pdfExportModal: unknown;
 clientAccounts: ClientAccount[];
 transactions: Transaction[];
 adjustments: ClientAdjustment[];
 reconciliations: Reconciliation[];
 clientAccountMap: Map<number, ClientAccount>;
 currencyMap: Map<number, Currency>;
};

// Per-account ledgers (entries + running balances) for the open client. Ported
// verbatim from the page's selectedClientLedgers memo; pure over its inputs.
export function computeClientLedgers({ selectedClientForLedger, section, pdfExportModal, clientAccounts, transactions, adjustments, reconciliations, clientAccountMap, currencyMap }: ComputeArgs): ClientAccountLedger[] {
  // Skip expensive ledger computations unless the ledger view/modal is active.
  if (!selectedClientForLedger || (section !== 'client-ledger' && !pdfExportModal)) {
   return [];
  }

  const lockBoundaries = buildLockBoundaries(reconciliations);
  // Marks keyed per account by the exact row they sit on, for the ✓ badge.
  const marksByAccount = new Map<number, Map<string, Reconciliation>>();
  for (const rec of reconciliations) {
   let byRow = marksByAccount.get(rec.accountId);
   if (!byRow) {
    byRow = new Map();
    marksByAccount.set(rec.accountId, byRow);
   }
   byRow.set(`${rec.anchorKind}:${rec.anchorRefId}`, rec);
  }

  return clientAccounts
   .filter((account) => account.clientId === selectedClientForLedger.id)
   .map((account) => {
    const entries = transactions
     .flatMap<ClientLedgerEntry>((transaction) => {
      // Archive-only records are historical and never affect a client's ledger/balance.
      if (transaction.isArchived) return [];
      if (transaction.accountFromId === account.id) {
       const counterparty = clientAccountMap.get(transaction.accountToId ?? -1);
       // Cross-currency with no exchange rate set yet (0) is pending: shown as a dash and
       // excluded from the balance until the user enters a rate. An explicit rate (incl. 1) counts.
       const pendingRate = transaction.currencyId !== account.currencyId && transaction.exchangeRateFrom === 0;
       return [
        {
         transactionId: transaction.id,
         createdAt: transaction.createdAt,
         counterpartyName: counterparty?.clientName || '-',
         counterpartyClientId: counterparty?.clientId ?? null,
         counterpartyCurrencyCode: counterparty?.currencyCode || '',
         counterpartyCurrencySymbol: counterparty?.currencySymbol || '',
         direction: 'outgoing' as const,
         type: transaction.type,
         amount: transaction.amount,
         currencyCode: transaction.currencyCode,
         currencySymbol: transaction.currencySymbol,
         exchangeRate: transaction.exchangeRateFrom,
         exchangeRateReversed: !!transaction.exchangeRateFromReversed,
         pendingRate,
         commission: transaction.commissionFrom,
         // The charge's effect on this (the "from"-side) account depends on the payer: a
         // client-to-client fee is double-entry, an org-settled fee only hits the named client.
         netChange: pendingRate
          ? 0
          : transaction.amount * transaction.exchangeRateFrom +
            getCommissionAmount(transaction.amount * transaction.exchangeRateFrom, transaction.commissionFrom) +
            (transaction.charges > 0
             ? chargeLedgerEffect(transaction.chargesPayer, 'from') *
               (transaction.charges * effectiveChargeRate(transaction.chargesCurrencyId, account.currencyId, transaction.chargesExchangeRate))
             : 0),
         runningBalance: 0,
         description: transaction.descriptionFrom?.trim() || transaction.description,
         charges: transaction.charges,
         chargesCurrencyCode: transaction.chargesCurrencyCode,
         chargesPayer: transaction.chargesPayer,
         chargesExchangeRate: transaction.chargesExchangeRate,
         chargesDescription: transaction.chargesDescription,
         isChargesPayerThisAccount: chargeLedgerEffect(transaction.chargesPayer, 'from') < 0,
         chargeAffectsThisAccount: chargeLedgerEffect(transaction.chargesPayer, 'from') !== 0,
        },
       ];
      }

      if (transaction.accountToId === account.id) {
       const counterparty = clientAccountMap.get(transaction.accountFromId ?? -1);
       // Cross-currency with no exchange rate set yet (0) is pending (see note above) — unless this
       // is an exchange with a recorded actual (الفعلي) destination amount, which is never pending.
       const hasExchangeActual = transaction.type === 'exchange' && transaction.exchangeActualAmount != null;
       const pendingRate = !hasExchangeActual && transaction.currencyId !== account.currencyId && transaction.exchangeRateTo === 0;
       return [
        {
         transactionId: transaction.id,
         createdAt: transaction.createdAt,
         counterpartyName: counterparty?.clientName || '-',
         counterpartyClientId: counterparty?.clientId ?? null,
         counterpartyCurrencyCode: counterparty?.currencyCode || '',
         counterpartyCurrencySymbol: counterparty?.currencySymbol || '',
         direction: 'incoming' as const,
         type: transaction.type,
         amount: transaction.amount,
         currencyCode: transaction.currencyCode,
         currencySymbol: transaction.currencySymbol,
         exchangeRate: transaction.exchangeRateTo,
         exchangeRateReversed: !!transaction.exchangeRateToReversed,
         pendingRate,
         commission: transaction.commissionTo,
         netChange: pendingRate
          ? 0
          : -(exchangeToBase(transaction) - getCommissionAmount(exchangeToBase(transaction), transaction.commissionTo)) +
            (transaction.charges > 0
             ? chargeLedgerEffect(transaction.chargesPayer, 'to') *
               (transaction.charges * effectiveChargeRate(transaction.chargesCurrencyId, account.currencyId, transaction.chargesExchangeRate))
             : 0),
         runningBalance: 0,
         description: transaction.descriptionTo?.trim() || transaction.description,
         charges: transaction.charges,
         chargesCurrencyCode: transaction.chargesCurrencyCode,
         chargesPayer: transaction.chargesPayer,
         chargesExchangeRate: transaction.chargesExchangeRate,
         chargesDescription: transaction.chargesDescription,
         isChargesPayerThisAccount: chargeLedgerEffect(transaction.chargesPayer, 'to') < 0,
         chargeAffectsThisAccount: chargeLedgerEffect(transaction.chargesPayer, 'to') !== 0,
        },
       ];
      }

      return [];
     })
     .concat(
      adjustments
       .filter((adj) => adj.accountId === account.id)
       .map((adj) => ({
        transactionId: -adj.id,
        adjustmentId: adj.id,
        isAdjustment: true as const,
        createdAt: adj.createdAt,
        counterpartyName: '',
        counterpartyClientId: null,
        counterpartyCurrencyCode: '',
        counterpartyCurrencySymbol: '',
        // debit: client owes us (e.g. gas money) ? balance moves in our favor (negative)
        // credit: we owe the client (e.g. iPhone) ? balance moves in their favor (positive)
        direction: (adj.direction === 'credit' ? 'outgoing' : 'incoming') as 'incoming' | 'outgoing',
        type: 'adjustment',
        amount: adj.amount,
        currencyCode: adj.currencyCode || account.currencyCode,
        currencySymbol: adj.currencySymbol || account.currencySymbol,
        exchangeRate: adj.exchangeRate || 1,
        exchangeRateReversed: !!adj.exchangeRateReversed,
        pendingRate: adj.currencyId != null && adj.currencyId !== account.currencyId && (adj.exchangeRate ?? 0) === 0,
        commission: 0,
        // amount is in the adjustment's own currency; convert to account currency via exchangeRate.
        // A cross-currency adjustment with no rate set (0) is pending and excluded from the balance.
        netChange:
         adj.currencyId != null && adj.currencyId !== account.currencyId && (adj.exchangeRate ?? 0) === 0
          ? 0
          : (adj.direction === 'credit' ? 1 : -1) * adj.amount * (adj.exchangeRate || 1),
        runningBalance: 0,
        description: adj.description,
        charges: 0,
        chargesCurrencyCode: null,
        chargesPayer: '',
        chargesExchangeRate: 1,
        chargesDescription: '',
        isChargesPayerThisAccount: false,
        chargeAffectsThisAccount: false,
       })),
     )
     .sort((left, right) => {
      const dateDiff = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      if (dateDiff !== 0) return dateDiff;
      const leftId = left.isAdjustment ? (left.adjustmentId ?? 0) : left.transactionId;
      const rightId = right.isAdjustment ? (right.adjustmentId ?? 0) : right.transactionId;
      return leftId - rightId;
     });

    // Entries are ordered purely by createdAt (drag-to-reorder persists the order by
    // rewriting timestamps), so a running balance accumulated in this order is durable.
    const boundary = lockBoundaries.get(account.id) ?? null;
    const rowMarks = marksByAccount.get(account.id);
    let runningBalance = account.startingBalance ?? 0;
    const entriesWithBalance = entries.map((entry) => {
     runningBalance += entry.netChange;
     const refId = reconciliationRefId(entry);
     const mark = rowMarks?.get(`${entry.isAdjustment ? 'adjustment' : 'transaction'}:${refId}`);
     return {
      ...entry,
      runningBalance,
      isLocked: isAtOrBeforeBoundary(entry.createdAt, refId, boundary),
      ...(mark ? { reconciledMark: { id: mark.id, balance: mark.balance, note: mark.note } } : {}),
     };
    });

    return {
     accountId: account.id,
     currencyName: currencyMap.get(account.currencyId)?.name || account.currencyCode,
     currencyCode: account.currencyCode,
     currencySymbol: account.currencySymbol,
     startingBalance: account.startingBalance ?? 0,
     currentBalance: runningBalance,
     transactionCount: entriesWithBalance.length,
     entries: entriesWithBalance,
     lockBoundary: boundary ? { anchorCreatedAt: boundary.anchorCreatedAt, anchorRefId: boundary.anchorRefId, balance: boundary.balance } : null,
    };
   })
   .sort((left, right) => left.currencyCode.localeCompare(right.currencyCode));
}
