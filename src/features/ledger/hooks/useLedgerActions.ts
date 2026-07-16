'use client';

import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { confirmDialog } from '@/components/ui/AppDialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { accountingApi } from '@/lib/accountingApi';
import { transactionTypeLabelKey } from '@/shared/utils/transactionType';
import { NEW_ROW_REF_ID, violatedLock } from '@/features/ledger/utils/reconciliation';
import { ledgerEntryKey, getLedgerTransactionDraftKey } from '@/features/ledger/utils/ledgerEntries';
import { generateLedgerHtml } from '@/features/pdf/pdfExport';
import { formatRateValue } from '@/shared/utils/format';
import { formatDateValue, localDateKey } from '@/shared/utils/date';
import { resolveCreatedAt, nextCreatedAtForDate } from '@/shared/utils/createdAt';
import { ledgerColumnOrderStorageKeyPrefix } from '@/shared/lib/localStorage';
import { useWorkspaceActions } from '@/features/workspace/hooks/useWorkspaceActions';
import { useLedgerStore } from '@/features/ledger/store/ledgerStore';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { useAppStatusStore } from '@/shared/store/appStatusStore';
import { useReconciliationLocks } from '@/features/ledger/hooks/useReconciliationLocks';
import { useTransactionPatchers } from '@/features/transactions/hooks/useTransactionPatchers';
import type { DraftHistory } from '@/shared/hooks/useDraftHistory';
import type {
 Client,
 ClientAccount,
 ClientAccountLedger,
 ClientAdjustment,
 ClientLedgerEntry,
 Currency,
 LedgerColumnKey,
 LedgerTransactionDraft,
 PdfColVisibility,
 Reconciliation,
 TransactionUpdateInput,
 Transaction,
} from '@/shared/types';

type UseLedgerActionsParams = {
 clientAccounts: ClientAccount[];
 transactions: Transaction[];
 adjustments: ClientAdjustment[];
 reconciliations: Reconciliation[];
 currencyMap: Map<number, Currency>;
 clientAccountMap: Map<number, ClientAccount & { clientName?: string }>;
 selectedClientForLedger: Client | null;
 selectedClientLedgers: ClientAccountLedger[];
 orderedLedgerColumnOptions: Array<{ key: LedgerColumnKey; label: string }>;
 numLocale: string;
 isRTL: boolean;
 onDeleteTransaction: (id: number, opts?: { offerUndo?: boolean }) => Promise<void>;
 pushSharedSettingsIfOwner: () => void;
 pushUserTableSettings: () => void;
 ledgerHistory: DraftHistory;
};

/**
 * Every client-ledger handler: inline row edit/save/cancel (single + "edit
 * all"), drag reorder, reconciliation mark/unmark + selection, adjustments
 * (create/delete/undo), the mid-ledger write-off, and PDF/Excel export.
 * Reconciliation-lock guards and the optimistic transaction/adjustment
 * patchers are shared with the (not-yet-extracted) transactions handlers, so
 * they come from useReconciliationLocks/useTransactionPatchers rather than
 * being duplicated here.
 */
export function useLedgerActions({
 clientAccounts,
 transactions,
 adjustments,
 reconciliations,
 currencyMap,
 clientAccountMap,
 selectedClientForLedger,
 selectedClientLedgers,
 orderedLedgerColumnOptions,
 numLocale,
 isRTL,
 onDeleteTransaction,
 pushSharedSettingsIfOwner,
 pushUserTableSettings,
 ledgerHistory,
}: UseLedgerActionsParams) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const { invalidate: loadData, setters, setError } = useWorkspaceActions();
 const showUndo = useAppStatusStore((s) => s.showUndo);
 const setTransactions = setters.setTransactions;
 const setAdjustments = setters.setAdjustments;
 const setReconciliations = setters.setReconciliations;
 const pdfSettings = useSettingsStore((s) => s.pdfSettings);

 const { lockBoundaries, formatLockBalance, confirmIfLocked, confirmDeleteWithLock, confirmIfEditLocked, confirmIfTransactionEditLocked } = useReconciliationLocks({
  reconciliations,
  clientAccountMap,
 });
 const { applyTransactionPatch, applyAdjustmentPatch } = useTransactionPatchers({ clientAccountMap, currencyMap });

 const draggedLedgerColumn = useLedgerStore((s) => s.draggedLedgerColumn);
 const setDraggedLedgerColumn = useLedgerStore((s) => s.setDraggedLedgerColumn);
 const setLedgerColumnOrder = useLedgerStore((s) => s.setLedgerColumnOrder);
 const ledgerColumnOrder = useLedgerStore((s) => s.ledgerColumnOrder);
 const ledgerTransactionDrafts = useLedgerStore((s) => s.ledgerTransactionDrafts);
 const setLedgerTransactionDrafts = useLedgerStore((s) => s.setLedgerTransactionDrafts);
 const ledgerRateReversed = useLedgerStore((s) => s.ledgerRateReversed);
 const setLedgerRateReversed = useLedgerStore((s) => s.setLedgerRateReversed);
 const editingLedgerRowKeys = useLedgerStore((s) => s.editingLedgerRowKeys);
 const setEditingLedgerRowKeys = useLedgerStore((s) => s.setEditingLedgerRowKeys);
 const setEditAllLedgerAccountIds = useLedgerStore((s) => s.setEditAllLedgerAccountIds);
 const selectedLedgerEntryKeys = useLedgerStore((s) => s.selectedLedgerEntryKeys);
 const setSelectedLedgerEntryKeys = useLedgerStore((s) => s.setSelectedLedgerEntryKeys);
 const adjustmentModal = useLedgerStore((s) => s.adjustmentModal);
 const setAdjustmentModal = useLedgerStore((s) => s.setAdjustmentModal);
 const setPdfExportModal = useLedgerStore((s) => s.setPdfExportModal);

function openAdjustmentModal(accountId: number, existing?: ClientAdjustment) {
 const account = clientAccounts.find((a) => a.id === accountId);
 if (existing) {
  setAdjustmentModal({
   accountId,
   editingId: existing.id,
   amount: String(existing.amount),
   direction: existing.direction,
   currencyId: existing.currencyId ?? account?.currencyId ?? null,
   exchangeRate: existing.exchangeRate && existing.exchangeRate !== 1 ? String(existing.exchangeRate) : '',
   exchangeRateReversed: !!existing.exchangeRateReversed,
   description: existing.description,
   date: existing.createdAt.slice(0, 10),
  });
 } else {
  setAdjustmentModal({
   accountId,
   editingId: null,
   amount: '',
   direction: 'debit',
   currencyId: account?.currencyId ?? null,
   exchangeRate: '',
   exchangeRateReversed: false,
   description: '',
   date: localDateKey(),
  });
 }
}

