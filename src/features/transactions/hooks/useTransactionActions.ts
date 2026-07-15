'use client';

import type { ChangeEvent, Dispatch, FormEvent, RefObject, SetStateAction } from 'react';
import { useRef } from 'react';
import { confirmDialog } from '@/components/ui/AppDialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { accountingApi } from '@/lib/accountingApi';
import { NEW_ROW_REF_ID, violatedLock, isAtOrBeforeBoundary } from '@/features/ledger/utils/reconciliation';
import { normalizeDecimalInput, formatAmountInput } from '@/shared/utils/decimal';
import { formatRateValue } from '@/shared/utils/format';
import { formatDateValue } from '@/shared/utils/date';
import { resolveCreatedAt, nextCreatedAtForDate } from '@/shared/utils/createdAt';
import {
 normalizeImportHeader,
 toImportString,
 buildImportColumnOptions,
 parseTransactionRowsFromMappedSheet,
 DEFAULT_IMPORT_ROW_OVERRIDE,
} from '@/features/transactions/utils/import';
import { generateArchiveHtml, generateTransactionsExportHtml } from '@/features/pdf/pdfExport';
import { saveArchiveTableSettings, saveTransactionTableSettings, getStoredExchangeSettings } from '@/shared/lib/localStorage';
import { useWorkspaceActions } from '@/features/workspace/hooks/useWorkspaceActions';
import { useTransactionsStore, type ArchiveExportModalState } from '@/features/transactions/store/transactionsStore';
import { selectArchiveExportRows } from '@/features/transactions/utils/archiveExport';
import { emptyTransactionForm } from '@/features/transactions/forms';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { useAppStatusStore } from '@/shared/store/appStatusStore';
import { useReconciliationLocks } from '@/features/ledger/hooks/useReconciliationLocks';
import { useTransactionPatchers } from '@/features/transactions/hooks/useTransactionPatchers';
import type { DraftHistory } from '@/shared/hooks/useDraftHistory';
import type {
 Client,
 ClientAccount,
 ClientAdjustment,
 Currency,
 ImportClientReview,
 ImportRowOverride,
 Organization,
 Reconciliation,
 Section,
 Transaction,
 TransactionTableDraft,
 TransactionTableRow,
 TransactionTableSettings,
 TransactionUpdateInput,
} from '@/shared/types';

type UseTransactionActionsParams = {
 clients: Client[];
 clientAccounts: ClientAccount[];
 transactions: Transaction[];
 adjustments: ClientAdjustment[];
 currencies: Currency[];
 enabledCurrencies: Currency[];
 organizations: Organization[];
 reconciliations: Reconciliation[];
 currencyMap: Map<number, Currency>;
 clientAccountMap: Map<number, ClientAccount & { clientName?: string }>;
 displayedTransactionRows: TransactionTableRow[];
 paginatedTransactions: TransactionTableRow[];
 transactionTableRowMap: Map<number, TransactionTableRow>;
 transactionTableRows: TransactionTableRow[];
 setImportSummary: Dispatch<SetStateAction<string>>;
 section: Section;
 numLocale: string;
 isRTL: boolean;
 isAdjustmentTransaction: boolean;
 showExchangeRateFrom: boolean;
 showExchangeRateTo: boolean;
 transactionAccountFromCurrencyCode: string | undefined;
 transactionAccountToCurrencyCode: string | undefined;
 transactionsImportInputRef: RefObject<HTMLInputElement | null>;
 txTableHistory: DraftHistory;
 onDeleteAdjustment: (id: number, opts?: { offerUndo?: boolean }) => Promise<void>;
 pushSharedSettingsIfOwner: () => void;
 pushUserTableSettings: () => void;
};

/**
 * Every transaction/archive handler: the new-transaction form submit, the
 * whole spreadsheet import wizard (file parse → client review → confirm),
 * inline table row edit/save/cancel (single + "edit all"), copy/paste, drag
 * reorder, delete (+ undo), and PDF/Excel export — plus the transaction-table
 * draft builder helpers and the table-settings/export modal open/close/save
 * cluster they share. Reconciliation-lock guards and the optimistic
 * transaction/adjustment patchers come from useReconciliationLocks/
 * useTransactionPatchers (shared with the ledger handlers).
 */
export function useTransactionActions({
 clients,
 clientAccounts,
 transactions,
 adjustments,
 currencies,
 enabledCurrencies,
 organizations,
 reconciliations,
 currencyMap,
 clientAccountMap,
 displayedTransactionRows,
 paginatedTransactions,
 transactionTableRowMap,
 transactionTableRows,
 setImportSummary,
 section,
 numLocale,
 isRTL,
 isAdjustmentTransaction,
 showExchangeRateFrom,
 showExchangeRateTo,
 transactionAccountFromCurrencyCode,
 transactionAccountToCurrencyCode,
 transactionsImportInputRef,
 txTableHistory,
 onDeleteAdjustment,
 pushSharedSettingsIfOwner,
 pushUserTableSettings,
}: UseTransactionActionsParams) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const { invalidate: loadData, setters, setError } = useWorkspaceActions();
 const showToast = useAppStatusStore((s) => s.showToast);
 const showUndo = useAppStatusStore((s) => s.showUndo);
 const setTransactions = setters.setTransactions;
 const setAdjustments = setters.setAdjustments;
 const pdfSettings = useSettingsStore((s) => s.pdfSettings);

 const { lockBoundaries, formatLockBalance, confirmIfLocked, confirmDeleteWithLock, confirmIfEditLocked, confirmIfTransactionEditLocked } = useReconciliationLocks({
  reconciliations,
  clientAccountMap,
 });
 const { applyTransactionPatch, applyAdjustmentPatch } = useTransactionPatchers({ clientAccountMap, currencyMap });

 const transactionSubmitLock = useRef(false);

 const transactionForm = useTransactionsStore((s) => s.transactionForm);
 const setTransactionForm = useTransactionsStore((s) => s.setTransactionForm);
 const setIsSubmittingTransaction = useTransactionsStore((s) => s.setIsSubmittingTransaction);
 const txSplitDescription = useTransactionsStore((s) => s.txSplitDescription);
 const setTxSplitDescription = useTransactionsStore((s) => s.setTxSplitDescription);
 const setNewTransactionDate = useTransactionsStore((s) => s.setNewTransactionDate);
 const newTransactionDate = useTransactionsStore((s) => s.newTransactionDate);
 const setTxFromQuery = useTransactionsStore((s) => s.setTxFromQuery);
 const setTxFromOpen = useTransactionsStore((s) => s.setTxFromOpen);
 const setTxToQuery = useTransactionsStore((s) => s.setTxToQuery);
 const setTxToOpen = useTransactionsStore((s) => s.setTxToOpen);
 const setIsNewTransactionExpensesOpen = useTransactionsStore((s) => s.setIsNewTransactionExpensesOpen);
 const txFromRateReversed = useTransactionsStore((s) => s.txFromRateReversed);
 const setTxFromRateReversed = useTransactionsStore((s) => s.setTxFromRateReversed);
 const txToRateReversed = useTransactionsStore((s) => s.txToRateReversed);
 const setTxToRateReversed = useTransactionsStore((s) => s.setTxToRateReversed);

 const pendingImportData = useTransactionsStore((s) => s.pendingImportData);
 const setPendingImportData = useTransactionsStore((s) => s.setPendingImportData);
 const importMapping = useTransactionsStore((s) => s.importMapping);
 const setImportMapping = useTransactionsStore((s) => s.setImportMapping);
 const importReview = useTransactionsStore((s) => s.importReview);
 const setImportReview = useTransactionsStore((s) => s.setImportReview);
 const setImportParsedRows = useTransactionsStore((s) => s.setImportParsedRows);
 const importRowOverrides = useTransactionsStore((s) => s.importRowOverrides);
 const setImportRowOverrides = useTransactionsStore((s) => s.setImportRowOverrides);
 const setIsImportingTransactions = useTransactionsStore((s) => s.setIsImportingTransactions);

 const transactionTableDrafts = useTransactionsStore((s) => s.transactionTableDrafts);
 const setTransactionTableDrafts = useTransactionsStore((s) => s.setTransactionTableDrafts);
 const setSelectedTransactionIds = useTransactionsStore((s) => s.setSelectedTransactionIds);
 const selectedTransactionIds = useTransactionsStore((s) => s.selectedTransactionIds);
 const setCommissionExpandedTxns = useTransactionsStore((s) => s.setCommissionExpandedTxns);
 const setExpensesExpandedTxns = useTransactionsStore((s) => s.setExpensesExpandedTxns);
 const setTransactionsPage = useTransactionsStore((s) => s.setTransactionsPage);
 const setTableRateFromReversed = useTransactionsStore((s) => s.setTableRateFromReversed);
 const tableRateFromReversed = useTransactionsStore((s) => s.tableRateFromReversed);
 const setTableRateToReversed = useTransactionsStore((s) => s.setTableRateToReversed);
 const tableRateToReversed = useTransactionsStore((s) => s.tableRateToReversed);
 const setIsTransactionsEditMode = useTransactionsStore((s) => s.setIsTransactionsEditMode);
 const editingRowIds = useTransactionsStore((s) => s.editingRowIds);
 const setEditingRowIds = useTransactionsStore((s) => s.setEditingRowIds);
 const setIsEditAllTransactions = useTransactionsStore((s) => s.setIsEditAllTransactions);
 const copiedTransaction = useTransactionsStore((s) => s.copiedTransaction);
 const setCopiedTransaction = useTransactionsStore((s) => s.setCopiedTransaction);
 const editingTransaction = useTransactionsStore((s) => s.editingTransaction);
 const setEditingTransaction = useTransactionsStore((s) => s.setEditingTransaction);
 const setIsNewTransactionSectionOpen = useTransactionsStore((s) => s.setIsNewTransactionSectionOpen);
 const setIsNewArchiveSectionOpen = useTransactionsStore((s) => s.setIsNewArchiveSectionOpen);
 const manualRowOrder = useTransactionsStore((s) => s.manualRowOrder);
 const setManualRowOrder = useTransactionsStore((s) => s.setManualRowOrder);
 const isExportingTransactions = useTransactionsStore((s) => s.isExportingTransactions);
 const setIsExportingTransactions = useTransactionsStore((s) => s.setIsExportingTransactions);
 const transactionExportFrom = useTransactionsStore((s) => s.transactionExportFrom);
 const setTransactionExportFrom = useTransactionsStore((s) => s.setTransactionExportFrom);
 const transactionExportTo = useTransactionsStore((s) => s.transactionExportTo);
 const setTransactionExportTo = useTransactionsStore((s) => s.setTransactionExportTo);
 const setShowTransactionExportModal = useTransactionsStore((s) => s.setShowTransactionExportModal);
 const setArchiveExportModal = useTransactionsStore((s) => s.setArchiveExportModal);
 const setShowTransactionTableSettingsModal = useTransactionsStore((s) => s.setShowTransactionTableSettingsModal);

 const transactionTableSettingsStore = useTransactionsStore((s) => s.transactionTableSettings);
 const setTransactionTableSettingsStore = useTransactionsStore((s) => s.setTransactionTableSettings);
 const transactionTableSettingsDraftStore = useTransactionsStore((s) => s.transactionTableSettingsDraft);
 const setTransactionTableSettingsDraftStore = useTransactionsStore((s) => s.setTransactionTableSettingsDraft);
 const archiveTableSettings = useTransactionsStore((s) => s.archiveTableSettings);
 const setArchiveTableSettings = useTransactionsStore((s) => s.setArchiveTableSettings);
 const archiveTableSettingsDraft = useTransactionsStore((s) => s.archiveTableSettingsDraft);
 const setArchiveTableSettingsDraft = useTransactionsStore((s) => s.setArchiveTableSettingsDraft);
 const transactionTableSettings = section === 'archive' ? archiveTableSettings : transactionTableSettingsStore;
 const setTransactionTableSettings = section === 'archive' ? setArchiveTableSettings : setTransactionTableSettingsStore;
 const transactionTableSettingsDraft = section === 'archive' ? archiveTableSettingsDraft : transactionTableSettingsDraftStore;
 const setTransactionTableSettingsDraft = section === 'archive' ? setArchiveTableSettingsDraft : setTransactionTableSettingsDraftStore;

