import { getCommissionAmount, chargeLedgerEffect, exchangeToBase } from '@/shared/utils/commission';
import { buildLockBoundaries, buildLiveAnchorTimes, isAtOrBeforeBoundary, reconciliationRefId } from '@/features/ledger/utils/reconciliation';
import type {
 ClientAccount,
 ClientAccountLedger,
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
 // The charge is always entered in the transaction's own currency (tx.currencyId), so it's
 // converted into this side's account currency by the exact same rate that converts `amount`
 // — i.e. the charge behaves as if it were added to `amount` before that multiplication.
 const chargeEffect = tx.charges > 0 ? chargeLedgerEffect(tx.chargesPayer, side) * (tx.charges * rate) : 0;
 if (side === 'from') {
  return tx.amount * rate + getCommissionAmount(tx.amount * rate, commission) + chargeEffect;
 }
 const toBase = exchangeToBase(tx);
 return -(toBase - getCommissionAmount(toBase, commission)) + chargeEffect;
}

type ComputeArgs = {
 // Only `.id` is read (the account filter below) — loosened from `Client` so the Treasury
 // feature can pass a hidden system client (Treasury/a cashbox), which isn't a normal Client.
 selectedClientForLedger: { id: number } | null;
 section: Section;
 pdfExportModal: unknown;
 clientAccounts: ClientAccount[];
 transactions: Transaction[];
 reconciliations: Reconciliation[];
 clientAccountMap: Map<number, ClientAccount>;
 currencyMap: Map<number, Currency>;
 // Explicit override for whether this call should compute ledgers at all. Omit to keep the
 // original behavior (section === 'client-ledger' or a PDF export is in progress) — pass
 // `true` for the Treasury/Cashbox page, whose own "section" value isn't 'client-ledger'.
 enabled?: boolean;
};

// Per-account ledgers (entries + running balances) for the open client. Ported
// verbatim from the page's selectedClientLedgers memo; pure over its inputs.
export function computeClientLedgers({ selectedClientForLedger, section, pdfExportModal, clientAccounts, transactions, reconciliations, clientAccountMap, currencyMap, enabled }: ComputeArgs): ClientAccountLedger[] {
  const isEnabled = enabled ?? (section === 'client-ledger' || !!pdfExportModal);
  // Skip expensive ledger computations unless the ledger view/modal is active.
  if (!selectedClientForLedger || !isEnabled) {
   return [];
  }

  const lockBoundaries = buildLockBoundaries(reconciliations, buildLiveAnchorTimes(transactions));

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
         counterpartyName: counterparty?.clientName || transaction.counterParty?.trim() || '-',
         counterpartyClientId: counterparty?.clientId ?? null,
         counterpartyCurrencyCode: counterparty?.currencyCode || '',
         counterpartyCurrencySymbol: counterparty?.currencySymbol || '',
         direction: 'outgoing' as const,
         type: transaction.type,
         isAdjustment: transaction.type === 'adjustment',
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
             ? chargeLedgerEffect(transaction.chargesPayer, 'from') * (transaction.charges * transaction.exchangeRateFrom)
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
         distributionLocationId: transaction.distributionLocationId,
         distributionLocationName: transaction.distributionLocationName,
         distributionLocationKind: transaction.distributionLocationKind,
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
         counterpartyName: counterparty?.clientName || transaction.counterParty?.trim() || '-',
         counterpartyClientId: counterparty?.clientId ?? null,
         counterpartyCurrencyCode: counterparty?.currencyCode || '',
         counterpartyCurrencySymbol: counterparty?.currencySymbol || '',
         direction: 'incoming' as const,
         type: transaction.type,
         isAdjustment: transaction.type === 'adjustment',
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
             ? chargeLedgerEffect(transaction.chargesPayer, 'to') * (transaction.charges * transaction.exchangeRateTo)
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
         distributionLocationId: transaction.distributionLocationId,
         distributionLocationName: transaction.distributionLocationName,
         distributionLocationKind: transaction.distributionLocationKind,
        },
       ];
      }

      return [];
     })
     .sort((left, right) => {
      const dateDiff = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      if (dateDiff !== 0) return dateDiff;
      return left.transactionId - right.transactionId;
     });

    // Entries are ordered purely by createdAt (drag-to-reorder persists the order by
    // rewriting timestamps), so a running balance accumulated in this order is durable.
    // `boundary` is the ACTIVE (newest) reconciliation — the one actually enforced by the
    // edit/delete/reorder guards, since a later reconciliation's locked set is always a
    // superset of any earlier one's in the normal flow, so protecting it also protects the
    // rest. Every reconciliation on the account still gets its own ✓ badge below, though — an
    // audit trail of every balance the client has ever agreed to, not just the latest.
    const boundary = lockBoundaries.get(account.id) ?? null;
    // Which row each of the account's reconciliations shows its ✓ badge on. A new-style mark's
    // fixed set can move internally (a drag can reorder it), so its badge belongs on whichever
    // member currently sits LAST (highest index) rather than the literal original anchor row;
    // an old-style mark (no set) still just matches its literal anchor id. Two marks landing on
    // the same row (rare — would need identical membership) show only the newer one there.
    const markByTransactionId = new Map<number, Reconciliation>();
    for (const rec of reconciliations) {
     if (rec.accountId !== account.id) continue;
     let displayTransactionId: number | null = null;
     if (rec.lockedRefIds) {
      const lockedSet = new Set(rec.lockedRefIds);
      for (let i = entries.length - 1; i >= 0; i--) {
       if (lockedSet.has(entries[i].transactionId)) {
        displayTransactionId = entries[i].transactionId;
        break;
       }
      }
     } else {
      displayTransactionId = rec.anchorRefId;
     }
     if (displayTransactionId == null) continue;
     const existing = markByTransactionId.get(displayTransactionId);
     if (!existing || rec.id > existing.id) markByTransactionId.set(displayTransactionId, rec);
    }
    let runningBalance = account.startingBalance ?? 0;
    const entriesWithBalance = entries.map((entry) => {
     runningBalance += entry.netChange;
     const refId = reconciliationRefId(entry);
     const mark = markByTransactionId.get(entry.transactionId);
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
     note: account.note ?? '',
     noteShowInPdf: Boolean(account.noteShowInPdf),
     entries: entriesWithBalance,
     lockBoundary: boundary ? { anchorCreatedAt: boundary.anchorCreatedAt, anchorRefId: boundary.anchorRefId, balance: boundary.balance } : null,
    };
   })
   .sort((left, right) => left.currencyCode.localeCompare(right.currencyCode));
}