function onLedgerColumnDrop(targetColumn: LedgerColumnKey) {
 if (!draggedLedgerColumn || draggedLedgerColumn === targetColumn) {
  setDraggedLedgerColumn(null);
  return;
 }

 setLedgerColumnOrder((current) => {
  const nextOrder = [...current];
  const draggedIndex = nextOrder.indexOf(draggedLedgerColumn);
  const targetIndex = nextOrder.indexOf(targetColumn);
  if (draggedIndex === -1 || targetIndex === -1) return current;
  nextOrder.splice(draggedIndex, 1);
  nextOrder.splice(targetIndex, 0, draggedLedgerColumn);
  // Save per-client so column order is independent for each client.
  const clientId = selectedClientForLedger?.id;
  if (clientId && typeof window !== 'undefined') {
   window.localStorage.setItem(ledgerColumnOrderStorageKeyPrefix + clientId, JSON.stringify(nextOrder));
  }
  return nextOrder;
 });

 setDraggedLedgerColumn(null);
 pushSharedSettingsIfOwner();
 pushUserTableSettings();
}

function buildLedgerTransactionDraft(transaction: Transaction, ledgerAccountId: number): LedgerTransactionDraft {
 const isOutgoing = transaction.accountFromId === ledgerAccountId;
 const rate = isOutgoing ? transaction.exchangeRateFrom : transaction.exchangeRateTo;
 const reversed = isOutgoing ? !!transaction.exchangeRateFromReversed : !!transaction.exchangeRateToReversed;
 const ledgerAccountForDraft = clientAccounts.find((a) => a.id === ledgerAccountId);
 const sameCurrency = ledgerAccountForDraft != null && ledgerAccountForDraft.currencyId === transaction.currencyId;
 // Always show the stored rate (including 1) so any exchange rate can be entered/edited freely.
 // Rate 0 on a cross-currency row means "not set yet" (pending): show a blank field so the user enters it.
 // On a same-currency row, 0 is a value the user deliberately chose, so show it as "0" so it round-trips.
 const rateStr = rate === 0 ? (sameCurrency ? '0' : '') : reversed ? formatRateValue(1 / rate) : String(rate);
 return {
  transactionId: transaction.id,
  ledgerAccountId,
  createdDate: transaction.createdAt.slice(0, 10),
  direction: isOutgoing ? 'outgoing' : 'incoming',
  counterpartyAccountId: isOutgoing ? transaction.accountToId : transaction.accountFromId,
  type: transaction.type,
  currencyId: transaction.currencyId,
  amount: String(transaction.amount),
  exchangeRate: rateStr,
  commission: String(isOutgoing ? transaction.commissionFrom : transaction.commissionTo),
  description: transaction.description,
  charges: String(transaction.charges || 0),
  chargesCurrencyId: transaction.chargesCurrencyId,
  chargesPayer: transaction.chargesPayer,
  chargesExchangeRate: String(transaction.chargesExchangeRate || 1),
  chargesDescription: transaction.chargesDescription,
 };
}

function buildLedgerAdjustmentDraft(adj: ClientAdjustment, ledgerAccountId: number): LedgerTransactionDraft {
 const account = clientAccounts.find((a) => a.id === ledgerAccountId);
 const rateStr = adj.exchangeRate && adj.exchangeRate !== 1 ? formatRateValue(adj.exchangeRateReversed ? 1 / adj.exchangeRate : adj.exchangeRate) : '';
 return {
  transactionId: -adj.id,
  adjustmentId: adj.id,
  isAdjustment: true,
  adjustmentDirection: adj.direction,
  ledgerAccountId,
  createdDate: adj.createdAt.slice(0, 10),
  direction: adj.direction === 'credit' ? 'outgoing' : 'incoming',
  counterpartyAccountId: null,
  type: 'adjustment',
  currencyId: adj.currencyId ?? account?.currencyId ?? null,
  amount: String(adj.amount),
  exchangeRate: rateStr,
  exchangeRateReversed: !!adj.exchangeRateReversed,
  commission: '0',
  description: adj.description,
  charges: '0',
  chargesCurrencyId: null,
  chargesPayer: '',
  chargesExchangeRate: '1',
  chargesDescription: '',
 };
}

function updateLedgerTransactionDraft(transactionId: number, ledgerAccountId: number, nextValues: Partial<LedgerTransactionDraft>) {
 ledgerHistory.record();
 setLedgerTransactionDrafts((current) => {
  const draftKey = getLedgerTransactionDraftKey(transactionId, ledgerAccountId);
  const existingDraft = current[draftKey];
  if (!existingDraft) {
   return current;
  }

  const merged = { ...existingDraft, ...nextValues };
  // Same stale-rate guard as updateTransactionTableDraft: if the charge's currency/payer
  // now matches the payer's own account currency, the stored chargesExchangeRate no
  // longer means anything — reset it to 1 rather than let it keep silently applying.
  if (merged.chargesCurrencyId != null && (merged.chargesPayer === 'from' || merged.chargesPayer === 'to')) {
   const isThisAccountFrom = merged.direction === 'outgoing';
   const payerAccountId =
    merged.chargesPayer === 'from' ? (isThisAccountFrom ? merged.ledgerAccountId : merged.counterpartyAccountId) : isThisAccountFrom ? merged.counterpartyAccountId : merged.ledgerAccountId;
   const payerAccount = payerAccountId != null ? clientAccountMap.get(payerAccountId) : undefined;
   if (payerAccount && payerAccount.currencyId === merged.chargesCurrencyId) {
    merged.chargesExchangeRate = '1.00';
   }
  }

  return {
   ...current,
   [draftKey]: merged,
  };
 });
}

function getClientLedgerDraft(transactionId: number, ledgerAccountId: number) {
 const draftKey = getLedgerTransactionDraftKey(transactionId, ledgerAccountId);
 const existingDraft = ledgerTransactionDrafts[draftKey];
 if (existingDraft) {
  return existingDraft;
 }

 if (transactionId < 0) {
  const adj = adjustments.find((a) => a.id === -transactionId);
  return adj ? buildLedgerAdjustmentDraft(adj, ledgerAccountId) : null;
 }
 const transaction = transactions.find((currentTransaction) => currentTransaction.id === transactionId);
 return transaction ? buildLedgerTransactionDraft(transaction, ledgerAccountId) : null;
}