function buildTransactionTableDraft(transaction: TransactionTableRow): TransactionTableDraft {
 const isAdjustment = !!transaction.isAdjustment;
 const fromReversed = !!transaction.exchangeRateFromReversed;
 const toReversed = !!transaction.exchangeRateToReversed;
 return {
  transactionId: transaction.id,
  adjustmentId: transaction.adjustmentId,
  isAdjustment,
  accountFromId: transaction.accountFromId,
  accountToId: isAdjustment ? null : transaction.accountToId,
  currencyId: transaction.currencyId,
  type: transaction.type,
  adjustmentDirection: transaction.adjustmentDirection,
  amount: String(transaction.amount),
  exchangeRateFrom: fromReversed ? formatRateValue(1 / transaction.exchangeRateFrom) : formatRateValue(transaction.exchangeRateFrom),
  commissionFrom: formatRateValue(transaction.commissionFrom),
  exchangeRateTo: isAdjustment ? '1.00' : toReversed ? formatRateValue(1 / transaction.exchangeRateTo) : formatRateValue(transaction.exchangeRateTo),
  commissionTo: formatRateValue(transaction.commissionTo),
  charges: String(transaction.charges),
  chargesCurrencyId: isAdjustment ? null : transaction.chargesCurrencyId,
  chargesPayer: isAdjustment ? '' : transaction.chargesPayer,
  chargesExchangeRate: isAdjustment ? '1.00' : formatRateValue(transaction.chargesExchangeRate),
  chargesDescription: transaction.chargesDescription,
  description: transaction.description,
  archiveNote: transaction.archiveNote,
  createdDate: transaction.createdAt.slice(0, 10),
 };
}

function beginTransactionsEditMode() {
 const fromReversed: Record<number, boolean> = {};
 const toReversed: Record<number, boolean> = {};
 transactionTableRows.forEach((transaction) => {
  if (transaction.exchangeRateFromReversed) {
   fromReversed[transaction.id] = true;
  }
  if (!transaction.isAdjustment && transaction.exchangeRateToReversed) {
   toReversed[transaction.id] = true;
  }
 });

 setTransactionTableDrafts({});
 setSelectedTransactionIds(new Set());
 setCommissionExpandedTxns(new Set());
 setExpensesExpandedTxns(new Set());
 setTableRateFromReversed(fromReversed);
 setTableRateToReversed(toReversed);
 setIsTransactionsEditMode(true);
}

function cancelTransactionsEditMode() {
 setTransactionTableDrafts({});
 setSelectedTransactionIds(new Set());
 setCommissionExpandedTxns(new Set());
 setExpensesExpandedTxns(new Set());
 setTableRateFromReversed({});
 setTableRateToReversed({});
 setIsTransactionsEditMode(false);
}

function updateTransactionTableDraft(transactionId: number, nextValues: Partial<TransactionTableDraft>) {
 txTableHistory.record();
 setTransactionTableDrafts((current) => {
  const existingDraft =
   current[transactionId] ??
   (() => {
    const transaction = transactionTableRowMap.get(transactionId);
    return transaction ? buildTransactionTableDraft(transaction) : null;
   })();

  if (!existingDraft) {
   return current;
  }

  const merged = { ...existingDraft, ...nextValues };
  // When a side's account or the transaction currency changes, re-derive whether that side
  // is same- or cross-currency and reset its exchange rate the way the "new transaction"
  // form's effect does (page.tsx): a same-currency side is forced to 1.00; a side that turns
  // cross-currency while still holding the default 1.00 is cleared, so the row stays pending
  // (a dash, excluded from the balance) until a real rate is entered. Without this, adding the
  // missing counterparty to a one-sided transaction leaves the stale 1.00 in place and it gets
  // saved as a 1:1 conversion across a currency mismatch.
  if ('accountFromId' in nextValues || 'accountToId' in nextValues || 'currencyId' in nextValues) {
   const resetSideRate = (accountId: number | null, currentRate: string) => {
    const account = accountId != null ? clientAccountMap.get(accountId) : undefined;
    if (!account || merged.currencyId == null) return currentRate;
    if (account.currencyId === merged.currencyId) return '1.00';
    return currentRate === '1.00' ? '' : currentRate;
   };
   merged.exchangeRateFrom = resetSideRate(merged.accountFromId, merged.exchangeRateFrom);
   merged.exchangeRateTo = resetSideRate(merged.accountToId, merged.exchangeRateTo);
  }
  // If the charge's currency or payer changed such that the charge now matches the
  // payer's own account currency, the stored chargesExchangeRate is stale (it was
  // converting into a currency this charge no longer needs converting into) — reset it
  // to 1, mirroring the equivalent effect on the "new transaction" form. Otherwise this
  // rate silently keeps multiplying the charge even though it no longer applies (see
  // effectiveChargeRate in accountBalances.ts/ledgerBalances.ts for the calculation-side guard).
  if (merged.chargesCurrencyId != null && (merged.chargesPayer === 'from' || merged.chargesPayer === 'to')) {
   const payerAccountId = merged.chargesPayer === 'from' ? merged.accountFromId : merged.accountToId;
   const payerAccount = payerAccountId != null ? clientAccountMap.get(payerAccountId) : undefined;
   if (payerAccount && payerAccount.currencyId === merged.chargesCurrencyId) {
    merged.chargesExchangeRate = '1.00';
   }
  }

  return {
   ...current,
   [transactionId]: merged,
  };
 });
}

function getTransactionTableDraft(transactionId: number) {
 const existingDraft = transactionTableDrafts[transactionId];
 if (existingDraft) {
  return existingDraft;
 }

 const transaction = transactionTableRowMap.get(transactionId);
 return transaction ? buildTransactionTableDraft(transaction) : null;
}

function onCancelTransactionTableRow(transactionId: number) {
 const transaction = transactionTableRowMap.get(transactionId);
 if (!transaction) {
  return;
 }

 setTransactionTableDrafts((current) => ({
  ...current,
  [transactionId]: buildTransactionTableDraft(transaction),
 }));
}

async function onDeleteAllTransactions() {
 if (!accountingApi) {
  setError(t('error_bridge'));
  return;
 }

 if (!transactions.length) {
  setError(t('no_transactions'));
  return;
 }

 const firstConfirm = await confirmDialog({
  title: t('danger_action_cannot_undo'),
  message: t('danger_delete_all_transactions_confirm'),
  confirmText: t('delete'),
  tone: 'danger',
 });
 if (!firstConfirm) {
  return;
 }

 try {
  await accountingApi.deleteAllTransactions();
  setSelectedTransactionIds(new Set());
  setTransactionTableDrafts({});
  setCommissionExpandedTxns(new Set());
  setExpensesExpandedTxns(new Set());
  setTransactionsPage(99999);
  setError('');
  await loadData();
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_delete'));
 }
}

