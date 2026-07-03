import { getCommissionAmount, chargeShowsInLedger } from '@/shared/utils/commission';
import type {
 Client,
 ClientAccount,
 ClientAccountLedger,
 ClientAdjustment,
 ClientLedgerEntry,
 Currency,
 Section,
 Transaction,
} from '@/shared/types';

type ComputeArgs = {
 selectedClientForLedger: Client | null;
 section: Section;
 pdfExportModal: unknown;
 clientAccounts: ClientAccount[];
 transactions: Transaction[];
 adjustments: ClientAdjustment[];
 clientAccountMap: Map<number, ClientAccount>;
 currencyMap: Map<number, Currency>;
};

// Per-account ledgers (entries + running balances) for the open client. Ported
// verbatim from the page's selectedClientLedgers memo; pure over its inputs.
export function computeClientLedgers({ selectedClientForLedger, section, pdfExportModal, clientAccounts, transactions, adjustments, clientAccountMap, currencyMap }: ComputeArgs): ClientAccountLedger[] {
  // Skip expensive ledger computations unless the ledger view/modal is active.
  if (!selectedClientForLedger || (section !== 'client-ledger' && !pdfExportModal)) {
   return [];
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
         // "Paid by me"/"paid to me" charges are settled directly with the org and never touch a
         // counterparty's ledger; every other payer (incl. the counterparty itself or an unset value) does.
         netChange: pendingRate
          ? 0
          : transaction.amount * transaction.exchangeRateFrom +
            getCommissionAmount(transaction.amount * transaction.exchangeRateFrom, transaction.commissionFrom) +
            (transaction.charges > 0 && chargeShowsInLedger(transaction.chargesPayer)
             ? transaction.chargesPayer === 'from'
               ? -(transaction.charges * transaction.chargesExchangeRate)
               : transaction.charges * transaction.chargesExchangeRate
             : 0),
         runningBalance: 0,
         description: transaction.descriptionFrom?.trim() || transaction.description,
         charges: transaction.charges,
         chargesCurrencyCode: transaction.chargesCurrencyCode,
         chargesPayer: transaction.chargesPayer,
         chargesExchangeRate: transaction.chargesExchangeRate,
         chargesDescription: transaction.chargesDescription,
         isChargesPayerThisAccount: transaction.chargesPayer === 'from',
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
            (transaction.charges > 0 && chargeShowsInLedger(transaction.chargesPayer)
             ? transaction.chargesPayer === 'to'
               ? -(transaction.charges * transaction.chargesExchangeRate)
               : transaction.charges * transaction.chargesExchangeRate
             : 0),
         runningBalance: 0,
         description: transaction.descriptionTo?.trim() || transaction.description,
         charges: transaction.charges,
         chargesCurrencyCode: transaction.chargesCurrencyCode,
         chargesPayer: transaction.chargesPayer,
         chargesExchangeRate: transaction.chargesExchangeRate,
         chargesDescription: transaction.chargesDescription,
         isChargesPayerThisAccount: transaction.chargesPayer === 'to',
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
    let runningBalance = account.startingBalance ?? 0;
    const entriesWithBalance = entries.map((entry) => {
     runningBalance += entry.netChange;
     return {
      ...entry,
      runningBalance,
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
    };
   })
   .sort((left, right) => left.currencyCode.localeCompare(right.currencyCode));
}