async function onSaveLedgerTransaction(transactionId: number, ledgerAccountId: number, { skipReload = false } = {}): Promise<boolean> {
 if (!accountingApi) {
  setError(t('error_bridge'));
  return false;
 }

 const draft = ledgerTransactionDrafts[getLedgerTransactionDraftKey(transactionId, ledgerAccountId)];

 // ── Adjustment (expense) save path ──────────────────────────────────────────
 if (draft?.isAdjustment && draft.adjustmentId) {
  const adj = adjustments.find((a) => a.id === draft.adjustmentId);
  if (!adj) return false;
  const amount = parseFloat(draft.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
   setError(t('adjustment_amount_required'));
   return false;
  }
  const account = clientAccounts.find((a) => a.id === ledgerAccountId);
  const selectedCurrency = draft.currencyId ? currencyMap.get(draft.currencyId) : undefined;
  const needsRate = !!(selectedCurrency && account && selectedCurrency.code !== account.currencyCode);
  const parsedRate = parseFloat(draft.exchangeRate);
  const adjRateSet = Number.isFinite(parsedRate) && parsedRate > 0;
  const rateIsReversed = !!ledgerRateReversed[getLedgerTransactionDraftKey(transactionId, ledgerAccountId)] && adjRateSet;
  const effectiveRate = !needsRate ? 1 : adjRateSet ? (rateIsReversed ? 1 / parsedRate : parsedRate) : 0;
  const updatedAdj: ClientAdjustment = {
   id: draft.adjustmentId,
   accountId: ledgerAccountId,
   amount,
   direction: draft.adjustmentDirection ?? 'debit',
   currencyId: draft.currencyId ?? account?.currencyId ?? null,
   currencyCode: selectedCurrency?.code || account?.currencyCode || '',
   currencySymbol: selectedCurrency?.symbol || account?.currencySymbol || '',
   exchangeRate: effectiveRate,
   exchangeRateReversed: needsRate && adjRateSet ? rateIsReversed : false,
   description: draft.description,
   createdAt: resolveCreatedAt(draft.createdDate, adj.createdAt),
  };
  // Single-row saves check the lock here; batch saves are checked once up-front in
  // onSaveAllLedger (which passes skipReload) to avoid one dialog per row.
  if (!skipReload && !(await confirmIfEditLocked([adj.accountId], adj.createdAt, [updatedAdj.accountId], updatedAdj.createdAt, adj.id))) {
   return false;
  }
  try {
   await accountingApi.updateClientAdjustment(updatedAdj);
   setError('');
   applyAdjustmentPatch(updatedAdj);
   if (!skipReload) void loadData();
   return true;
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_update'));
   return false;
  }
 }

 // ── Transaction save path ────────────────────────────────────────────────────
 const transaction = transactions.find((currentTransaction) => currentTransaction.id === transactionId);

 if (!draft || !transaction) {
  return false;
 }

 const amount = parseFloat(draft.amount);
 // An explicitly-entered rate is stored as given — including 0, so a same-currency row can be
 // zeroed out (contributing 0 to the balance) instead of being forced to 1. An empty field
 // falls back to the default: 0 (pending, excluded from balance) cross-currency, 1 same-currency.
 const ledgerAccount = clientAccounts.find((a) => a.id === ledgerAccountId);
 const crossCurrency = ledgerAccount != null && ledgerAccount.currencyId !== draft.currencyId;
 const parsedLedgerRate = parseFloat(draft.exchangeRate);
 const rateEntered = draft.exchangeRate.trim() !== '' && Number.isFinite(parsedLedgerRate) && parsedLedgerRate >= 0;
 const rawLedgerRate = rateEntered ? parsedLedgerRate : crossCurrency ? 0 : 1;
 const rateIsReversed = !!ledgerRateReversed[getLedgerTransactionDraftKey(transactionId, ledgerAccountId)] && rawLedgerRate > 0;
 const exchangeRate = rateIsReversed ? 1 / rawLedgerRate : rawLedgerRate;
 const commission = parseFloat(draft.commission) || 0;

 // Senderless/receiverless transactions are a legitimate, permanent shape (no
 // counterparty on that side) — only require a counterparty here if the
 // transaction already had one, so editing (e.g. just the exchange rate)
 // doesn't get blocked by a side that was never meant to be filled in.
 // Uses the transaction's ORIGINAL side relative to this ledger account (not
 // draft.direction), since reversing direction in the draft must not reinterpret
 // which side the original counterparty was already missing from.
 const originalIsOutgoing = transaction.accountFromId === ledgerAccountId;
 const originalCounterpartyId = originalIsOutgoing ? transaction.accountToId : transaction.accountFromId;
 if ((originalCounterpartyId != null && !draft.counterpartyAccountId) || !amount || draft.currencyId == null) {
  setError(t('transaction_required'));
  return false;
 }

 // The counterparty side isn't editable from this ledger row, so its rate is normally carried
 // over from the transaction unchanged. But if a counterparty is being ADDED to a previously
 // one-sided transaction, that side's stored rate is a stale default (typically 1) — force it
 // to pending (0) when the new counterparty's currency differs from the transaction currency,
 // so it isn't silently applied as a 1:1 conversion in the counterparty's own ledger. Mirrors
 // the transaction-table draft guard / new-transaction form.
 let counterpartyRateFrom = transaction.exchangeRateFrom;
 let counterpartyRateTo = transaction.exchangeRateTo;
 let counterpartyReversedFrom = transaction.exchangeRateFromReversed ?? 0;
 let counterpartyReversedTo = transaction.exchangeRateToReversed ?? 0;
 if (originalCounterpartyId == null && draft.counterpartyAccountId != null) {
  const cpAccount = clientAccounts.find((a) => a.id === draft.counterpartyAccountId);
  const cpRate = cpAccount != null && cpAccount.currencyId !== draft.currencyId ? 0 : 1;
  if (draft.direction === 'outgoing') {
   counterpartyRateTo = cpRate;
   counterpartyReversedTo = 0;
  } else {
   counterpartyRateFrom = cpRate;
   counterpartyReversedFrom = 0;
  }
 }

 const createdAt = resolveCreatedAt(draft.createdDate, transaction.createdAt);
 const payload: TransactionUpdateInput = {
  id: transaction.id,
  accountFromId: draft.direction === 'outgoing' ? draft.ledgerAccountId : draft.counterpartyAccountId,
  accountToId: draft.direction === 'outgoing' ? draft.counterpartyAccountId : draft.ledgerAccountId,
  currencyId: draft.currencyId,
  amount,
  type: draft.type,
  exchangeRateFrom: draft.direction === 'outgoing' ? exchangeRate : counterpartyRateFrom,
  commissionFrom: draft.direction === 'outgoing' ? commission : transaction.commissionFrom,
  exchangeRateTo: draft.direction === 'incoming' ? exchangeRate : counterpartyRateTo,
  commissionTo: draft.direction === 'incoming' ? commission : transaction.commissionTo,
  exchangeRateFromReversed: draft.direction === 'outgoing' ? (rateIsReversed ? 1 : 0) : counterpartyReversedFrom,
  exchangeRateToReversed: draft.direction === 'incoming' ? (rateIsReversed ? 1 : 0) : counterpartyReversedTo,
  // The actual (الفعلي) settled destination amount isn't editable from a ledger row, so carry it
  // through unchanged. Omitting it made the reconciliation guard's per-side net-change comparison
  // treat the untouched exchange "to" side as changed (old value vs. undefined), producing a
  // spurious "you may affect the reconciled balance" warning when editing only the commission.
  exchangeActualAmount: transaction.exchangeActualAmount,
  charges: parseFloat(draft.charges) || 0,
  chargesCurrencyId: draft.chargesCurrencyId,
  chargesPayer: draft.chargesPayer,
  chargesExchangeRate: parseFloat(draft.chargesExchangeRate) || 1,
  chargesDescription: draft.chargesDescription,
  description: draft.description,
  createdAt,
 };

 // Single-row saves check the lock here; batch saves are checked once up-front in
 // onSaveAllLedger (which passes skipReload) to avoid one dialog per row.
 if (!skipReload && !(await confirmIfTransactionEditLocked(transaction, payload))) {
  return false;
 }

 try {
  await accountingApi.updateTransaction(payload);
  setError('');
  // Optimistically reflect the edit so the ledger updates instantly (no page-wide reload,
  // no account jump). The batch saver passes skipReload and reconciles once at the end.
  applyTransactionPatch(payload);
  if (!skipReload) void loadData();
  return true;
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_update'));
  return false;
 }
}

