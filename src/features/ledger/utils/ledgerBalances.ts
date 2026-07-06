import { getCommissionAmount, chargeLedgerEffect } from '@/shared/utils/commission';
import { getLedgerTransactionDraftKey } from '@/features/ledger/utils/ledgerEntries';
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
 amount: number;
 exchangeRateFrom: number;
 commissionFrom: number;
 exchangeRateTo: number;
 commissionTo: number;
 charges: number;
 chargesPayer: string;
 chargesExchangeRate: number;
};

// The net ledger effect of a transaction on ONE side's account balance — must mirror the
// from/to netChange formulas inside computeClientLedgers below exactly. Used by the
// reconciliation guard to tell whether an edit actually changes a given account's balance
// (e.g. changing only the "from" side's exchange rate never affects the "to" account, so
// that account's lock should not be checked).
export function computeTransactionSideNetChange(tx: NetChangeSideInput, accountCurrencyId: number, side: 'from' | 'to'): number {
 const rate = side === 'from' ? tx.exchangeRateFrom : tx.exchangeRateTo;
 const commission = side === 'from' ? tx.commissionFrom : tx.commissionTo;
 const pendingRate = tx.currencyId !== accountCurrencyId && rate === 0;
 if (pendingRate) return 0;
 const chargeEffect = tx.charges > 0 ? chargeLedgerEffect(tx.chargesPayer, side) * (tx.charges * tx.chargesExchangeRate) : 0;
 if (side === 'from') {
  return tx.amount * rate + getCommissionAmount(tx.amount * rate, commission) + chargeEffect;
 }
 return -(tx.amount * rate - getCommissionAmount(tx.amount * rate, commission)) + chargeEffect;
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
             ? chargeLedgerEffect(transaction.chargesPayer, 'from') * (transaction.charges * transaction.chargesExchangeRate)
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
       // Cross-currency with no exchange rate set yet (0) is pending (see note above).
       const pendingRate = transaction.currencyId !== account.currencyId && transaction.exchangeRateTo === 0;
       return [
        {
         transactionId: transaction.id,
         createdAt: transaction.createdAt,
         counterpartyName: counterparty?.clientName || '-',
         counterpartyClientId: counterparty?.clientId ?? null,
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
          : -(transaction.amount * transaction.exchangeRateTo - getCommissionAmount(transaction.amount * transaction.exchangeRateTo, transaction.commissionTo)) +
            (transaction.charges > 0
             ? chargeLedgerEffect(transaction.chargesPayer, 'to') * (transaction.charges * transaction.chargesExchangeRate)
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

type LedgerSelectionSummary = {
 count: number;
 amountSum: number;
 netChangeSum: number;
 amountCurrencyCode: string;
 netCurrencyCode: string;
};

// Totals for the currently multi-selected ledger entries (sum mode). Ported verbatim.
export function computeLedgerSelectionSummary({ selectedLedgerEntryKeys, selectedClientLedgers, selectedLedgerAccountId }: {
 selectedLedgerEntryKeys: Set<string>;
 selectedClientLedgers: ClientAccountLedger[];
 selectedLedgerAccountId: number | null;
}): LedgerSelectionSummary | null {
  if (selectedLedgerEntryKeys.size === 0) return null;
  const entryByKey = new Map<string, ClientLedgerEntry>();
  for (const ledger of selectedClientLedgers) {
   for (const entry of ledger.entries) {
    entryByKey.set(getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId), entry);
   }
  }
  let amountSum = 0;
  let netChangeSum = 0;
  let count = 0;
  const currencyCodes = new Set<string>();
  for (const key of selectedLedgerEntryKeys) {
   const entry = entryByKey.get(key);
   if (!entry) continue;
   amountSum += entry.amount;
   netChangeSum += entry.netChange;
   currencyCodes.add(entry.currencyCode);
   count += 1;
  }
  // Net change is always expressed in the account's currency.
  const accountCurrency = selectedClientLedgers.find((l) => l.accountId === selectedLedgerAccountId) ?? selectedClientLedgers[0];
  return {
   count,
   amountSum,
   netChangeSum,
   amountCurrencyCode: currencyCodes.size === 1 ? [...currencyCodes][0] : '',
   netCurrencyCode: accountCurrency?.currencyCode ?? '',
  };
}