async function onTransactionSubmit(event: FormEvent<HTMLFormElement>) {
 event.preventDefault();
 // Guard against a rapid double-submit creating a duplicate (button disabled may not have
 // re-rendered yet). Reset in the finally of whichever create branch runs below.
 if (transactionSubmitLock.current) return;
 if (!accountingApi) {
  setError(t('error_bridge'));
  return;
 }

 const amount = parseFloat(normalizeDecimalInput(transactionForm.amount));
 const isArchiveCreate = section === 'archive';
 // When editing an existing row, the same submit updates it in place. Kept updates keep
 // the original timestamp (order) unless the user changed the date field.
 const editing = editingTransaction;
 // A new entry lands at the end of its date's sequence (top of the table / bottom of the
 // ledger), after any same-day rows the user manually reordered.
 const newTransactionCreatedAt = editing ? resolveCreatedAt(newTransactionDate, editing.createdAt) : nextCreatedAtForDate(newTransactionDate, transactions, adjustments);

 if (isAdjustmentTransaction && !isArchiveCreate) {
  if (!transactionForm.accountFromId || !transactionForm.currencyId || !amount) {
   setError(t('adjustment_required'));
   return;
  }

  const selectedCurrency = currencyMap.get(transactionForm.currencyId);
  const account = clientAccountMap.get(transactionForm.accountFromId);

  // Cross-currency adjustment with no rate entered → 0 (pending sentinel, excluded from
  // balance until the user sets a rate). Same-currency stays 1.
  const adjCrossCurrency = !!(selectedCurrency && account && selectedCurrency.code !== account.currencyCode);
  const adjRawRate = parseFloat(transactionForm.exchangeRateFrom);
  const adjRateSet = Number.isFinite(adjRawRate) && adjRawRate > 0;
  const adjExchangeRate = adjCrossCurrency ? (adjRateSet ? (txFromRateReversed ? 1 / adjRawRate : adjRawRate) : 0) : 1;

  const adjPayload = {
   accountId: transactionForm.accountFromId,
   amount,
   direction: transactionForm.adjustmentDirection,
   currencyId: transactionForm.currencyId,
   currencyCode: selectedCurrency?.code || account?.currencyCode || '',
   currencySymbol: selectedCurrency?.symbol || account?.currencySymbol || '',
   exchangeRate: adjExchangeRate,
   exchangeRateReversed: txFromRateReversed && adjRateSet,
   description: transactionForm.description,
   createdAt: newTransactionCreatedAt,
  };

  // Editing an existing adjustment via the form → update in place instead of creating.
  if (editing && editing.isAdjustment) {
   const original = adjustments.find((a) => a.id === editing.id);
   const updatedAdj = { ...adjPayload, id: editing.id } as ClientAdjustment;
   if (original && !(await confirmIfEditLocked([original.accountId], original.createdAt, [updatedAdj.accountId], updatedAdj.createdAt, updatedAdj.id))) {
    return;
   }
   transactionSubmitLock.current = true;
   setIsSubmittingTransaction(true);
   try {
    await accountingApi.updateClientAdjustment(updatedAdj);
    applyAdjustmentPatch(updatedAdj);
    onCancelEditTransaction();
    showToast(t('toast_transaction_updated'));
    void loadData();
   } catch (e) {
    setError(e instanceof Error ? e.message : t('error_failed_update'));
   } finally {
    transactionSubmitLock.current = false;
    setIsSubmittingTransaction(false);
   }
   return;
  }

  // Reconciliation guard: a new expense dated at or before the lock line rewrites history.
  if (!(await confirmIfLocked([adjPayload.accountId], adjPayload.createdAt, NEW_ROW_REF_ID))) {
   return;
  }

  transactionSubmitLock.current = true;
  setIsSubmittingTransaction(true);
  try {
   const created = await accountingApi.createClientAdjustment(adjPayload);

   // Optimistically add the new adjustment (the API returns its real id), then reconcile.
   setAdjustments((prev) => [
    ...prev,
    {
     id: created.id,
     accountId: adjPayload.accountId,
     amount: adjPayload.amount,
     direction: adjPayload.direction,
     currencyId: adjPayload.currencyId,
     currencyCode: adjPayload.currencyCode,
     currencySymbol: adjPayload.currencySymbol,
     exchangeRate: adjPayload.exchangeRate,
     exchangeRateReversed: adjPayload.exchangeRateReversed,
     description: adjPayload.description,
     createdAt: adjPayload.createdAt,
    },
   ]);

   setTxSplitDescription(false);
   setTransactionForm(emptyTransactionForm());
   setTxFromQuery('');
   setTxFromOpen(false);
   setTxToQuery('');
   setTxToOpen(false);
   setTxFromRateReversed(false);
   setTxToRateReversed(false);
   // Keep the form open so several entries can be added in a row.
   setIsNewTransactionExpensesOpen(false);
   setNewTransactionDate(new Date().toISOString().slice(0, 10));
   setError('');
   void loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_save'));
  } finally {
   transactionSubmitLock.current = false;
   setIsSubmittingTransaction(false);
  }

  return;
 }

 if (!transactionForm.currencyId || (!isArchiveCreate && !transactionForm.accountFromId && !transactionForm.accountToId)) {
  setError(t(isArchiveCreate ? 'archive_create_required' : 'transaction_party_required'));
  return;
 }

 // Effective destination rate, mirroring the exchangeRateTo IIFE in txPayload below. Used to
 // derive the computed destination amount for the exchange "actual amount" tolerance check.
 const effectiveExchangeRateTo = (() => {
  if (!showExchangeRateTo || !transactionAccountToCurrencyCode) return 1;
  const raw = parseFloat(transactionForm.exchangeRateTo);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return txToRateReversed ? 1 / raw : raw;
 })();

 // Exchange (صرف) only: the "actual" (الفعلي) real settled destination amount. Stored only when
 // the user entered one, there is a destination account, and this is an exchange transaction.
 const exchangeActualRaw = transactionForm.exchangeActualAmount.trim();
 const exchangeActualNum = parseFloat(normalizeDecimalInput(exchangeActualRaw));
 const exchangeActualAmountValue =
  transactionForm.type === 'exchange' && !isArchiveCreate && transactionForm.accountToId != null && exchangeActualRaw !== '' && Number.isFinite(exchangeActualNum)
   ? exchangeActualNum
   : null;

 // Block submit when the actual deviates from the computed amount × rate by more than the
 // workspace's configured tolerance (skipped when there is no priced computed value to compare).
 if (exchangeActualAmountValue != null && effectiveExchangeRateTo > 0) {
  const computedDestination = amount * effectiveExchangeRateTo;
  const { tolerance } = getStoredExchangeSettings();
  if (Math.abs(computedDestination - exchangeActualAmountValue) > tolerance) {
   setError(t('exchange_actual_out_of_tolerance', { max: String(tolerance) }));
   return;
  }
 }

 const txPayload = {
  accountFromId: transactionForm.accountFromId,
  accountToId: transactionForm.accountToId,
  currencyId: transactionForm.currencyId,
  amount: amount || 0,
  type: transactionForm.type,
  isArchived: isArchiveCreate,
  // Cross-currency sides with no rate entered are stored as 0 (unset → pending). Same-currency
  // sides are always 1. An entered rate (including 1) is stored as given.
  exchangeRateFrom: (() => {
   if (!showExchangeRateFrom || !transactionAccountFromCurrencyCode) return 1;
   const raw = parseFloat(transactionForm.exchangeRateFrom);
   if (!Number.isFinite(raw) || raw <= 0) return 0;
   return txFromRateReversed ? 1 / raw : raw;
  })(),
  commissionFrom: parseFloat(transactionForm.commissionFrom) || 0,
  exchangeRateTo: (() => {
   if (!showExchangeRateTo || !transactionAccountToCurrencyCode) return 1;
   const raw = parseFloat(transactionForm.exchangeRateTo);
   if (!Number.isFinite(raw) || raw <= 0) return 0;
   return txToRateReversed ? 1 / raw : raw;
  })(),
  commissionTo: parseFloat(transactionForm.commissionTo) || 0,
  exchangeRateFromReversed: txFromRateReversed && (parseFloat(transactionForm.exchangeRateFrom) || 0) > 0 ? 1 : 0,
  exchangeRateToReversed: txToRateReversed && (parseFloat(transactionForm.exchangeRateTo) || 0) > 0 ? 1 : 0,
  charges: parseFloat(transactionForm.charges) || 0,
  chargesCurrencyId: transactionForm.chargesCurrencyId || null,
  chargesPayer: transactionForm.chargesPayer,
  chargesExchangeRate: parseFloat(transactionForm.chargesExchangeRate) || 1,
  chargesDescription: transactionForm.chargesDescription,
  description: transactionForm.description,
  descriptionFrom: txSplitDescription ? transactionForm.descriptionFrom : '',
  descriptionTo: txSplitDescription ? transactionForm.descriptionTo : '',
  exchangeActualAmount: exchangeActualAmountValue,
  createdAt: newTransactionCreatedAt,
 };

 // Editing an existing transaction via the form → update in place instead of creating.
 if (editing && !editing.isAdjustment) {
  const original = transactions.find((tx) => tx.id === editing.id);
  const updatePayload: TransactionUpdateInput = {
   id: editing.id,
   accountFromId: txPayload.accountFromId,
   accountToId: txPayload.accountToId,
   currencyId: txPayload.currencyId,
   amount: txPayload.amount,
   type: txPayload.type,
   exchangeRateFrom: txPayload.exchangeRateFrom,
   commissionFrom: txPayload.commissionFrom,
   exchangeRateTo: txPayload.exchangeRateTo,
   commissionTo: txPayload.commissionTo,
   exchangeRateFromReversed: txPayload.exchangeRateFromReversed,
   exchangeRateToReversed: txPayload.exchangeRateToReversed,
   charges: txPayload.charges,
   chargesCurrencyId: txPayload.chargesCurrencyId,
   chargesPayer: txPayload.chargesPayer,
   chargesExchangeRate: txPayload.chargesExchangeRate,
   chargesDescription: txPayload.chargesDescription,
   description: txPayload.description,
   descriptionFrom: txPayload.descriptionFrom,
   descriptionTo: txPayload.descriptionTo,
   exchangeActualAmount: txPayload.exchangeActualAmount,
   archiveNote: original?.archiveNote,
   createdAt: txPayload.createdAt,
  };
  if (original && !(await confirmIfTransactionEditLocked(original, updatePayload))) {
   return;
  }
  transactionSubmitLock.current = true;
  setIsSubmittingTransaction(true);
  try {
   await accountingApi.updateTransaction(updatePayload);
   applyTransactionPatch(updatePayload);
   onCancelEditTransaction();
   showToast(t('toast_transaction_updated'));
   void loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_update'));
  } finally {
   transactionSubmitLock.current = false;
   setIsSubmittingTransaction(false);
  }
  return;
 }

 // Reconciliation guard: a new row dated at or before a lock line rewrites reconciled
 // history. Archive-only records never touch any ledger, so they are exempt.
 if (!isArchiveCreate && !(await confirmIfLocked([txPayload.accountFromId, txPayload.accountToId], txPayload.createdAt, NEW_ROW_REF_ID))) {
  return;
 }

 transactionSubmitLock.current = true;
 setIsSubmittingTransaction(true);
 try {
  await accountingApi.createTransaction(txPayload);

  // Optimistically add the new row so the table updates instantly; a background reload
  // reconciles it with the server (real id + any server-side normalization).
  const fromAcc = txPayload.accountFromId != null ? clientAccountMap.get(txPayload.accountFromId) : undefined;
  const toAcc = txPayload.accountToId != null ? clientAccountMap.get(txPayload.accountToId) : undefined;
  const cur = txPayload.currencyId != null ? currencyMap.get(txPayload.currencyId) : undefined;
  const chargesCur = txPayload.chargesCurrencyId != null ? currencyMap.get(txPayload.chargesCurrencyId) : null;
  setTransactions((prev) => [
   ...prev,
   {
    id: -Date.now(),
    accountFromId: txPayload.accountFromId,
    clientFromName: fromAcc?.clientName ?? '',
    accountFromCurrencyCode: fromAcc?.currencyCode ?? '',
    accountFromCurrencySymbol: fromAcc?.currencySymbol ?? '',
    accountToId: txPayload.accountToId,
    clientToName: toAcc?.clientName ?? '',
    accountToCurrencyCode: toAcc?.currencyCode ?? '',
    accountToCurrencySymbol: toAcc?.currencySymbol ?? '',
    currencyId: txPayload.currencyId ?? 0,
    currencyCode: cur?.code ?? '',
    currencySymbol: cur?.symbol ?? '',
    amount: txPayload.amount,
    type: txPayload.type,
    exchangeRateFrom: txPayload.exchangeRateFrom,
    commissionFrom: txPayload.commissionFrom,
    exchangeRateTo: txPayload.exchangeRateTo,
    commissionTo: txPayload.commissionTo,
    exchangeRateFromReversed: txPayload.exchangeRateFromReversed,
    exchangeRateToReversed: txPayload.exchangeRateToReversed,
    charges: txPayload.charges,
    chargesCurrencyId: txPayload.chargesCurrencyId,
    chargesCurrencyCode: chargesCur?.code ?? null,
    chargesCurrencySymbol: chargesCur?.symbol ?? null,
    chargesPayer: txPayload.chargesPayer,
    chargesExchangeRate: txPayload.chargesExchangeRate,
    chargesDescription: txPayload.chargesDescription,
    description: txPayload.description,
    descriptionFrom: txPayload.descriptionFrom,
    descriptionTo: txPayload.descriptionTo,
    exchangeActualAmount: txPayload.exchangeActualAmount,
    archiveNote: '',
    isArchived: txPayload.isArchived ? 1 : 0,
    createdAt: txPayload.createdAt,
   },
  ]);

  setTxSplitDescription(false);
  setTransactionForm(emptyTransactionForm());
  setTxFromQuery('');
  setTxFromOpen(false);
  setTxToQuery('');
  setTxToOpen(false);
  setTxFromRateReversed(false);
  setTxToRateReversed(false);
  // Keep the form open so several entries can be added in a row.
  setIsNewTransactionExpensesOpen(false);
  setNewTransactionDate(new Date().toISOString().slice(0, 10));
  setError('');
  showToast(t(txPayload.isArchived ? 'toast_archive_transaction_created' : 'toast_transaction_created'));
  void loadData();
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_save'));
 } finally {
  transactionSubmitLock.current = false;
  setIsSubmittingTransaction(false);
 }
}

async function onImportTransactionsFile(event: ChangeEvent<HTMLInputElement>) {
 const file = event.target.files?.[0];
 if (!file) {
  return;
 }

 if (!accountingApi) {
  setError(t('error_bridge'));
  return;
 }

 setError('');
 setImportSummary('');

 try {
  const xlsxModule = await import('xlsx');
  const fileBuffer = await file.arrayBuffer();
  const workbook = xlsxModule.read(fileBuffer, { type: 'array', cellDates: true });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
   throw new Error('The selected file has no sheets.');
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rawRows = xlsxModule.utils.sheet_to_json(sheet, {
   header: 1,
   raw: true,
   defval: '',
  }) as unknown[][];

  const rows = rawRows;
  const columnOptions = buildImportColumnOptions(rows);
  if (!columnOptions.length) {
   throw new Error('The selected sheet has no columns.');
  }

  const headerAliases = {
   from: ['عليه', 'from', 'accountfrom', 'sender', 'debtor'],
   to: ['له', 'to', 'accountto', 'receiver', 'creditor'],
   amount: ['القيمة', 'المبلغ', 'amount', 'value'],
   date: ['التاريخ', 'date', 'createdat'],
   description: ['الوصف', 'البيان', 'ملاحظة', 'description', 'note', 'details'],
   moreInfo: ['معلومات', 'مزيدمنالمعلومات', 'تفاصيل', 'moreinfo', 'info', 'extra', 'reference', 'ref'],
  };

  const detectColumnByAliases = (aliases: string[]) => {
   const normalizedAliasSet = new Set(aliases.map((alias) => normalizeImportHeader(alias)));
   for (let rowIndex = 0; rowIndex < Math.min(rows.length, 10); rowIndex += 1) {
    const row = rows[rowIndex];
    for (let cellIndex = 0; cellIndex < row.length; cellIndex += 1) {
     const cell = normalizeImportHeader(toImportString(row[cellIndex]));
     if (normalizedAliasSet.has(cell)) {
      return cellIndex;
     }
    }
   }
   return null;
  };

  const preferredCurrency = enabledCurrencies[0] ?? currencies[0] ?? null;

  setPendingImportData({
   fileName: file.name,
   rows,
   columnOptions,
  });

  setImportMapping({
   dateColumn: detectColumnByAliases(headerAliases.date),
   fromColumn: detectColumnByAliases(headerAliases.from),
   toColumn: detectColumnByAliases(headerAliases.to),
   amountColumn: detectColumnByAliases(headerAliases.amount),
   descriptionColumn: detectColumnByAliases(headerAliases.description),
   // Archive-only "More info" note column; harmless (unused) for the normal import.
   moreInfoColumn: section === 'archive' ? detectColumnByAliases(headerAliases.moreInfo) : null,
   currencyId: preferredCurrency?.id ?? null,
  });

  // pendingImportData drives the independent import-setup modal (rendered at the
  // top level), so there's no need to expand the New Transaction side panel.
 } catch (e) {
  setError(e instanceof Error ? e.message : 'Failed to read import file.');
 } finally {
  if (transactionsImportInputRef.current) {
   transactionsImportInputRef.current.value = '';
  }
 }
}