function onCancelLedgerTransaction(transactionId: number, ledgerAccountId: number) {
 const transaction = transactions.find((currentTransaction) => currentTransaction.id === transactionId);
 if (!transaction) {
  return;
 }

 const draftKey = getLedgerTransactionDraftKey(transactionId, ledgerAccountId);
 setLedgerTransactionDrafts((current) => ({
  ...current,
  [draftKey]: buildLedgerTransactionDraft(transaction, ledgerAccountId),
 }));
}

function onEditAllLedger(ledger: ClientAccountLedger) {
 const newDrafts: Record<string, LedgerTransactionDraft> = {};
 const newRateReversed: Record<string, boolean> = {};
 const newKeys: string[] = [];
 for (const entry of ledger.entries) {
  const draftKey = getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId);
  if (entry.isAdjustment && entry.adjustmentId) {
   const adj = adjustments.find((a) => a.id === entry.adjustmentId);
   if (!adj) continue;
   if (!ledgerTransactionDrafts[draftKey]) {
    newDrafts[draftKey] = buildLedgerAdjustmentDraft(adj, ledger.accountId);
    if (adj.exchangeRateReversed) newRateReversed[draftKey] = true;
   }
  } else {
   const tx = transactions.find((t) => t.id === entry.transactionId);
   if (!tx) continue;
   if (!ledgerTransactionDrafts[draftKey]) {
    newDrafts[draftKey] = buildLedgerTransactionDraft(tx, ledger.accountId);
    const isOutgoing = tx.accountFromId === ledger.accountId;
    if (isOutgoing ? tx.exchangeRateFromReversed : tx.exchangeRateToReversed) {
     newRateReversed[draftKey] = true;
    }
   }
  }
  newKeys.push(draftKey);
 }
 setLedgerTransactionDrafts((prev) => ({ ...prev, ...newDrafts }));
 setLedgerRateReversed((prev) => ({ ...prev, ...newRateReversed }));
 setEditingLedgerRowKeys((prev) => new Set([...prev, ...newKeys]));
 setEditAllLedgerAccountIds((prev) => new Set([...prev, ledger.accountId]));
}

function onCancelAllLedger(ledger: ClientAccountLedger) {
 const keys = ledger.entries.map((e) => getLedgerTransactionDraftKey(e.transactionId, ledger.accountId));
 setEditingLedgerRowKeys((prev) => {
  const n = new Set(prev);
  keys.forEach((k) => n.delete(k));
  return n;
 });
 setLedgerTransactionDrafts((prev) => {
  const n = { ...prev };
  keys.forEach((k) => delete n[k]);
  return n;
 });
 setEditAllLedgerAccountIds((prev) => {
  const n = new Set(prev);
  n.delete(ledger.accountId);
  return n;
 });
}

async function onSaveAllLedger(ledger: ClientAccountLedger) {
 const keys = ledger.entries.map((e) => getLedgerTransactionDraftKey(e.transactionId, ledger.accountId)).filter((k) => editingLedgerRowKeys.has(k));

 // One up-front lock check for the whole batch (the per-row saves below skipReload, so
 // they don't each prompt). Warns once if any edited row touches reconciled history.
 let batchLockHit: { accountId: number; boundary: { balance: number } } | null = null;
 for (const key of keys) {
  const [txIdStr, accIdStr] = key.split(':');
  const accId = parseInt(accIdStr, 10);
  const draft = ledgerTransactionDrafts[key];
  if (!draft) continue;
  if (draft.isAdjustment && draft.adjustmentId) {
   const adj = adjustments.find((a) => a.id === draft.adjustmentId);
   if (!adj) continue;
   batchLockHit = violatedLock([adj.accountId], adj.createdAt, adj.id, lockBoundaries) ?? violatedLock([accId], resolveCreatedAt(draft.createdDate, adj.createdAt), adj.id, lockBoundaries);
  } else {
   const tx = transactions.find((t) => t.id === parseInt(txIdStr, 10));
   if (!tx) continue;
   batchLockHit = violatedLock([tx.accountFromId, tx.accountToId], tx.createdAt, tx.id, lockBoundaries) ?? violatedLock([accId, draft.counterpartyAccountId], resolveCreatedAt(draft.createdDate, tx.createdAt), tx.id, lockBoundaries);
  }
  if (batchLockHit) break;
 }
 if (batchLockHit && !(await confirmDialog({ title: t('reconcile_warn_title'), message: t('reconcile_warn_message', { balance: formatLockBalance(batchLockHit.accountId, batchLockHit.boundary.balance) }), confirmText: t('reconcile_warn_confirm'), tone: 'danger' }))) {
  return;
 }

 // Fire all saves in parallel so 100+ rows finish in one round-trip batch rather than sequentially.
 // Each save applies its optimistic patch, so the table is already up to date here.
 const results = await Promise.all(
  keys.map(async (key) => {
   const [txIdStr, accIdStr] = key.split(':');
   const ok = await onSaveLedgerTransaction(parseInt(txIdStr, 10), parseInt(accIdStr, 10), { skipReload: true });
   return [key, ok] as const;
  }),
 );
 // Only exit edit mode / discard the draft for rows that actually saved — a
 // failed row stays open with its typed value intact and the error visible,
 // instead of silently reverting as if the save had succeeded.
 const succeededKeys = results.filter(([, ok]) => ok).map(([key]) => key);
 setEditingLedgerRowKeys((prev) => {
  const n = new Set(prev);
  succeededKeys.forEach((k) => n.delete(k));
  return n;
 });
 setLedgerTransactionDrafts((prev) => {
  const n = { ...prev };
  succeededKeys.forEach((k) => delete n[k]);
  return n;
 });
 if (succeededKeys.length === keys.length) {
  setEditAllLedgerAccountIds((prev) => {
   const n = new Set(prev);
   n.delete(ledger.accountId);
   return n;
  });
 }
 void loadData();
}

async function onSaveLedgerRow(transactionId: number, ledgerAccountId: number) {
 const draftKey = getLedgerTransactionDraftKey(transactionId, ledgerAccountId);
 if (!ledgerTransactionDrafts[draftKey]) {
  setEditingLedgerRowKeys((prev) => {
   const n = new Set(prev);
   n.delete(draftKey);
   return n;
  });
  return;
 }
 const success = await onSaveLedgerTransaction(transactionId, ledgerAccountId);
 // On failure, keep edit mode and the draft intact so the user sees the error and can retry.
 if (!success) return;
 setEditingLedgerRowKeys((prev) => {
  const n = new Set(prev);
  n.delete(draftKey);
  return n;
 });
 setLedgerTransactionDrafts((prev) => {
  const n = { ...prev };
  delete n[draftKey];
  return n;
 });
}

async function onSaveAllEditingLedgerRows() {
 const editingAccountIds = new Set([...editingLedgerRowKeys].map((k) => parseInt(k.split(':')[1], 10)));
 for (const ledger of selectedClientLedgers) {
  if (editingAccountIds.has(ledger.accountId)) await onSaveAllLedger(ledger);
 }
}

function onCancelAllEditingLedgerRows() {
 const editingAccountIds = new Set([...editingLedgerRowKeys].map((k) => parseInt(k.split(':')[1], 10)));
 for (const ledger of selectedClientLedgers) {
  if (editingAccountIds.has(ledger.accountId)) onCancelAllLedger(ledger);
 }
}

function openLedgerRowForEdit(entry: ClientLedgerEntry, ledgerAccountId: number) {
 const rowKey = getLedgerTransactionDraftKey(entry.transactionId, ledgerAccountId);
 if (entry.isAdjustment && entry.adjustmentId) {
  const adjustment = adjustments.find((a) => a.id === entry.adjustmentId);
  if (adjustment && !ledgerTransactionDrafts[rowKey]) {
   if (adjustment.exchangeRateReversed) {
    setLedgerRateReversed((prev) => ({ ...prev, [rowKey]: true }));
   }
   setLedgerTransactionDrafts((prev) => ({ ...prev, [rowKey]: buildLedgerAdjustmentDraft(adjustment, ledgerAccountId) }));
  }
  setEditingLedgerRowKeys((prev) => new Set([...prev, rowKey]));
  return;
 }
 const transaction = transactions.find((tx) => tx.id === entry.transactionId);
 if (transaction && !ledgerTransactionDrafts[rowKey]) {
  const isOutgoing = transaction.accountFromId === ledgerAccountId;
  setLedgerRateReversed((prev) => ({
   ...prev,
   ...(isOutgoing ? (transaction.exchangeRateFromReversed ? { [rowKey]: true } : {}) : transaction.exchangeRateToReversed ? { [rowKey]: true } : {}),
  }));
  setLedgerTransactionDrafts((prev) => ({ ...prev, [rowKey]: buildLedgerTransactionDraft(transaction, ledgerAccountId) }));
 }
 setEditingLedgerRowKeys((prev) => new Set([...prev, rowKey]));
}

function onLedgerEditFieldSideKey(event: ReactKeyboardEvent<HTMLInputElement>, field: 'amount' | 'exchangeRate' | 'commission', entry: ClientLedgerEntry, ledgerAccountId: number): boolean {
 if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return false;
 const input = event.currentTarget;
 const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
 const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
 if ((event.key === 'ArrowLeft' && !atStart) || (event.key === 'ArrowRight' && !atEnd)) return false;

 const editableFieldOrder = orderedLedgerColumnOptions
  .map((column) => column.key)
  .filter((key): key is 'amount' | 'exchangeRate' | 'commission' => key === 'amount' || key === 'exchangeRate' || key === 'commission');
 const currentIdx = editableFieldOrder.indexOf(field);
 if (currentIdx === -1) return true;
 const forward = event.key === 'ArrowRight' ? 1 : -1;
 const step = isRTL ? -forward : forward;
 const nextField = editableFieldOrder[currentIdx + step];
 if (!nextField) return true;

 event.preventDefault();
 const rowKey = getLedgerTransactionDraftKey(entry.transactionId, ledgerAccountId);
 const target = document.querySelector<HTMLInputElement>(`[data-ledger-field="${nextField}"][data-ledger-key="${rowKey}"]`);
 if (target) {
  target.focus();
  const pos = event.key === 'ArrowRight' ? 0 : target.value.length;
  target.setSelectionRange(pos, pos);
 }
 return true;
}

function onLedgerEditFieldArrowKey(
 event: ReactKeyboardEvent<HTMLInputElement>,
 field: 'amount' | 'exchangeRate' | 'commission',
 entry: ClientLedgerEntry,
 ledgerAccountId: number,
 pagedEntries: ClientLedgerEntry[],
 entryIdx: number,
) {
 if (onLedgerEditFieldSideKey(event, field, entry, ledgerAccountId)) return;
 if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
 event.preventDefault();
 const neighbor = pagedEntries[entryIdx + (event.key === 'ArrowDown' ? 1 : -1)];
 if (!neighbor) return;
 const neighborKey = getLedgerTransactionDraftKey(neighbor.transactionId, ledgerAccountId);
 const focusNeighborField = () => {
  const target =
   document.querySelector<HTMLInputElement>(`[data-ledger-field="${field}"][data-ledger-key="${neighborKey}"]`) ??
   document.querySelector<HTMLInputElement>(`[data-ledger-key="${neighborKey}"]`);
  if (target) {
   target.focus();
   target.select?.();
  }
 };
 if (editingLedgerRowKeys.has(neighborKey)) {
  focusNeighborField();
  return;
 }
 openLedgerRowForEdit(neighbor, ledgerAccountId);
 void onSaveLedgerRow(entry.transactionId, ledgerAccountId);
 // Wait for the neighbour's inputs to render before focusing.
 setTimeout(focusNeighborField, 0);
}

async function onDeleteLedgerEntry(entry: ClientLedgerEntry, ledgerAccountId: number) {
 const key = getLedgerTransactionDraftKey(entry.transactionId, ledgerAccountId);
 if (entry.isAdjustment && entry.adjustmentId) {
  await onDeleteAdjustment(entry.adjustmentId);
 } else {
  await onDeleteTransaction(entry.transactionId);
 }
 setEditingLedgerRowKeys((prev) => {
  const n = new Set(prev);
  n.delete(key);
  return n;
 });
 setSelectedLedgerEntryKeys((prev) => {
  const n = new Set(prev);
  n.delete(key);
  return n;
 });
}

async function onReconcileLedgerEntry(entry: ClientLedgerEntry, ledgerAccountId: number) {
 if (entry.reconciledMark) return; // already reconciled on this exact row
 const anchorKind: 'transaction' | 'adjustment' = entry.isAdjustment ? 'adjustment' : 'transaction';
 const anchorRefId = entry.isAdjustment ? entry.adjustmentId ?? 0 : entry.transactionId;
 try {
  const created = await accountingApi.createReconciliation({
   accountId: ledgerAccountId,
   anchorKind,
   anchorRefId,
   anchorCreatedAt: entry.createdAt,
   balance: entry.runningBalance,
   note: '',
  });
  setReconciliations((prev) => [
   ...prev,
   { id: created.id, accountId: ledgerAccountId, anchorKind, anchorRefId, anchorCreatedAt: entry.createdAt, balance: entry.runningBalance, note: '', createdAt: new Date().toISOString() },
  ]);
  setError('');
  await loadData();
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_save'));
 }
}