function onPrepareImportReview() {
 if (!pendingImportData) {
  setError(t('import_err_no_file'));
  return;
 }

 // Archive imports may name only a sender or only a receiver per row, so a single
 // party column is enough; the normal transactions import still needs both.
 const isArchiveImport = section === 'archive';
 const mappingIncomplete = isArchiveImport
  ? importMapping.amountColumn == null || (importMapping.fromColumn == null && importMapping.toColumn == null)
  : importMapping.fromColumn == null || importMapping.toColumn == null || importMapping.amountColumn == null;
 if (mappingIncomplete) {
  setError(t(isArchiveImport ? 'import_err_mapping_archive' : 'import_err_mapping'));
  return;
 }

 // The import currency is optional. When chosen it drives every row's currency
 // (unchanged behaviour); when left blank, each row's currency is derived from
 // the account the user picks for the client in the review step.
 const selectedCurrency = importMapping.currencyId ? (currencies.find((currency) => currency.id === importMapping.currencyId) ?? null) : null;

 try {
  const importedRows = parseTransactionRowsFromMappedSheet(pendingImportData.rows, importMapping, selectedCurrency, { allowOneSided: isArchiveImport });
  const normalizeLookup = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
  const reviewMap = new Map<string, ImportClientReview>();

  const registerName = (rawName: string) => {
   const key = normalizeLookup(rawName);
   if (!key) return;
   let entry = reviewMap.get(key);
   if (!entry) {
    const existing = clients.find((client) => normalizeLookup(client.name) === key) ?? null;
    // For an auto-matched existing client, preselect the right account. With a
    // global import currency, only its matching account counts (so we never post
    // that currency onto a different-currency account). Without one, fall back to
    // the client's only account so a single-account client still posts.
    const existingAccounts = existing ? clientAccounts.filter((account) => account.clientId === existing.id) : [];
    const defaultAccount = selectedCurrency
     ? (existingAccounts.find((account) => account.currencyId === selectedCurrency.id) ?? null)
     : existingAccounts.length === 1
       ? existingAccounts[0]
       : null;
    entry = {
     key,
     originalName: rawName,
     isExpense: false,
     existingClientId: existing?.id ?? null,
     existingAccountId: defaultAccount?.id ?? null,
     pendingEntryKey: null,
     targetCurrencyId: null,
     name: rawName,
     organizationId: existing?.organizationId ?? organizations[0]?.id ?? null,
     accountCurrencyIds: [],
     currencyId: selectedCurrency?.id ?? null,
     transactionCount: 0,
    };
    reviewMap.set(key, entry);
   }
   entry.transactionCount += 1;
  };

  for (const row of importedRows) {
   registerName(row.fromName);
   registerName(row.toName);
  }

  if (!reviewMap.size) {
   throw new Error('No clients were found in the selected columns.');
  }

  setError('');
  setImportParsedRows(importedRows);
  setImportRowOverrides({});
  setImportReview(Array.from(reviewMap.values()));
 } catch (e) {
  setError(e instanceof Error ? e.message : 'Failed to read clients from the file.');
 }
}

function updateImportReviewEntry(key: string, patch: Partial<ImportClientReview>) {
 setImportReview((current) => {
  if (!current) return current;
  return current.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry));
 });
}

function updateImportRowOverride(index: number, patch: Partial<ImportRowOverride>) {
 setImportRowOverrides((current) => ({
  ...current,
  [index]: { ...(current[index] ?? DEFAULT_IMPORT_ROW_OVERRIDE), ...patch },
 }));
}