async function onRemoveReconciliation(entry: ClientLedgerEntry, ledgerAccountId: number) {
 const markId = entry.reconciledMark?.id;
 if (!markId) return;
 if (!(await confirmDialog({ message: t('reconcile_remove_confirm'), confirmText: t('reconcile_remove'), tone: 'danger' }))) return;
 try {
  await accountingApi.deleteReconciliation(markId);
  setReconciliations((prev) => prev.filter((r) => r.id !== markId));
  setError('');
  await loadData();
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_save'));
 }
}

function onToggleLedgerEntrySelection(key: string) {
 setSelectedLedgerEntryKeys((prev) => {
  const next = new Set(prev);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
 });
}

async function onDeleteSelectedLedgerEntries() {
 const keys = [...selectedLedgerEntryKeys];
 for (const key of keys) {
  const [txIdStr, accIdStr] = key.split(':');
  const txId = Number(txIdStr);
  const accId = Number(accIdStr);
  const ledger = selectedClientLedgers.find((l) => l.accountId === accId);
  const entry = ledger?.entries.find((e) => e.transactionId === txId);
  if (!entry) continue;
  if (entry.isAdjustment && entry.adjustmentId) {
   await onDeleteAdjustment(entry.adjustmentId, { offerUndo: false });
  } else {
   await onDeleteTransaction(entry.transactionId, { offerUndo: false });
  }
 }
 setSelectedLedgerEntryKeys(new Set());
 setError('');
 await loadData();
}

// Bulk "Edit" from the selection context menu: drop every selected entry into edit mode
// at once, reusing the same per-row draft initialisation as opening a single row for edit.
function onEditSelectedLedgerEntries() {
 for (const key of selectedLedgerEntryKeys) {
  const [txIdStr, accIdStr] = key.split(':');
  const txId = Number(txIdStr);
  const accId = Number(accIdStr);
  const ledger = selectedClientLedgers.find((l) => l.accountId === accId);
  const entry = ledger?.entries.find((e) => e.transactionId === txId);
  if (entry) openLedgerRowForEdit(entry, accId);
 }
}

async function onSubmitAdjustment() {
 if (!accountingApi || !adjustmentModal) {
  setError(t('error_bridge'));
  return;
 }

 const amount = parseFloat(adjustmentModal.amount);
 if (!Number.isFinite(amount) || amount <= 0) {
  setError(t('adjustment_amount_required'));
  return;
 }

 const account = clientAccounts.find((a) => a.id === adjustmentModal.accountId);
 const selectedCurrency = adjustmentModal.currencyId ? currencyMap.get(adjustmentModal.currencyId) : undefined;
 const needsRate = !!(selectedCurrency && account && selectedCurrency.code !== account.currencyCode);
 // Cross-currency with no rate entered → 0 (unset → pending, excluded from balance until set).
 const parsedAdjRate = parseFloat(adjustmentModal.exchangeRate);
 const adjRateSet = Number.isFinite(parsedAdjRate) && parsedAdjRate > 0;
 const effectiveRate = !needsRate ? 1 : adjRateSet ? (adjustmentModal.exchangeRateReversed ? 1 / parsedAdjRate : parsedAdjRate) : 0;

 // Editing an existing expense must never change its position: preserve the original
 // timestamp (only the date shifts if the user changed it). A brand-new expense lands at
 // the end of its date's sequence, exactly like a newly created transaction.
 const existingAdj = adjustmentModal.editingId ? adjustments.find((a) => a.id === adjustmentModal.editingId) : undefined;
 const createdAt = existingAdj ? resolveCreatedAt(adjustmentModal.date, existingAdj.createdAt) : nextCreatedAtForDate(adjustmentModal.date, transactions, adjustments);

 const payloadBase = {
  amount,
  direction: adjustmentModal.direction,
  currencyId: adjustmentModal.currencyId,
  currencyCode: selectedCurrency?.code || account?.currencyCode || '',
  currencySymbol: selectedCurrency?.symbol || account?.currencySymbol || '',
  exchangeRate: effectiveRate,
  exchangeRateReversed: needsRate && adjRateSet ? adjustmentModal.exchangeRateReversed : false,
  description: adjustmentModal.description.trim(),
  createdAt,
 };

 // Reconciliation guard: creating/re-dating an expense on or before the lock line — or
 // editing one that currently sits there — rewrites reconciled history.
 const adjRefId = adjustmentModal.editingId ?? NEW_ROW_REF_ID;
 if (!(await confirmIfEditLocked(existingAdj ? [existingAdj.accountId] : [], existingAdj?.createdAt ?? createdAt, [adjustmentModal.accountId], createdAt, adjRefId))) {
  return;
 }

 try {
  if (adjustmentModal.editingId) {
   await accountingApi.updateClientAdjustment({
    id: adjustmentModal.editingId,
    ...payloadBase,
   });
  } else {
   await accountingApi.createClientAdjustment({
    accountId: adjustmentModal.accountId,
    ...payloadBase,
   });
  }
  setAdjustmentModal(null);
  setError('');
  await loadData();
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_save'));
 }
}

async function onDeleteAdjustment(id: number, opts: { offerUndo?: boolean } = {}) {
 const { offerUndo = true } = opts;
 if (!accountingApi) {
  setError(t('error_bridge'));
  return;
 }

 const adj = adjustments.find((a) => a.id === id);
 if (!(await confirmDeleteWithLock(adj ? [adj.accountId] : [], adj?.createdAt ?? '', id, 'adjustment_delete_confirm'))) {
  return;
 }

 try {
  await accountingApi.deleteClientAdjustment(id);
  setError('');
  await loadData();
  if (offerUndo && adj) {
   showUndo(t('toast_expense_deleted'), () => void onUndoDeleteAdjustment(adj));
  }
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_delete'));
 }
}

async function onUndoDeleteAdjustment(adj: ClientAdjustment) {
 if (!accountingApi) {
  setError(t('error_bridge'));
  return;
 }
 try {
  await accountingApi.createClientAdjustment({
   accountId: adj.accountId,
   amount: adj.amount,
   direction: adj.direction,
   currencyId: adj.currencyId,
   currencyCode: adj.currencyCode,
   currencySymbol: adj.currencySymbol,
   exchangeRate: adj.exchangeRate,
   exchangeRateReversed: !!adj.exchangeRateReversed,
   description: adj.description,
   createdAt: adj.createdAt,
  });
  setError('');
  await loadData();
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_save'));
 }
}