async function onConfirmImportTransactions() {
 if (!accountingApi) {
  setError(t('error_bridge'));
  return;
 }

 if (!pendingImportData) {
  setError(t('import_err_no_file'));
  return;
 }

 const isArchiveImport = section === 'archive';
 const mappingIncomplete = isArchiveImport
  ? importMapping.amountColumn == null || (importMapping.fromColumn == null && importMapping.toColumn == null)
  : importMapping.fromColumn == null || importMapping.toColumn == null || importMapping.amountColumn == null;
 if (mappingIncomplete) {
  setError(t(isArchiveImport ? 'import_err_mapping_archive' : 'import_err_mapping'));
  return;
 }

 const selectedCurrency = importMapping.currencyId ? (currencies.find((currency) => currency.id === importMapping.currencyId) ?? null) : null;

 if (!importReview || !importReview.length) {
  setError(t('import_err_review_first'));
  return;
 }

 // Only names that will create a brand-new client must be filled in.
 if (importReview.some((entry) => !entry.isExpense && entry.existingClientId == null && !entry.name.trim())) {
  setError(t('import_err_name_required'));
  return;
 }

 // Every new client needs at least one account to post transactions to.
 const missingAccount = importReview.find((entry) => !entry.isExpense && entry.existingClientId == null && entry.pendingEntryKey == null && entry.accountCurrencyIds.length === 0);
 if (missingAccount) {
  setError(t('import_err_account_required', { name: missingAccount.originalName }));
  return;
 }

 // New clients with 2+ accounts need a target account selected.
 const missingTarget = importReview.find(
  (entry) => !entry.isExpense && entry.existingClientId == null && entry.pendingEntryKey == null && entry.accountCurrencyIds.length >= 2 && entry.targetCurrencyId == null,
 );
 if (missingTarget) {
  setError(t('import_err_target_required', { name: missingTarget.originalName }));
  return;
 }

 // Pending-entry refs with 2+ accounts need a target chosen.
 const refAccountCount = (key: string) => importReview.find((e) => e.key === key)?.accountCurrencyIds.length ?? 0;
 const missingPendingTarget = importReview.find(
  (entry) => !entry.isExpense && entry.pendingEntryKey != null && entry.targetCurrencyId == null && refAccountCount(entry.pendingEntryKey!) >= 2,
 );
 if (missingPendingTarget) {
  setError(t('import_err_target_required', { name: missingPendingTarget.originalName }));
  return;
 }

 // Existing clients with 2+ accounts need a selected account.
 const missingExistingAccount = importReview.find(
  (entry) =>
   !entry.isExpense && entry.existingClientId != null && entry.existingAccountId == null && clientAccounts.filter((a) => a.clientId === entry.existingClientId).length >= 2,
 );
 if (missingExistingAccount) {
  setError(t('import_err_existing_account_required', { name: missingExistingAccount.originalName }));
  return;
 }

 const reviewList = importReview;

 setIsImportingTransactions(true);
 setError('');
 setImportSummary('');

 try {
  const importedRows = parseTransactionRowsFromMappedSheet(pendingImportData.rows, importMapping, selectedCurrency, { allowOneSided: isArchiveImport });

  const normalizeLookup = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
  const reviewByKey = new Map(reviewList.map((entry) => [entry.key, entry] as const));

  let nextClients = [...clients];
  let nextCurrencies = [...currencies];
  let nextClientAccounts = [...clientAccounts];

  const stats = {
   createdClients: 0,
   enabledCurrencies: 0,
   createdAccounts: 0,
   createdTransactions: 0,
   createdExpenses: 0,
   skippedRows: 0,
  };

  const getClientByName = (name: string) => {
   const needle = normalizeLookup(name);
   return nextClients.find((client) => normalizeLookup(client.name) === needle) ?? null;
  };

  const getClientAccount = (clientId: number, currencyId: number) => {
   return nextClientAccounts.find((account) => account.clientId === clientId && account.currencyId === currencyId) ?? null;
  };

  // Resolves the client id for a review entry: an explicitly mapped existing
  // client, the client created by a referenced pending entry, or the one
  // created/found by this entry's own name.
  const resolveClientId = (entry: ImportClientReview): number | null => {
   if (entry.existingClientId != null) return entry.existingClientId;
   if (entry.pendingEntryKey != null) {
    const ref = reviewByKey.get(entry.pendingEntryKey);
    return ref ? (getClientByName(ref.name.trim())?.id ?? null) : null;
   }
   return getClientByName(entry.name.trim())?.id ?? null;
  };

  // Optional: present only when the user picked a single currency for the whole
  // import. When null, each row's currency comes from the resolved account.
  let importCurrency = selectedCurrency ? (nextCurrencies.find((currency) => currency.id === selectedCurrency.id) ?? selectedCurrency) : null;

  const ensureCurrencyEnabled = async (currencyId: number) => {
   const currency = nextCurrencies.find((item) => item.id === currencyId);
   if (currency && currency.isEnabled !== 1) {
    await accountingApi.enableCurrency(currencyId);
    nextCurrencies = nextCurrencies.map((item) => (item.id === currencyId ? { ...item, isEnabled: 1 } : item));
    if (importCurrency && currencyId === importCurrency.id) importCurrency = { ...importCurrency, isEnabled: 1 };
    stats.enabledCurrencies += 1;
   }
  };

  if (importCurrency) await ensureCurrencyEnabled(importCurrency.id);

  // A row touching an expense-marked name that the user flipped to "transaction"
  // means that name must act as a real client for those rows.
  const expenseKeysNeedingClient = new Set<string>();
  importedRows.forEach((row, index) => {
   if ((importRowOverrides[index] ?? DEFAULT_IMPORT_ROW_OVERRIDE).mode !== 'transaction') return;
   const fromKey = normalizeLookup(row.fromName);
   const toKey = normalizeLookup(row.toName);
   if (reviewByKey.get(fromKey)?.isExpense) expenseKeysNeedingClient.add(fromKey);
   if (reviewByKey.get(toKey)?.isExpense) expenseKeysNeedingClient.add(toKey);
  });

  // Create reviewed new clients (existing-client mappings and pending-entry
  // references are reused). Expense markers are skipped unless a row flips them.
  for (const review of reviewList) {
   if (review.existingClientId != null) continue;
   if (review.pendingEntryKey != null) continue;
   if (review.isExpense && !expenseKeysNeedingClient.has(review.key)) continue;
   const finalName = review.name.trim();
   if (!finalName || getClientByName(finalName)) continue;
   const { clientId: newClientId } = (await accountingApi.createClient({
    organizationId: review.organizationId ?? null,
    name: finalName,
    email: '',
    phone: '',
    address: '',
   })) as { ok: true; clientId: number };
   nextClients = [
    ...nextClients,
    {
     id: newClientId,
     name: finalName,
     organizationId: review.organizationId ?? null,
     organizationName: null,
     email: '',
     phone: '',
     address: '',
     excludeFromBalance: false,
     accountCount: 0,
     createdAt: '',
     updatedAt: '',
    },
   ];
   stats.createdClients += 1;
  }

  // Open accounts only for new clients (the currencies the user picked).
  // Existing clients are never given new accounts automatically — their rows
  // post to the account chosen in the review step, or are skipped otherwise.
  // Pending-entry references piggyback on the referenced entry's accounts.
  for (const review of reviewList) {
   if (review.isExpense && !expenseKeysNeedingClient.has(review.key)) continue;
   if (review.pendingEntryKey != null) continue;
   if (review.existingClientId != null) continue;

   const clientId = resolveClientId(review);
   if (clientId == null) continue;
   for (const currencyId of Array.from(new Set(review.accountCurrencyIds))) {
    await ensureCurrencyEnabled(currencyId);
    if (getClientAccount(clientId, currencyId)) continue;
    await accountingApi.createClientAccount({ clientId, currencyId, startingBalance: 0 });
    stats.createdAccounts += 1;
   }
  }
  // One reload after all accounts are created so resolveAccount can find them.
  if (stats.createdAccounts > 0) {
   nextClientAccounts = (await accountingApi.listAllClientAccounts()) as ClientAccount[];
  }

  // Resolves the account a review entry's rows should post to.
  const resolveAccount = (entry: ImportClientReview) => {
   if (entry.existingClientId != null) {
    if (entry.existingAccountId != null) {
     return nextClientAccounts.find((account) => account.id === entry.existingAccountId) ?? null;
    }
    return importCurrency ? getClientAccount(entry.existingClientId, importCurrency.id) : null;
   }
   const clientId = resolveClientId(entry);
   if (clientId == null) return null;
   // Use the user-chosen target currency, or fall back to the import currency.
   const targetCurrencyId = entry.targetCurrencyId ?? importCurrency?.id ?? null;
   if (targetCurrencyId == null) return null;
   return getClientAccount(clientId, targetCurrencyId) ?? null;
  };

  // The currency a row posts in: the global import currency when chosen,
  // otherwise the currency of the account the row resolves to.
  const currencyForAccount = (account: ClientAccount) => importCurrency ?? nextCurrencies.find((currency) => currency.id === account.currencyId) ?? null;

  // Walk the rows, building two accumulator arrays instead of firing one HTTP
  // request per row. A single bulk call at the end inserts everything at once.
  const transactionsToCreate: object[] = [];
  const adjustmentsToCreate: object[] = [];

  for (let index = 0; index < importedRows.length; index += 1) {
   const row = importedRows[index];
   const fromEntry = reviewByKey.get(normalizeLookup(row.fromName)) ?? null;
   const toEntry = reviewByKey.get(normalizeLookup(row.toName)) ?? null;
   const fromIsExpense = !!fromEntry?.isExpense;
   const toIsExpense = !!toEntry?.isExpense;
   const involvesExpense = fromIsExpense || toIsExpense;
   const override = importRowOverrides[index] ?? DEFAULT_IMPORT_ROW_OVERRIDE;
   const asExpense = involvesExpense && override.mode !== 'transaction';

   if (asExpense) {
    if (fromIsExpense && toIsExpense) continue;
    const realEntry = fromIsExpense ? toEntry : fromEntry;
    const markerEntry = fromIsExpense ? fromEntry : toEntry;
    if (!realEntry) continue;
    const account = resolveAccount(realEntry);
    if (!account) {
     stats.skippedRows += 1;
     continue;
    }
    const adjustmentCurrency = currencyForAccount(account);
    if (!adjustmentCurrency) {
     stats.skippedRows += 1;
     continue;
    }
    adjustmentsToCreate.push({
     accountId: account.id,
     amount: row.amount,
     direction: override.direction,
     currencyId: adjustmentCurrency.id,
     currencyCode: adjustmentCurrency.code,
     currencySymbol: adjustmentCurrency.symbol,
     exchangeRate: 1,
     exchangeRateReversed: false,
     description: row.description || markerEntry?.originalName || '',
     createdAt: row.createdAt ?? null,
    });
    continue;
   }

   // Transfer between two parties. An archive import may name only one side, in which
   // case it posts a single-party archived entry (the missing side stays null); the
   // normal import still requires both a sender and a receiver.
   if (!fromEntry && !toEntry) continue;
   if (!isArchiveImport && (!fromEntry || !toEntry)) continue;

   if (!fromEntry || !toEntry) {
    // One-sided archive row: post to whichever party is present, on its natural side.
    const soleEntry = (fromEntry ?? toEntry) as ImportClientReview;
    const soleAccount = resolveAccount(soleEntry);
    if (!soleAccount) {
     stats.skippedRows += 1;
     continue;
    }
    const soleCurrency = importCurrency ?? currencyForAccount(soleAccount);
    if (!soleCurrency) {
     stats.skippedRows += 1;
     continue;
    }
    transactionsToCreate.push({
     accountFromId: fromEntry ? soleAccount.id : null,
     accountToId: fromEntry ? null : soleAccount.id,
     currencyId: soleCurrency.id,
     amount: row.amount,
     type: 'transfer',
     exchangeRateFrom: 1,
     commissionFrom: 0,
     exchangeRateTo: 1,
     commissionTo: 0,
     exchangeRateFromReversed: false,
     exchangeRateToReversed: false,
     charges: 0,
     chargesCurrencyId: null,
     chargesPayer: '',
     chargesExchangeRate: 1,
     chargesDescription: '',
     description: row.description,
     archiveNote: row.moreInfo,
     isArchived: true,
     createdAt: row.createdAt ?? null,
    });
    continue;
   }

   const sendEntry = override.swap ? toEntry : fromEntry;
   const receiveEntry = override.swap ? fromEntry : toEntry;
   const fromAccount = resolveAccount(sendEntry);
   const toAccount = resolveAccount(receiveEntry);
   if (!fromAccount || !toAccount) {
    stats.skippedRows += 1;
    continue;
   }
   // A transfer posts in a single currency. With a global import currency that
   // is it; without one, both sides must resolve to the same-currency account.
   const transferCurrency = importCurrency ?? (fromAccount.currencyId === toAccount.currencyId ? currencyForAccount(fromAccount) : null);
   if (!transferCurrency) {
    stats.skippedRows += 1;
    continue;
   }
   transactionsToCreate.push({
    accountFromId: fromAccount.id,
    accountToId: toAccount.id,
    currencyId: transferCurrency.id,
    amount: row.amount,
    type: 'transfer',
    exchangeRateFrom: 1,
    commissionFrom: 0,
    exchangeRateTo: 1,
    commissionTo: 0,
    exchangeRateFromReversed: false,
    exchangeRateToReversed: false,
    charges: 0,
    chargesCurrencyId: null,
    chargesPayer: '',
    chargesExchangeRate: 1,
    chargesDescription: '',
    description: row.description,
    archiveNote: isArchiveImport ? row.moreInfo : '',
    isArchived: isArchiveImport,
    createdAt: row.createdAt ?? null,
   });
  }

  if (transactionsToCreate.length > 0 || adjustmentsToCreate.length > 0) {
   const bulkResult = await accountingApi.bulkImportTransactions({
    transactions: transactionsToCreate,
    adjustments: adjustmentsToCreate,
   });
   stats.createdTransactions = bulkResult.createdTransactions;
   stats.createdExpenses = bulkResult.createdAdjustments;
  }

  if (!stats.createdTransactions && !stats.createdExpenses) {
   throw new Error('Nothing was imported. Check the mapping questions, selected currency, and expense markers.');
  }

  await loadData();
  setImportSummary(
   `Imported ${stats.createdTransactions} transactions${stats.createdExpenses ? ` and ${stats.createdExpenses} expenses` : ''} from ${pendingImportData.fileName}. Created ${stats.createdClients} clients and ${stats.createdAccounts} accounts.${
    stats.skippedRows ? ` Skipped ${stats.skippedRows} rows whose clients had no ${selectedCurrency ? `${selectedCurrency.code} ` : ''}account.` : ''
   }`,
  );
  setPendingImportData(null);
  setImportReview(null);
  setImportParsedRows([]);
  setImportRowOverrides({});
  setImportMapping({
   dateColumn: null,
   fromColumn: null,
   toColumn: null,
   amountColumn: null,
   descriptionColumn: null,
   moreInfoColumn: null,
   currencyId: null,
  });
 } catch (e) {
  setError(e instanceof Error ? e.message : 'Failed to import transactions.');
 } finally {
  setIsImportingTransactions(false);
 }
}

function onCancelImportTransactions() {
 setPendingImportData(null);
 setImportReview(null);
 setImportParsedRows([]);
 setImportRowOverrides({});
 setImportMapping({
  dateColumn: null,
  fromColumn: null,
  toColumn: null,
  amountColumn: null,
  descriptionColumn: null,
  moreInfoColumn: null,
  currencyId: null,
 });
}

async function onSaveAllTransactionDrafts() {
 if (!accountingApi) {
  setError(t('error_bridge'));
  return;
 }

 // One up-front lock check for the whole batch: warn once if any edited row is dated
 // on/before, or moves onto, reconciled history.
 let batchLockHit: { accountId: number; boundary: { balance: number } } | null = null;
 for (const transactionId of Object.keys(transactionTableDrafts).map(Number)) {
  const draft = transactionTableDrafts[transactionId];
  const transaction = transactionTableRowMap.get(transactionId);
  if (!draft || !transaction) continue;
  if (draft.isAdjustment && draft.adjustmentId) {
   const adj = adjustments.find((a) => a.id === draft.adjustmentId);
   if (!adj) continue;
   batchLockHit = violatedLock([adj.accountId], adj.createdAt, adj.id, lockBoundaries) ?? violatedLock([adj.accountId], resolveCreatedAt(draft.createdDate, adj.createdAt), adj.id, lockBoundaries);
  } else {
   batchLockHit = violatedLock([transaction.accountFromId, transaction.accountToId], transaction.createdAt, transaction.id, lockBoundaries) ?? violatedLock([draft.accountFromId, draft.accountToId], resolveCreatedAt(draft.createdDate, transaction.createdAt), transaction.id, lockBoundaries);
  }
  if (batchLockHit) break;
 }
 if (batchLockHit && !(await confirmDialog({ title: t('reconcile_warn_title'), message: t('reconcile_warn_message', { balance: formatLockBalance(batchLockHit.accountId, batchLockHit.boundary.balance) }), confirmText: t('reconcile_warn_confirm'), tone: 'danger' }))) {
  return;
 }

 try {
  for (const transactionId of Object.keys(transactionTableDrafts).map(Number)) {
   const draft = transactionTableDrafts[transactionId];
   const transaction = transactionTableRowMap.get(transactionId);
   if (!draft || !transaction) continue;
   if (draft.isAdjustment && draft.adjustmentId) {
    const amount = parseFloat(draft.amount);
    if (!draft.accountFromId || !draft.currencyId || !amount) {
     setError(t('transaction_required'));
     return;
    }
    const selectedCurrency = currencyMap.get(draft.currencyId);
    const account = clientAccountMap.get(draft.accountFromId);
    // Cross-currency with no rate entered → 0 (unset → pending); same-currency stays 1.
    const adjCross = !!(selectedCurrency && account && selectedCurrency.code !== account.currencyCode);
    const adjRawRate = parseFloat(draft.exchangeRateFrom);
    const adjRateSet = Number.isFinite(adjRawRate) && adjRawRate > 0;
    const adjRate = !adjCross ? 1 : adjRateSet ? (tableRateFromReversed[transactionId] ? 1 / adjRawRate : adjRawRate) : 0;
    await accountingApi.updateClientAdjustment({
     id: draft.adjustmentId,
     accountId: draft.accountFromId,
     amount,
     direction: draft.adjustmentDirection ?? 'debit',
     currencyId: draft.currencyId,
     currencyCode: selectedCurrency?.code || account?.currencyCode || '',
     currencySymbol: selectedCurrency?.symbol || account?.currencySymbol || '',
     exchangeRate: adjRate,
     exchangeRateReversed: !!tableRateFromReversed[transactionId] && adjRateSet,
     description: draft.description,
     createdAt: resolveCreatedAt(draft.createdDate, transaction.createdAt),
    });
    continue;
   }
   const amount = parseFloat(draft.amount);
   if ((!draft.accountFromId && !draft.accountToId) || !draft.currencyId) {
    setError(t('transaction_party_required'));
    return;
   }
   // Preserve the "unset" (0) rate for cross-currency sides so a pending row isn't forced to 1.
   const fromAcc = draft.accountFromId ? clientAccountMap.get(draft.accountFromId) : null;
   const toAcc = draft.accountToId ? clientAccountMap.get(draft.accountToId) : null;
   const fromCross = !!fromAcc && fromAcc.currencyId !== draft.currencyId;
   const toCross = !!toAcc && toAcc.currencyId !== draft.currencyId;
   const sideRate = (field: string, cross: boolean, reversed: boolean) => {
    const r = parseFloat(field);
    if (Number.isFinite(r) && r > 0) return reversed ? 1 / r : r;
    return cross ? 0 : 1;
   };
   const fromRateVal = sideRate(draft.exchangeRateFrom, fromCross, !!tableRateFromReversed[transactionId]);
   const toRateVal = sideRate(draft.exchangeRateTo, toCross, !!tableRateToReversed[transactionId]);
   await accountingApi.updateTransaction({
    id: transaction.id,
    accountFromId: draft.accountFromId,
    accountToId: draft.accountToId,
    currencyId: draft.currencyId,
    amount: amount || 0,
    type: draft.type,
    exchangeRateFrom: fromRateVal,
    commissionFrom: parseFloat(draft.commissionFrom) || 0,
    exchangeRateTo: toRateVal,
    commissionTo: parseFloat(draft.commissionTo) || 0,
    exchangeRateFromReversed: tableRateFromReversed[transactionId] && fromRateVal > 0 ? 1 : 0,
    exchangeRateToReversed: tableRateToReversed[transactionId] && toRateVal > 0 ? 1 : 0,
    charges: parseFloat(draft.charges) || 0,
    chargesCurrencyId: draft.chargesCurrencyId || null,
    chargesPayer: draft.chargesPayer,
    chargesExchangeRate: parseFloat(draft.chargesExchangeRate) || 1,
    chargesDescription: draft.chargesDescription,
    description: draft.description,
    archiveNote: draft.archiveNote,
    createdAt: resolveCreatedAt(draft.createdDate, transaction.createdAt),
   });
  }
  setError('');
  cancelTransactionsEditMode();
  await loadData();
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_update'));
 }
}