async function onWriteOffLedgerRow(entry: ClientLedgerEntry, ledgerAccountId: number) {
 if (!accountingApi) {
  setError(t('error_bridge'));
  return;
 }
 const balance = entry.runningBalance;
 const amount = Math.abs(balance);
 if (amount <= 0) return;

 const account = clientAccounts.find((a) => a.id === ledgerAccountId);
 if (!account) return;

 // Time-place the write-off strictly after the target row (and before the next one when
 // there's room), so it sorts right after this row in the ledger. Must never land on the
 // exact same createdAt as the target: same-timestamp ties are broken by comparing raw
 // adjustmentId against transactionId (two independent id sequences), which can easily sort
 // a new write-off before the row it's meant to follow.
 const ledger = selectedClientLedgers.find((l) => l.accountId === ledgerAccountId);
 const entries = ledger?.entries ?? [];
 const idx = entries.findIndex((e) => e.transactionId === entry.transactionId);
 const nextEntry = idx >= 0 ? entries[idx + 1] : undefined;
 const targetMs = Date.parse(entry.createdAt);
 let createdAtMs = targetMs + 1;
 if (nextEntry) {
  const nextMs = Date.parse(nextEntry.createdAt);
  if (nextMs > createdAtMs) createdAtMs = targetMs + Math.min(1000, Math.floor((nextMs - targetMs) / 2));
 }
 const createdAt = new Date(createdAtMs).toISOString();

 const confirmed = await confirmDialog({
  title: t('write_off_confirm_title'),
  message: t('write_off_row_confirm_message')
   .replace('{amount}', amount.toLocaleString(numLocale, { maximumFractionDigits: 2 }))
   .replace('{currency}', account.currencySymbol || account.currencyCode)
   .replace('{balance}', balance.toLocaleString(numLocale, { maximumFractionDigits: 2 })),
  confirmText: t('write_off_confirm_button'),
  tone: 'danger',
 });
 if (!confirmed) return;

 // Reconciliation guard: inserting a row at/before a lock line rewrites reconciled history.
 if (!(await confirmIfLocked([ledgerAccountId], createdAt, NEW_ROW_REF_ID))) return;

 try {
  await accountingApi.createClientAdjustment({
   accountId: ledgerAccountId,
   amount,
   direction: balance > 0 ? 'debit' : 'credit',
   currencyId: account.currencyId,
   currencyCode: account.currencyCode,
   currencySymbol: account.currencySymbol,
   exchangeRate: 1,
   exchangeRateReversed: false,
   description: t('write_off_description'),
   createdAt,
  });
  setError('');
  await loadData();
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_save'));
 }
}

async function onLedgerRowDrop(draggedKeys: string[], targetKey: string, dropHalf: 'top' | 'bottom', accountId: number) {
 const ledger = selectedClientLedgers.find((l) => l.accountId === accountId);
 if (!ledger || !accountingApi) return;
 const currentOrder = ledger.entries.map((e) => `${e.transactionId}:${accountId}`);
 if (!currentOrder.includes(targetKey)) return;
 const entryMap = new Map(ledger.entries.map((e) => [`${e.transactionId}:${accountId}`, e]));
 const dateOf = (key: string) => entryMap.get(key)?.createdAt.slice(0, 10) ?? '';

 // A row's date is only ever changed by an explicit manual edit, never by dragging it —
 // so only rows that already share the target row's date are eligible to move; any dragged
 // row from a different date is dropped from this operation and keeps its position untouched.
 const targetDate = dateOf(targetKey);
 const dragSet = new Set(draggedKeys.filter((k) => k !== targetKey && dateOf(k) === targetDate));
 if (dragSet.size === 0) return;

 // The ledger is ordered by createdAt (ascending). Same-date rows often share an
 // identical timestamp (e.g. expenses at 00:00:00), leaving no room to insert between
 // them, so we reflow the target date's rows to distinct, evenly-spaced timestamps in
 // the new order. That makes the reorder durable without touching any row's date.
 const dateGroup = currentOrder.filter((k) => dateOf(k) === targetDate);
 const without = dateGroup.filter((k) => !dragSet.has(k));
 const insertIdx = without.indexOf(targetKey);
 if (insertIdx === -1) return;
 const insertAt = dropHalf === 'top' ? insertIdx : insertIdx + 1;
 const orderedDragged = dateGroup.filter((k) => dragSet.has(k));
 const next = [...without.slice(0, insertAt), ...orderedDragged, ...without.slice(insertAt)];

 const newTimes = new Map<string, string>();
 const dayStart = Date.parse(`${targetDate}T00:00:00.000Z`);
 const dayEnd = Date.parse(`${targetDate}T23:59:59.999Z`);
 next.forEach((k, i) => {
  const ts = dayStart + ((dayEnd - dayStart) * (i + 1)) / (next.length + 1);
  newTimes.set(k, new Date(ts).toISOString());
 });

 // Reconciliation guard: reordering only changes the reconciled balance if a dragged row
 // CROSSES the lock's anchor row — moving from before it to after it, or vice versa. The
 // reconciled balance is the running balance at the anchor (the sum of every entry up to and
 // including it), so shuffling rows that all stay on the same side of the anchor leaves it
 // untouched and must NOT warn (e.g. reordering two old rows both before the reconciliation).
 // A reorder can only cross the anchor when the anchor sits on the same date being reflowed;
 // if it's on another date, no same-date reorder can reach it. Compared by ORDER INDEX (not
 // timestamp), since the reflow re-times the anchor too.
 const boundary = lockBoundaries.get(accountId);
 if (boundary && targetDate === boundary.anchorCreatedAt.slice(0, 10)) {
  const refOf = (k: string) => {
   const e = entryMap.get(k);
   return e ? (e.isAdjustment ? e.adjustmentId ?? 0 : e.transactionId) : null;
  };
  const oldAnchorIdx = dateGroup.findIndex((k) => refOf(k) === boundary.anchorRefId);
  const newAnchorIdx = next.findIndex((k) => refOf(k) === boundary.anchorRefId);
  const anchorMoved = orderedDragged.some((k) => refOf(k) === boundary.anchorRefId);
  // A crossing only shifts the reconciled balance if the row that crosses carries a non-zero
  // net change; moving a zero-net row (e.g. a pending/0-rate transaction) across the anchor
  // leaves the balance untouched and must NOT warn.
  const crosses =
   oldAnchorIdx !== -1 &&
   newAnchorIdx !== -1 &&
   orderedDragged.some(
    (k) => (dateGroup.indexOf(k) <= oldAnchorIdx) !== (next.indexOf(k) <= newAnchorIdx) && Math.abs(entryMap.get(k)?.netChange ?? 0) > 1e-6,
   );
  if ((anchorMoved || crosses) && !(await confirmIfLocked([accountId], boundary.anchorCreatedAt, boundary.anchorRefId))) return;
 }

 // Optimistically apply the new timestamps so the rows reorder instantly, before the round-trip.
 setTransactions((prev) =>
  prev.map((tx) => {
   const nc = newTimes.get(`${tx.id}:${accountId}`);
   return nc ? { ...tx, createdAt: nc } : tx;
  }),
 );
 setAdjustments((prev) =>
  prev.map((adj) => {
   const nc = newTimes.get(`${-adj.id}:${accountId}`);
   return nc ? { ...adj, createdAt: nc } : adj;
  }),
 );

 try {
  for (const [key, newCreatedAt] of newTimes) {
   const entry = entryMap.get(key);
   if (!entry || !newCreatedAt) continue;
   // Skip rows whose timestamp didn't actually change, to avoid needless writes.
   if (new Date(entry.createdAt).getTime() === new Date(newCreatedAt).getTime()) continue;
   if (entry.isAdjustment && entry.adjustmentId) {
    const adj = adjustments.find((a) => a.id === entry.adjustmentId);
    if (!adj) continue;
    await accountingApi.updateClientAdjustment({
     id: adj.id,
     accountId,
     amount: adj.amount,
     direction: adj.direction,
     currencyId: adj.currencyId ?? clientAccounts.find((a) => a.id === accountId)?.currencyId ?? 0,
     currencyCode: adj.currencyCode,
     currencySymbol: adj.currencySymbol,
     exchangeRate: adj.exchangeRate,
     exchangeRateReversed: adj.exchangeRateReversed,
     description: adj.description,
     createdAt: newCreatedAt,
    });
   } else {
    const tx = transactions.find((t) => t.id === entry.transactionId);
    if (!tx) continue;
    await accountingApi.updateTransaction({
     id: tx.id,
     accountFromId: tx.accountFromId,
     accountToId: tx.accountToId,
     currencyId: tx.currencyId,
     amount: tx.amount,
     type: tx.type,
     exchangeRateFrom: tx.exchangeRateFrom,
     commissionFrom: tx.commissionFrom,
     exchangeRateTo: tx.exchangeRateTo,
     commissionTo: tx.commissionTo,
     exchangeRateFromReversed: tx.exchangeRateFromReversed,
     exchangeRateToReversed: tx.exchangeRateToReversed,
     charges: tx.charges,
     chargesCurrencyId: tx.chargesCurrencyId,
     chargesPayer: tx.chargesPayer,
     chargesExchangeRate: tx.chargesExchangeRate,
     chargesDescription: tx.chargesDescription,
     description: tx.description,
     createdAt: newCreatedAt,
    });
   }
  }
  setError('');
  await loadData();
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_update'));
  await loadData();
 }
}