async function onDeleteTransaction(id: number, opts: { offerUndo?: boolean } = {}) {
 const { offerUndo = true } = opts;
 if (!accountingApi) {
  setError(t('error_bridge'));
  return;
 }

 const tx = transactions.find((t) => t.id === id);
 if (!(await confirmDeleteWithLock(tx ? [tx.accountFromId, tx.accountToId] : [], tx?.createdAt ?? '', id, 'transaction_delete_confirm'))) {
  return;
 }

 try {
  await accountingApi.deleteTransaction(id);
  setSelectedTransactionIds((current) => {
   const next = new Set(current);
   next.delete(id);
   return next;
  });
  setError('');
  await loadData();
  if (offerUndo && tx) {
   showUndo(t('toast_transaction_deleted'), () => void onUndoDeleteTransaction(tx));
  }
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_delete'));
 }
}

async function onUndoDeleteTransaction(tx: Transaction) {
 if (!accountingApi) {
  setError(t('error_bridge'));
  return;
 }
 try {
  await accountingApi.createTransaction(buildTransactionCreatePayload(tx, tx.createdAt));
  setError('');
  await loadData();
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_save'));
 }
}

function buildTransactionCreatePayload(tx: Transaction, createdAt: string) {
 return {
  accountFromId: tx.accountFromId,
  accountToId: tx.accountToId,
  currencyId: tx.currencyId,
  amount: tx.amount,
  type: tx.type,
  isArchived: !!tx.isArchived,
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
  descriptionFrom: tx.descriptionFrom,
  descriptionTo: tx.descriptionTo,
  exchangeActualAmount: tx.exchangeActualAmount,
  createdAt,
 };
}

async function onDeleteTransactionTableRow(row: TransactionTableRow) {
 if (row.isAdjustment && row.adjustmentId) {
  await onDeleteAdjustment(row.adjustmentId);
  return;
 }

 await onDeleteTransaction(row.id);
}

function onToggleTransactionSelection(transactionId: number) {
 setSelectedTransactionIds((current) => {
  const next = new Set(current);
  if (next.has(transactionId)) {
   next.delete(transactionId);
  } else {
   next.add(transactionId);
  }
  return next;
 });
}

function onToggleSelectAllTransactions() {
 setSelectedTransactionIds((current) => {
  const visibleIds = paginatedTransactions.map((transaction) => transaction.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => current.has(id));

  if (allVisibleSelected) {
   const next = new Set(current);
   visibleIds.forEach((id) => next.delete(id));
   return next;
  }

  const next = new Set(current);
  visibleIds.forEach((id) => next.add(id));
  return next;
 });
}

function onCopyTransactionRow(row: TransactionTableRow) {
 setCopiedTransaction(row);
 showToast(t('toast_copied'));
}

function onPasteCopiedTransaction() {
 const row = copiedTransaction;
 if (!row) return;
 const fromReversed = !!row.exchangeRateFromReversed;
 const toReversed = !!row.exchangeRateToReversed;
 const isAdjustment = !!row.isAdjustment;
 setTransactionForm({
  accountFromId: row.accountFromId,
  accountToId: isAdjustment ? null : row.accountToId,
  currencyId: row.currencyId,
  amount: row.amount ? formatAmountInput(String(row.amount)) : '',
  type: isAdjustment ? 'adjustment' : row.type,
  adjustmentDirection: row.adjustmentDirection ?? 'debit',
  exchangeRateFrom: fromReversed ? formatRateValue(1 / row.exchangeRateFrom) : String(row.exchangeRateFrom),
  commissionFrom: String(row.commissionFrom),
  exchangeRateTo: isAdjustment ? '1' : toReversed ? formatRateValue(1 / row.exchangeRateTo) : String(row.exchangeRateTo),
  commissionTo: String(row.commissionTo),
  charges: row.charges ? String(row.charges) : '',
  chargesCurrencyId: row.chargesCurrencyId,
  chargesPayer: row.chargesPayer,
  chargesExchangeRate: String(row.chargesExchangeRate),
  chargesDescription: row.chargesDescription,
  description: row.description,
  descriptionFrom: row.descriptionFrom ?? '',
  descriptionTo: row.descriptionTo ?? '',
  exchangeActualAmount: !isAdjustment && row.type === 'exchange' && row.exchangeActualAmount != null ? formatAmountInput(String(row.exchangeActualAmount)) : '',
 });
 setTxSplitDescription(!isAdjustment && Boolean(row.descriptionFrom?.trim() || row.descriptionTo?.trim()));
 setTxFromRateReversed(fromReversed);
 setTxToRateReversed(toReversed);
 setTxFromQuery('');
 setTxToQuery('');
 setIsNewTransactionExpensesOpen(true);
}

// Loads an existing row into the new-transaction form in "update" mode: the form is
// prefilled and the next submit updates this row in place (rather than creating a new
// one). Mirrors onPasteCopiedTransaction's fill but keeps the destination account and
// remembers which row is being edited (see onTransactionSubmit's update branches).
function onEditTransactionInForm(row: TransactionTableRow) {
 const fromReversed = !!row.exchangeRateFromReversed;
 const toReversed = !!row.exchangeRateToReversed;
 const isAdjustment = !!row.isAdjustment;
 setTransactionForm({
  accountFromId: row.accountFromId,
  accountToId: isAdjustment ? null : row.accountToId,
  currencyId: row.currencyId,
  amount: row.amount ? formatAmountInput(String(row.amount)) : '',
  type: isAdjustment ? 'adjustment' : row.type,
  adjustmentDirection: row.adjustmentDirection ?? 'debit',
  exchangeRateFrom: fromReversed ? formatRateValue(1 / row.exchangeRateFrom) : String(row.exchangeRateFrom),
  commissionFrom: String(row.commissionFrom),
  exchangeRateTo: isAdjustment ? '1' : toReversed ? formatRateValue(1 / row.exchangeRateTo) : String(row.exchangeRateTo),
  commissionTo: String(row.commissionTo),
  charges: row.charges ? String(row.charges) : '',
  chargesCurrencyId: row.chargesCurrencyId,
  chargesPayer: row.chargesPayer,
  chargesExchangeRate: String(row.chargesExchangeRate),
  chargesDescription: row.chargesDescription,
  description: row.description,
  descriptionFrom: row.descriptionFrom ?? '',
  descriptionTo: row.descriptionTo ?? '',
  exchangeActualAmount: !isAdjustment && row.type === 'exchange' && row.exchangeActualAmount != null ? formatAmountInput(String(row.exchangeActualAmount)) : '',
 });
 setTxSplitDescription(!isAdjustment && Boolean(row.descriptionFrom?.trim() || row.descriptionTo?.trim()));
 setTxFromRateReversed(fromReversed);
 setTxToRateReversed(toReversed);
 setTxFromQuery('');
 setTxToQuery('');
 setIsNewTransactionExpensesOpen(Boolean(row.charges) || Boolean(row.chargesPayer));
 setEditingTransaction({ id: isAdjustment ? (row.adjustmentId ?? row.id) : row.id, isAdjustment, createdAt: row.createdAt });
 setNewTransactionDate(row.createdAt.slice(0, 10));
 if (section === 'archive') setIsNewArchiveSectionOpen(true);
 else setIsNewTransactionSectionOpen(true);
 setError('');
}

// Leaves update mode and clears the form back to a blank create form.
function onCancelEditTransaction() {
 setEditingTransaction(null);
 setTransactionForm(emptyTransactionForm());
 setTxSplitDescription(false);
 setTxFromQuery('');
 setTxFromOpen(false);
 setTxToQuery('');
 setTxToOpen(false);
 setTxFromRateReversed(false);
 setTxToRateReversed(false);
 setIsNewTransactionExpensesOpen(false);
 setNewTransactionDate(new Date().toISOString().slice(0, 10));
 setError('');
}

async function onDeleteSelectedTransactions() {
 if (!accountingApi) {
  setError(t('error_bridge'));
  return;
 }

 const idsToDelete = [...selectedTransactionIds];
 if (!idsToDelete.length) {
  setError('No transactions selected.');
  return;
 }

 // Reconciliation guard: if any selected row sits at or before a lock line, show the
 // lock warning instead of the plain count confirm (one dialog either way).
 let bulkLockHit: { accountId: number; boundary: { balance: number } } | null = null;
 for (const id of idsToDelete) {
  if (id < 0) {
   const adj = adjustments.find((a) => a.id === -id);
   if (adj) bulkLockHit = violatedLock([adj.accountId], adj.createdAt, adj.id, lockBoundaries);
  } else {
   const tx = transactions.find((t) => t.id === id);
   if (tx) bulkLockHit = violatedLock([tx.accountFromId, tx.accountToId], tx.createdAt, tx.id, lockBoundaries);
  }
  if (bulkLockHit) break;
 }
 const confirmed = bulkLockHit
  ? await confirmDialog({ title: t('reconcile_warn_title'), message: t('reconcile_warn_message', { balance: formatLockBalance(bulkLockHit.accountId, bulkLockHit.boundary.balance) }), confirmText: t('reconcile_warn_confirm'), tone: 'danger' })
  : await confirmDialog({ message: t('transactions_delete_selected_confirm', { count: idsToDelete.length }), confirmText: t('delete'), tone: 'danger' });
 if (!confirmed) {
  return;
 }

 // Negative ids represent adjustments (stored negated in the selection set);
 // positive ids are real transactions. Send both groups in one bulk request
 // instead of a request per row.
 const adjustmentIds = idsToDelete.filter((id) => id < 0).map((id) => -id);
 const transactionIds = idsToDelete.filter((id) => id > 0);

 try {
  await accountingApi.deleteTransactionsBulk({ transactionIds, adjustmentIds });
  setSelectedTransactionIds(new Set());
  setError('');
  await loadData();
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_delete'));
 }
}

async function onTransactionRowDrop(draggedIds: number[], targetId: number, dropHalf: 'top' | 'bottom') {
 const dragSet = new Set(draggedIds);
 if (dragSet.has(targetId)) return;

 const currentOrder = manualRowOrder ?? displayedTransactionRows.map((r) => r.id);
 if (!currentOrder.includes(targetId)) return;

 // Remove all dragged rows from the order, then insert them as a block at the target position
 const without = currentOrder.filter((id) => !dragSet.has(id));
 const insertIdx = without.indexOf(targetId);
 if (insertIdx === -1) return;
 const insertAt = dropHalf === 'top' ? insertIdx : insertIdx + 1;
 const next = [...without.slice(0, insertAt), ...draggedIds, ...without.slice(insertAt)];

 // Determine date-zone changes for each dragged row
 const rowMap = new Map(displayedTransactionRows.map((r) => [r.id, r]));

 // Reconciliation guard: a drag that re-dates a row onto (or currently sitting on)
 // reconciled history must warn before we reorder. Replays the zone logic below.
 // Also tracks whether the drop silently re-dates any row, so we can confirm that too.
 let dropLockHit: { accountId: number; boundary: { balance: number } } | null = null;
 let dateChange: { from: string; to: string } | null = null;
 for (const draggedId of draggedIds) {
  const draggedRow = rowMap.get(draggedId);
  if (!draggedRow) continue;
  const pos = next.indexOf(draggedId);
  const neighborAbove = (() => { for (let i = pos - 1; i >= 0; i--) { if (!dragSet.has(next[i])) return rowMap.get(next[i]); } })();
  const neighborBelow = (() => { for (let i = pos + 1; i < next.length; i++) { if (!dragSet.has(next[i])) return rowMap.get(next[i]); } })();
  const zoneDate = (neighborAbove ?? neighborBelow)?.createdAt.slice(0, 10);
  const draggedDate = draggedRow.createdAt.slice(0, 10);
  const newCreatedAt = !zoneDate || zoneDate === draggedDate ? draggedRow.createdAt : zoneDate + draggedRow.createdAt.slice(10);
  if (zoneDate && zoneDate !== draggedDate && !dateChange) dateChange = { from: draggedDate, to: zoneDate };
  const accIds = draggedRow.isAdjustment ? [draggedRow.accountFromId] : [draggedRow.accountFromId, draggedRow.accountToId];
  const refId = draggedRow.isAdjustment ? draggedRow.adjustmentId ?? 0 : draggedRow.id;
  // Only an actual RE-DATE can change a reconciled balance; a pure same-date reorder just
  // reshuffles the display order (manualRowOrder) and never persists a timestamp, so it must
  // not warn. Even a re-date only matters if it moves the row ACROSS a lock's anchor (its
  // at-or-before-anchor membership flips); staying on the same side leaves the reconciled
  // balance unchanged.
  if (newCreatedAt !== draggedRow.createdAt) {
   for (const accId of accIds) {
    if (accId == null) continue;
    const boundary = lockBoundaries.get(accId);
    if (!boundary) continue;
    if (isAtOrBeforeBoundary(draggedRow.createdAt, refId, boundary) !== isAtOrBeforeBoundary(newCreatedAt, refId, boundary)) {
     dropLockHit = { accountId: accId, boundary };
     break;
    }
   }
  }
  if (dropLockHit && dateChange) break;
 }
 if (dropLockHit && !(await confirmDialog({ title: t('reconcile_warn_title'), message: t('reconcile_warn_message', { balance: formatLockBalance(dropLockHit.accountId, dropLockHit.boundary.balance) }), confirmText: t('reconcile_warn_confirm'), tone: 'danger' }))) {
  return;
 }
 if (dateChange && !(await confirmDialog({ title: t('drag_date_change_title'), message: t('drag_date_change_message', { from: dateChange.from, to: dateChange.to }), confirmText: t('drag_date_change_confirm'), tone: 'danger' }))) {
  return;
 }

 setManualRowOrder(next);

 if (!accountingApi) return;

 try {
  for (const draggedId of draggedIds) {
   const draggedRow = rowMap.get(draggedId);
   if (!draggedRow) continue;

   const pos = next.indexOf(draggedId);
   // Find nearest non-group neighbor to determine the target date zone
   const neighborAbove = (() => {
    for (let i = pos - 1; i >= 0; i--) {
     if (!dragSet.has(next[i])) return rowMap.get(next[i]);
    }
   })();
   const neighborBelow = (() => {
    for (let i = pos + 1; i < next.length; i++) {
     if (!dragSet.has(next[i])) return rowMap.get(next[i]);
    }
   })();
   const zoneDate = (neighborAbove ?? neighborBelow)?.createdAt.slice(0, 10);
   const draggedDate = draggedRow.createdAt.slice(0, 10);
   if (!zoneDate || zoneDate === draggedDate) continue;

   const newCreatedAt = zoneDate + draggedRow.createdAt.slice(10);

   if (draggedRow.isAdjustment && draggedRow.adjustmentId) {
    const account = clientAccountMap.get(draggedRow.accountFromId ?? -1);
    const selectedCurrency = currencyMap.get(draggedRow.currencyId);
    await accountingApi.updateClientAdjustment({
     id: draggedRow.adjustmentId,
     accountId: draggedRow.accountFromId,
     amount: draggedRow.amount,
     direction: draggedRow.adjustmentDirection ?? 'debit',
     currencyId: draggedRow.currencyId,
     currencyCode: selectedCurrency?.code || account?.currencyCode || '',
     currencySymbol: selectedCurrency?.symbol || account?.currencySymbol || '',
     exchangeRate: draggedRow.exchangeRateFrom,
     exchangeRateReversed: !!draggedRow.exchangeRateFromReversed,
     description: draggedRow.description,
     createdAt: newCreatedAt,
    });
   } else {
    await accountingApi.updateTransaction({
     id: draggedRow.id,
     accountFromId: draggedRow.accountFromId,
     accountToId: draggedRow.accountToId,
     currencyId: draggedRow.currencyId,
     amount: draggedRow.amount,
     type: draggedRow.type,
     exchangeRateFrom: draggedRow.exchangeRateFrom,
     commissionFrom: draggedRow.commissionFrom,
     exchangeRateTo: draggedRow.exchangeRateTo,
     commissionTo: draggedRow.commissionTo,
     exchangeRateFromReversed: draggedRow.exchangeRateFromReversed,
     exchangeRateToReversed: draggedRow.exchangeRateToReversed,
     charges: draggedRow.charges,
     chargesCurrencyId: draggedRow.chargesCurrencyId,
     chargesPayer: draggedRow.chargesPayer,
     chargesExchangeRate: draggedRow.chargesExchangeRate,
     chargesDescription: draggedRow.chargesDescription,
     description: draggedRow.description,
     createdAt: newCreatedAt,
    });
   }
  }
  setError('');
  const orderToKeep = next;
  await loadData();
  setManualRowOrder(orderToKeep);
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_update'));
  setManualRowOrder(currentOrder);
 }
}

async function onSaveTransactionTableRow(transactionId: number, { skipReload = false } = {}) {
 if (!accountingApi) {
  setError(t('error_bridge'));
  return;
 }

 const draft = transactionTableDrafts[transactionId];
 const transaction = transactionTableRowMap.get(transactionId);

 if (!transaction) {
  return;
 }

 // No changes were made — just exit edit mode like cancel
 if (!draft) {
  if (!skipReload) {
   setEditingRowIds((prev) => {
    const next = new Set(prev);
    next.delete(transactionId);
    return next;
   });
  }
  return;
 }

 if (draft.isAdjustment && draft.adjustmentId) {
  const amount = parseFloat(draft.amount);

  if (!draft.accountFromId || !draft.currencyId || !amount) {
   setError(t('transaction_required'));
   return;
  }

  const selectedCurrency = currencyMap.get(draft.currencyId);
  const account = clientAccountMap.get(draft.accountFromId);

  // Cross-currency with no rate entered → 0 (unset → pending); same-currency stays 1.
  const adjCross = !!(selectedCurrency && account && selectedCurrency.code !== account.currencyCode);
  const adjRawRate = parseFloat(draft.exchangeRateFrom);
  const adjRateSet = Number.isFinite(adjRawRate) && adjRawRate > 0;
  const adjRate = !adjCross ? 1 : adjRateSet ? (tableRateFromReversed[transactionId] ? 1 / adjRawRate : adjRawRate) : 0;

  const adjustmentPayload: ClientAdjustment = {
   id: draft.adjustmentId,
   accountId: draft.accountFromId,
   amount,
   direction: draft.adjustmentDirection ?? 'debit',
   currencyId: draft.currencyId,
   currencyCode: selectedCurrency?.code || account?.currencyCode || '',
   currencySymbol: selectedCurrency?.symbol || account?.currencySymbol || '',
   exchangeRate: adjRate,
   exchangeRateReversed: !!tableRateFromReversed[transactionId] && adjRateSet,
   description: draft.description,
   createdAt: resolveCreatedAt(draft.createdDate, transaction.createdAt),
  };

  // Single-row saves check the lock here; batch saves (skipReload) are checked up-front.
  if (!skipReload && !(await confirmIfEditLocked([transaction.accountFromId], transaction.createdAt, [adjustmentPayload.accountId], adjustmentPayload.createdAt, adjustmentPayload.id))) {
   return;
  }

  try {
   await accountingApi.updateClientAdjustment(adjustmentPayload);
   setError('');
   applyAdjustmentPatch(adjustmentPayload);
   if (!skipReload) {
    setEditingRowIds((prev) => {
     const next = new Set(prev);
     next.delete(transactionId);
     return next;
    });
    void loadData();
   }
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_update'));
  }
  return;
 }

 const amount = parseFloat(draft.amount) || 0;

 // Only the currency is mandatory; a transaction may keep a missing party or a
 // zero amount (e.g. archived/incomplete rows) and still be edited and saved.
 if (!draft.currencyId) {
  setError(t('transaction_currency_required'));
  return;
 }

 // Preserve the "unset" (0) rate for cross-currency sides so a pending row isn't forced to 1.
 const fromAcc = draft.accountFromId ? clientAccountMap.get(draft.accountFromId) : null;
 const toAcc = draft.accountToId ? clientAccountMap.get(draft.accountToId) : null;
 const fromCross = !!fromAcc && fromAcc.currencyId !== draft.currencyId;
 const toCross = !!toAcc && toAcc.currencyId !== draft.currencyId;
 const sideRate = (field: string, cross: boolean, reversed: boolean) => {
  const r = parseFloat(field);
  if (Number.isFinite(r) && r > 0) return reversed ? 1 / r : r;
  return cross ? 0 : 1;
 };
 const fromRateVal = sideRate(draft.exchangeRateFrom, fromCross, !!tableRateFromReversed[transactionId]);
 const toRateVal = sideRate(draft.exchangeRateTo, toCross, !!tableRateToReversed[transactionId]);

 const transactionPayload: TransactionUpdateInput = {
  id: transaction.id,
  accountFromId: draft.accountFromId,
  accountToId: draft.accountToId,
  currencyId: draft.currencyId,
  amount,
  type: draft.type,
  exchangeRateFrom: fromRateVal,
  commissionFrom: parseFloat(draft.commissionFrom) || 0,
  exchangeRateTo: toRateVal,
  commissionTo: parseFloat(draft.commissionTo) || 0,
  exchangeRateFromReversed: tableRateFromReversed[transactionId] && fromRateVal > 0 ? 1 : 0,
  exchangeRateToReversed: tableRateToReversed[transactionId] && toRateVal > 0 ? 1 : 0,
  charges: parseFloat(draft.charges) || 0,
  chargesCurrencyId: draft.chargesCurrencyId || null,
  chargesPayer: draft.chargesPayer,
  chargesExchangeRate: parseFloat(draft.chargesExchangeRate) || 1,
  chargesDescription: draft.chargesDescription,
  description: draft.description,
  archiveNote: draft.archiveNote,
  createdAt: resolveCreatedAt(draft.createdDate, transaction.createdAt),
 };

 // Single-row saves check the lock here; batch saves (skipReload) are checked up-front.
 if (!skipReload && !(await confirmIfTransactionEditLocked(transaction, transactionPayload))) {
  return;
 }

 try {
  await accountingApi.updateTransaction(transactionPayload);
  setError('');
  applyTransactionPatch(transactionPayload);
  if (!skipReload) {
   setEditingRowIds((prev) => {
    const next = new Set(prev);
    next.delete(transactionId);
    return next;
   });
   void loadData();
  }
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_update'));
 }
}