async function onExportLedgerPdf(
 ledger: ClientAccountLedger,
 fromDate: string,
 toDate: string,
 colVisibility: PdfColVisibility,
 fromEntryKey?: string | null,
 toEntryKey?: string | null,
) {
 if (!accountingApi) return;
 try {
  const html = generateLedgerHtml({ t, numLocale, isRTL, language, pdfSettings }, { ledger, fromDate, toDate, colVisibility, fromEntryKey, toEntryKey, selectedClientForLedger, transactions, ledgerColumnOrder });
  const clientName = (selectedClientForLedger?.name ?? 'client').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '');
  const defaultFileName = `${clientName}_${ledger.currencyCode}_${fromDate}_${toDate}.pdf`;
  const result = await accountingApi.exportLedgerPdf({ html, defaultFileName });
  if (result.ok) setPdfExportModal(null);
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_save'));
 }
}

async function onExportLedgerExcel(
 ledger: ClientAccountLedger,
 fromDate: string,
 toDate: string,
 colVisibility: PdfColVisibility,
 fromEntryKey?: string | null,
 toEntryKey?: string | null,
) {
 try {
  const candidates = ledger.entries.filter((e) => {
   const d = e.createdAt.slice(0, 10);
   return d >= fromDate && d <= toDate;
  });
  const startIdx = fromEntryKey ? Math.max(0, candidates.findIndex((e) => ledgerEntryKey(e) === fromEntryKey)) : 0;
  const endIdxRaw = toEntryKey ? candidates.findIndex((e) => ledgerEntryKey(e) === toEntryKey) : -1;
  const endIdx = endIdxRaw === -1 ? candidates.length - 1 : endIdxRaw;
  const selected = startIdx <= endIdx ? candidates.slice(startIdx, endIdx + 1) : [];

  type ExcelColDef = { key: LedgerColumnKey; header: string; cell: (e: ClientLedgerEntry) => string | number };
  const allCols: ExcelColDef[] = [
   { key: 'created', header: t('date'), cell: (e) => formatDateValue(e.createdAt, pdfSettings.dateFormat) },
   { key: 'counterparty', header: t('counterparty'), cell: (e) => e.counterpartyName },
   { key: 'direction', header: t('direction'), cell: (e) => (e.isAdjustment ? t(e.direction === 'outgoing' ? 'adjustment_direction_credit' : 'adjustment_direction_debit') : t(e.direction === 'outgoing' ? 'outgoing' : 'incoming')) },
   { key: 'type', header: t('transaction_type'), cell: (e) => (e.isAdjustment ? t('adjustment_label') : t(transactionTypeLabelKey(e.type))) },
   { key: 'amount', header: t('amount'), cell: (e) => e.amount },
   { key: 'exchangeRate', header: t('exchange_rate'), cell: (e) => (e.pendingRate ? '' : e.isAdjustment ? (e.exchangeRateReversed ? 1 / e.exchangeRate : e.exchangeRate) : e.exchangeRate) },
   { key: 'commission', header: t('commission'), cell: (e) => (e.isAdjustment ? '' : e.commission) },
   { key: 'netChange', header: t('net_change'), cell: (e) => (e.pendingRate ? '' : e.netChange) },
   { key: 'runningBalance', header: t('running_balance'), cell: (e) => e.runningBalance },
   { key: 'currency', header: t('currency'), cell: (e) => e.currencyCode },
   { key: 'description', header: t('transaction_description'), cell: (e) => e.description ?? '' },
  ];
  const visibleCols = ledgerColumnOrder
   .map((key) => allCols.find((col) => col.key === key))
   .filter((col): col is ExcelColDef => Boolean(col))
   .filter((col) => col.key === 'runningBalance' || colVisibility[col.key]);
  if (!visibleCols.some((col) => col.key === 'runningBalance')) {
   const rbCol = allCols.find((col) => col.key === 'runningBalance');
   if (rbCol) visibleCols.push(rbCol);
  }

  const headers = visibleCols.map((col) => col.header);
  const rows = selected.map((entry) => visibleCols.map((col) => col.cell(entry)));
  const xlsxModule = await import('xlsx');
  const worksheet = xlsxModule.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = xlsxModule.utils.book_new();
  xlsxModule.utils.book_append_sheet(workbook, worksheet, 'Ledger');
  const clientName = (selectedClientForLedger?.name ?? 'client').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '');
  xlsxModule.writeFile(workbook, `${clientName}_${ledger.currencyCode}_${fromDate}_${toDate}.xlsx`);
  setPdfExportModal(null);
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_save'));
 }
}

 return {
  openAdjustmentModal,
  onLedgerColumnDrop,
  getClientLedgerDraft,
  updateLedgerTransactionDraft,
  onEditAllLedger,
  onCancelAllLedger,
  onSaveAllLedger,
  onSaveLedgerRow,
  onSaveAllEditingLedgerRows,
  onCancelAllEditingLedgerRows,
  openLedgerRowForEdit,
  onLedgerEditFieldArrowKey,
  onDeleteLedgerEntry,
  onReconcileLedgerEntry,
  onRemoveReconciliation,
  onToggleLedgerEntrySelection,
  onDeleteSelectedLedgerEntries,
  onEditSelectedLedgerEntries,
  onSubmitAdjustment,
  onDeleteAdjustment,
  onWriteOffLedgerRow,
  onLedgerRowDrop,
  onExportLedgerPdf,
  onExportLedgerExcel,
 };
}