function onEditAllTransactions() {
 const newIds = paginatedTransactions.filter((tx) => !editingRowIds.has(tx.id)).map((tx) => tx.id);
 setEditingRowIds((prev) => new Set([...prev, ...newIds]));
 setIsEditAllTransactions(true);
}

function onCancelAllTransactions() {
 const ids = paginatedTransactions.map((tx) => tx.id);
 setEditingRowIds((prev) => {
  const n = new Set(prev);
  ids.forEach((id) => n.delete(id));
  return n;
 });
 setTransactionTableDrafts((prev) => {
  const n = { ...prev };
  ids.forEach((id) => delete n[id]);
  return n;
 });
 setIsEditAllTransactions(false);
}

async function onSaveAllTransactions() {
 const ids = paginatedTransactions.map((tx) => tx.id).filter((id) => editingRowIds.has(id));
 // Each row save applies its optimistic patch; exit edit mode immediately and reconcile in the background.
 await Promise.all(ids.map((id) => onSaveTransactionTableRow(id, { skipReload: true })));
 setEditingRowIds((prev) => {
  const n = new Set(prev);
  ids.forEach((id) => n.delete(id));
  return n;
 });
 setTransactionTableDrafts((prev) => {
  const n = { ...prev };
  ids.forEach((id) => delete n[id]);
  return n;
 });
 setIsEditAllTransactions(false);
 void loadData();
}

// Opens the archive export dialog, defaulting the date window to the full span of the
// currently-displayed archive rows so "export everything" needs no extra clicks.
function openArchiveExportModal() {
 const dates = displayedTransactionRows.map((row) => row.createdAt.slice(0, 10)).filter(Boolean).sort();
 setArchiveExportModal({
  fromDate: dates[0] ?? new Date().toISOString().slice(0, 10),
  toDate: dates[dates.length - 1] ?? new Date().toISOString().slice(0, 10),
  fromRowId: null,
  toRowId: null,
 });
}

// Exports the archive as PDF. With no range it exports the whole displayed table (kept for
// any direct callers); with a range it narrows to the inclusive date window and, when row
// boundaries are set (e.g. from the highlighted-range shortcut), to just the rows between
// them — matching what the dialog previews.
async function onExportArchivePdf(range?: ArchiveExportModalState) {
 if (!accountingApi) return;
 try {
  const rows = range ? selectArchiveExportRows(displayedTransactionRows, range) : displayedTransactionRows;
  const html = generateArchiveHtml({ t, numLocale, isRTL, language, pdfSettings }, rows, transactionTableSettings.columns);
  const exportDate = new Date().toISOString().slice(0, 10);
  const result = await accountingApi.exportLedgerPdf({ html, defaultFileName: `archive_${exportDate}.pdf` });
  if (!result.ok) setError(t('error_failed_save'));
  else setArchiveExportModal(null);
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_save'));
 }
}

const updateTransactionTableSettings = (updater: (current: TransactionTableSettings) => TransactionTableSettings) => {
 setTransactionTableSettings((current) => {
  const next = updater(current);
  (section === 'archive' ? saveArchiveTableSettings : saveTransactionTableSettings)(next);
  return next;
 });
 pushSharedSettingsIfOwner();
 pushUserTableSettings();
};

const openTransactionTableSettingsModal = () => {
 setTransactionTableSettingsDraft(transactionTableSettings);
 setShowTransactionTableSettingsModal(true);
};

const closeTransactionTableSettingsModal = () => {
 setTransactionTableSettingsDraft(transactionTableSettings);
 setShowTransactionTableSettingsModal(false);
};

const saveTransactionTableSettingsModal = () => {
 setTransactionTableSettings(transactionTableSettingsDraft);
 (section === 'archive' ? saveArchiveTableSettings : saveTransactionTableSettings)(transactionTableSettingsDraft);
 setShowTransactionTableSettingsModal(false);
 pushSharedSettingsIfOwner();
 pushUserTableSettings();
};

const openTransactionExportModal = () => {
 // Default the range to span all currently shown transactions (earliest → latest).
 let earliest = '';
 let latest = '';
 for (const row of displayedTransactionRows) {
  const day = row.createdAt.slice(0, 10);
  if (!day) continue;
  if (!earliest || day < earliest) earliest = day;
  if (!latest || day > latest) latest = day;
 }
 setTransactionExportFrom(earliest);
 setTransactionExportTo(latest);
 setShowTransactionExportModal(true);
};

const closeTransactionExportModal = () => {
 if (isExportingTransactions) return;
 setShowTransactionExportModal(false);
};

const buildTransactionExportData = (fromDate: string, toDate: string) => {
 const columns = transactionTableSettings.columns;
 const rows = displayedTransactionRows.filter((row) => {
  const day = row.createdAt.slice(0, 10);
  if (fromDate && day < fromDate) return false;
  if (toDate && day > toDate) return false;
  return true;
 });

 const headers: string[] = [];
 if (columns.created) headers.push(t('date'));
 if (columns.description) headers.push(t('transaction_description'));
 if (columns.accountFrom) headers.push(t('transaction_account_from'));
 if (columns.accountTo) headers.push(t('transaction_account_to'));
 if (columns.amount) headers.push(t('transaction_amount'));
 if (columns.charges) headers.push(t('charges'));
 if (columns.commission) headers.push(t('commission'));

 const partyLabel = (name: string, symbol: string, code: string, fallback: string) => (name ? `${name}${symbol || code ? ` (${symbol || code})` : ''}` : fallback);

 const dataRows = rows.map((txn) => {
  const cells: string[] = [];
  if (columns.created) cells.push(formatDateValue(txn.createdAt, transactionTableSettings.dateFormat));
  if (columns.description) cells.push(txn.description || '');
  if (columns.accountFrom) {
   cells.push(txn.accountFromId ? partyLabel(txn.clientFromName, txn.accountFromCurrencySymbol, txn.accountFromCurrencyCode, '') : t('archive_no_sender'));
  }
  if (columns.accountTo) {
   cells.push(
    txn.isAdjustment
     ? t(txn.adjustmentDirection === 'credit' ? 'adjustment_direction_credit_short' : 'adjustment_direction_debit_short')
     : txn.accountToId
       ? partyLabel(txn.clientToName, txn.accountToCurrencySymbol, txn.accountToCurrencyCode, '')
       : t('archive_no_receiver'),
   );
  }
  if (columns.amount) {
   cells.push(txn.amount ? `${txn.amount.toLocaleString(numLocale)}${pdfSettings.showCurrencySymbol ? ` ${txn.currencySymbol || txn.currencyCode}` : ''}` : '-');
  }
  if (columns.charges) {
   if (txn.isAdjustment || !txn.charges) {
    cells.push('-');
   } else {
    const parts = [`${txn.charges.toLocaleString(numLocale)}${txn.chargesCurrencyCode ? ` ${txn.chargesCurrencyCode}` : ''}`];
    if (txn.chargesPayer) parts.push(txn.chargesPayer === 'from' ? txn.clientFromName : txn.chargesPayer === 'to' ? txn.clientToName : '');
    if (txn.chargesDescription) parts.push(txn.chargesDescription);
    cells.push(parts.filter(Boolean).join(' — '));
   }
  }
  if (columns.commission) {
   if (txn.isAdjustment) {
    cells.push('-');
   } else {
    const parts: string[] = [];
    if (txn.commissionFrom) parts.push(`${txn.clientFromName}: ${txn.commissionFrom.toFixed(2)}%`);
    if (txn.commissionTo) parts.push(`${txn.clientToName}: ${txn.commissionTo.toFixed(2)}%`);
    cells.push(parts.length ? parts.join(' — ') : '-');
   }
  }
  return cells;
 });

 return { headers, rows: dataRows, count: dataRows.length };
};

const transactionExportFileBase = () => {
 const range = [transactionExportFrom, transactionExportTo].filter(Boolean).join('_');
 const sectionLabel = section === 'archive' ? 'archive' : 'transactions';
 return range ? `${sectionLabel}_${range}` : `${sectionLabel}_${new Date().toISOString().slice(0, 10)}`;
};

async function onExportTransactionsPdf() {
 if (!accountingApi) return;
 setIsExportingTransactions(true);
 try {
  const { headers, rows } = buildTransactionExportData(transactionExportFrom, transactionExportTo);
  const html = generateTransactionsExportHtml({ t, numLocale, isRTL, language, pdfSettings }, { section, transactionExportFrom, transactionExportTo, headers, rows });
  const result = await accountingApi.exportLedgerPdf({ html, defaultFileName: `${transactionExportFileBase()}.pdf` });
  if (result.ok) setShowTransactionExportModal(false);
  else setError(t('error_failed_save'));
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_save'));
 } finally {
  setIsExportingTransactions(false);
 }
}

async function onExportTransactionsExcel() {
 setIsExportingTransactions(true);
 try {
  const { headers, rows } = buildTransactionExportData(transactionExportFrom, transactionExportTo);
  const xlsxModule = await import('xlsx');
  const worksheet = xlsxModule.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = xlsxModule.utils.book_new();
  xlsxModule.utils.book_append_sheet(workbook, worksheet, section === 'archive' ? 'Archive' : 'Transactions');
  xlsxModule.writeFile(workbook, `${transactionExportFileBase()}.xlsx`);
  setShowTransactionExportModal(false);
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_save'));
 } finally {
  setIsExportingTransactions(false);
 }
}

 return {
  getTransactionTableDraft,
  updateTransactionTableDraft,
  onDeleteAllTransactions,
  onTransactionSubmit,
  onImportTransactionsFile,
  onPrepareImportReview,
  updateImportReviewEntry,
  updateImportRowOverride,
  onConfirmImportTransactions,
  onCancelImportTransactions,
  onDeleteTransaction,
  onDeleteTransactionTableRow,
  onToggleTransactionSelection,
  onToggleSelectAllTransactions,
  onCopyTransactionRow,
  onPasteCopiedTransaction,
  onEditTransactionInForm,
  onCancelEditTransaction,
  onDeleteSelectedTransactions,
  onTransactionRowDrop,
  onSaveTransactionTableRow,
  onEditAllTransactions,
  onCancelAllTransactions,
  onSaveAllTransactions,
  onExportArchivePdf,
  openArchiveExportModal,
  openTransactionTableSettingsModal,
  closeTransactionTableSettingsModal,
  saveTransactionTableSettingsModal,
  openTransactionExportModal,
  closeTransactionExportModal,
  buildTransactionExportData,
  onExportTransactionsPdf,
  onExportTransactionsExcel,
 };
}
