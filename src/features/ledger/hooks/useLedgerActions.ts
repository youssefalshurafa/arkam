'use client';

import { useReducer, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { confirmDialog, promptDialog } from '@/components/ui/AppDialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { accountingApi } from '@/lib/accountingApi';
import { transactionTypeLabelKey } from '@/shared/utils/transactionType';
import { NEW_ROW_REF_ID, type LockBoundary } from '@/features/ledger/utils/reconciliation';
import { ledgerEntryKey, getLedgerTransactionDraftKey } from '@/features/ledger/utils/ledgerEntries';
import { buildRateSamples, checkLedgerEntry, buildCommissionSamples, checkLedgerEntryCommission } from '@/features/ledger/utils/ledgerAnomalies';
import { generateLedgerHtml } from '@/features/pdf/pdfExport';
import { formatRateValue } from '@/shared/utils/format';
import { formatDateValue, localDateKey } from '@/shared/utils/date';
import { resolveCreatedAt, nextCreatedAtForDate } from '@/shared/utils/createdAt';
import { ledgerColumnOrderStorageKeyPrefix } from '@/shared/lib/localStorage';
import { useWorkspaceActions } from '@/features/workspace/hooks/useWorkspaceActions';
import { useLedgerStore } from '@/features/ledger/store/ledgerStore';
import { useTransactionsStore } from '@/features/transactions/store/transactionsStore';
import { emptyTransactionForm } from '@/features/transactions/forms';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { useReconciliationLocks } from '@/features/ledger/hooks/useReconciliationLocks';
import { useTransactionPatchers } from '@/features/transactions/hooks/useTransactionPatchers';
import type { DraftHistory } from '@/shared/hooks/useDraftHistory';
import type {
 Client,
 ClientAccount,
 ClientAccountLedger,
 ClientLedgerEntry,
 Currency,
 LedgerColumnKey,
 LedgerTransactionDraft,
 PdfColVisibility,
 Reconciliation,
 TransactionUpdateInput,
 Transaction,
} from '@/shared/types';

// One already-SAVED edit to a ledger row, reversible/replayable by re-issuing the same update
// API call with the previous/next persisted values. Distinct from `DraftHistory`, which only
// rewinds unsaved keystrokes in a currently-open row.
type LedgerEditAction = { undo: () => Promise<void>; redo: () => Promise<void> };

type UseLedgerActionsParams = {
 clientAccounts: ClientAccount[];
 transactions: Transaction[];
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
 lockPastEditsEnabled: boolean;
};

/**
 * Every client-ledger handler: inline row edit/save/cancel (single + "edit
 * all"), drag reorder, reconciliation mark/unmark + selection, one-sided
 * transaction creation, the mid-ledger write-off, and PDF/Excel export.
 * Reconciliation-lock guards and the optimistic transaction patcher are
 * shared with the (not-yet-extracted) transactions handlers, so they come
 * from useReconciliationLocks/useTransactionPatchers rather than being
 * duplicated here.
 */
export function useLedgerActions({
 clientAccounts,
 transactions,
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
 lockPastEditsEnabled,
}: UseLedgerActionsParams) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const { invalidate: loadData, setters, setError } = useWorkspaceActions();
 const setTransactions = setters.setTransactions;
 const setReconciliations = setters.setReconciliations;
 const setIgnoredAnomalies = setters.setIgnoredAnomalies;
 const pdfSettings = useSettingsStore((s) => s.pdfSettings);

 const {
  formatLockBalance,
  confirmIfLocked,
  confirmIfTransactionEditLocked,
  transactionEditImpact,
  blockedByPastEditLock,
 } = useReconciliationLocks({
  reconciliations,
  transactions,
  clientAccountMap,
  lockPastEditsEnabled,
 });
 const { applyTransactionPatch } = useTransactionPatchers({ clientAccountMap, currencyMap });

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
 const oneSidedTransactionModal = useLedgerStore((s) => s.oneSidedTransactionModal);
 const setOneSidedTransactionModal = useLedgerStore((s) => s.setOneSidedTransactionModal);
 const setNewTransactionModalAccountId = useLedgerStore((s) => s.setNewTransactionModalAccountId);
 const setPdfExportModal = useLedgerStore((s) => s.setPdfExportModal);

 // NewTransactionForm's data lives in useTransactionsStore (shared with the Transactions page's
 // own inline form) — opening the ledger's "New Transaction" modal just seeds that shared draft.
 const setTransactionForm = useTransactionsStore((s) => s.setTransactionForm);
 const setEditingTransaction = useTransactionsStore((s) => s.setEditingTransaction);
 const setTxFromQuery = useTransactionsStore((s) => s.setTxFromQuery);
 const setTxFromOpen = useTransactionsStore((s) => s.setTxFromOpen);
 const setTxToQuery = useTransactionsStore((s) => s.setTxToQuery);
 const setTxToOpen = useTransactionsStore((s) => s.setTxToOpen);
 const setTxSplitDescription = useTransactionsStore((s) => s.setTxSplitDescription);
 const setNewTransactionDate = useTransactionsStore((s) => s.setNewTransactionDate);

 // Undo/redo for already-SAVED edits — a separate bounded stack from `ledgerHistory`
 // (unsaved-draft undo). Each entry re-issues the same update API call the original save
 // used, with the previous/next persisted values, then refreshes like any other edit.
 const pastLedgerActions = useRef<LedgerEditAction[]>([]);
 const futureLedgerActions = useRef<LedgerEditAction[]>([]);
 const [isLedgerActionBusy, setIsLedgerActionBusy] = useState(false);
 const [, bumpLedgerActionHistory] = useReducer((x: number) => x + 1, 0);

 function pushLedgerEditAction(action: LedgerEditAction) {
  pastLedgerActions.current = [...pastLedgerActions.current, action].slice(-30);
  futureLedgerActions.current = [];
  bumpLedgerActionHistory();
 }

 async function undoLedgerEditAction() {
  const action = pastLedgerActions.current[pastLedgerActions.current.length - 1];
  if (!action || isLedgerActionBusy) return;
  setIsLedgerActionBusy(true);
  try {
   await action.undo();
   pastLedgerActions.current = pastLedgerActions.current.slice(0, -1);
   futureLedgerActions.current = [...futureLedgerActions.current, action];
  } finally {
   setIsLedgerActionBusy(false);
   bumpLedgerActionHistory();
  }
 }

 async function redoLedgerEditAction() {
  const action = futureLedgerActions.current[futureLedgerActions.current.length - 1];
  if (!action || isLedgerActionBusy) return;
  setIsLedgerActionBusy(true);
  try {
   await action.redo();
   futureLedgerActions.current = futureLedgerActions.current.slice(0, -1);
   pastLedgerActions.current = [...pastLedgerActions.current, action];
  } finally {
   setIsLedgerActionBusy(false);
   bumpLedgerActionHistory();
  }
 }

 // The toolbar's undo/redo buttons drive both stacks through one pair of controls:
 // unsaved-draft undo (typing in an open row) takes priority since it's the most recent
 // thing the user touched, falling back to the saved-edit stack once drafts are exhausted.
 const combinedLedgerHistory: DraftHistory = {
  record: ledgerHistory.record,
  reset: ledgerHistory.reset,
  canUndo: ledgerHistory.canUndo || (pastLedgerActions.current.length > 0 && !isLedgerActionBusy),
  canRedo: ledgerHistory.canRedo || (futureLedgerActions.current.length > 0 && !isLedgerActionBusy),
  undo: () => {
   if (ledgerHistory.canUndo) ledgerHistory.undo();
   else void undoLedgerEditAction();
  },
  redo: () => {
   if (ledgerHistory.canRedo) ledgerHistory.redo();
   else void redoLedgerEditAction();
  },
 };

function openOneSidedTransactionModal(accountId: number) {
 const account = clientAccounts.find((a) => a.id === accountId);
 setOneSidedTransactionModal({
  accountId,
  direction: 'client_from',
  date: localDateKey(),
  type: 'transfer',
  amount: '',
  currencyId: account?.currencyId ?? null,
  exchangeRate: '',
  exchangeRateReversed: false,
  commission: '',
  charges: '0',
  chargesCurrencyId: null,
  chargesPayer: '',
  chargesExchangeRate: '1',
  chargesDescription: '',
  description: '',
  counterParty: '',
 });
}

// Opens the ledger's "New Transaction" modal (the full two-sided form, unlike the one-sided
// modal above) by seeding useTransactionsStore's shared draft with this account pre-picked on
// the From side — the same reset onTransactionSubmit itself does after a successful create, so
// re-opening from a different account (or after leaving one open earlier) never leaks state.
function openNewTransactionModal(accountId: number) {
 const account = clientAccounts.find((a) => a.id === accountId);
 setEditingTransaction(null);
 setTransactionForm({ ...emptyTransactionForm(), accountFromId: accountId, currencyId: account?.currencyId ?? null });
 setTxFromQuery('');
 setTxFromOpen(false);
 setTxToQuery('');
 setTxToOpen(false);
 setTxSplitDescription(false);
 setNewTransactionDate(localDateKey());
 setNewTransactionModalAccountId(accountId);
}

function closeNewTransactionModal() {
 setNewTransactionModalAccountId(null);
}

async function onSubmitOneSidedTransaction() {
 if (!accountingApi || !oneSidedTransactionModal) {
  setError(t('error_bridge'));
  return;
 }

 const amount = parseFloat(oneSidedTransactionModal.amount);
 if (!Number.isFinite(amount) || amount <= 0) {
  setError(t('adjustment_amount_required'));
  return;
 }
 if (!oneSidedTransactionModal.currencyId) {
  setError(t('transaction_currency_required'));
  return;
 }

 const account = clientAccounts.find((a) => a.id === oneSidedTransactionModal.accountId);
 const selectedCurrency = currencyMap.get(oneSidedTransactionModal.currencyId);
 const needsRate = !!(selectedCurrency && account && selectedCurrency.code !== account.currencyCode);
 const parsedRate = parseFloat(oneSidedTransactionModal.exchangeRate);
 const rateSet = Number.isFinite(parsedRate) && parsedRate > 0;
 const effectiveRate = !needsRate ? 1 : rateSet ? (oneSidedTransactionModal.exchangeRateReversed ? 1 / parsedRate : parsedRate) : 0;
 const effectiveRateReversed = needsRate && rateSet ? oneSidedTransactionModal.exchangeRateReversed : false;

 const createdAt = nextCreatedAtForDate(oneSidedTransactionModal.date, transactions);
 if (blockedByPastEditLock([createdAt])) {
  return;
 }

 const isClientFrom = oneSidedTransactionModal.direction === 'client_from';
 const accountFromId = isClientFrom ? oneSidedTransactionModal.accountId : null;
 const accountToId = isClientFrom ? null : oneSidedTransactionModal.accountId;
 const commissionValue = parseFloat(oneSidedTransactionModal.commission) || 0;

 // Reconciliation guard: a new row dated at or before a lock line rewrites reconciled history.
 if (!(await confirmIfLocked([accountFromId, accountToId], createdAt, NEW_ROW_REF_ID))) {
  return;
 }

 const txPayload = {
  accountFromId,
  accountToId,
  currencyId: oneSidedTransactionModal.currencyId,
  amount,
  type: oneSidedTransactionModal.type,
  isArchived: false,
  exchangeRateFrom: isClientFrom ? effectiveRate : 1,
  commissionFrom: isClientFrom ? commissionValue : 0,
  exchangeRateTo: isClientFrom ? 1 : effectiveRate,
  commissionTo: isClientFrom ? 0 : commissionValue,
  exchangeRateFromReversed: isClientFrom && effectiveRateReversed,
  exchangeRateToReversed: !isClientFrom && effectiveRateReversed,
  // A charge always uses the transaction's own currency — no separate currency/rate to ask for.
  charges: parseFloat(oneSidedTransactionModal.charges) || 0,
  chargesCurrencyId: oneSidedTransactionModal.currencyId,
  chargesPayer: oneSidedTransactionModal.chargesPayer,
  chargesExchangeRate: 1,
  chargesDescription: oneSidedTransactionModal.chargesDescription,
  description: oneSidedTransactionModal.description,
  descriptionFrom: '',
  descriptionTo: '',
  exchangeActualAmount: null,
  archiveNote: '',
  counterParty: oneSidedTransactionModal.counterParty.trim(),
  distributionLocationId: null,
  createdAt,
 };

 try {
  await accountingApi.createTransaction(txPayload);
  setOneSidedTransactionModal(null);
  setError('');
  await loadData();
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_save'));
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
  counterParty: transaction.counterParty,
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
  distributionLocationId: transaction.distributionLocationId,
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

 const transaction = transactions.find((currentTransaction) => currentTransaction.id === transactionId);
 return transaction ? buildLedgerTransactionDraft(transaction, ledgerAccountId) : null;
}

// Builds the updated transaction record a ledger-row edit would save, from its draft — shared
// by the real save (`onSaveLedgerTransaction`) and the batch pre-check (`onSaveAllLedger`), so
// both agree on exactly what the edit changes.
function buildLedgerTransactionUpdate(transactionId: number, ledgerAccountId: number, draft: LedgerTransactionDraft, transaction: Transaction): { payload: TransactionUpdateInput } | { error: string } {
 const amount = parseFloat(draft.amount);
 // An explicitly-entered rate is stored as given — including 0, so a same-currency row can be
 // zeroed out (contributing 0 to the balance) instead of being forced to 1. An empty field
 // falls back to the default: 0 (pending, excluded from balance) cross-currency, 1 same-currency.
 // Uses draft.ledgerAccountId (not the ledgerAccountId param) so this reflects the account
 // actually selected for this side, in case it was reassigned to a different client/account.
 const ledgerAccount = clientAccounts.find((a) => a.id === draft.ledgerAccountId);
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
  return { error: 'transaction_required' };
 }
 if (draft.ledgerAccountId === draft.counterpartyAccountId) {
  return { error: 'ledger_self_account_conflict' };
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
  // A charge always uses the transaction's own currency — no separate currency/rate to ask for.
  charges: parseFloat(draft.charges) || 0,
  chargesCurrencyId: draft.currencyId,
  chargesPayer: draft.chargesPayer,
  chargesExchangeRate: 1,
  chargesDescription: draft.chargesDescription,
  description: draft.description,
  counterParty: draft.counterParty,
  distributionLocationId: draft.distributionLocationId,
  createdAt,
 };
 return { payload };
}

async function onSaveLedgerTransaction(transactionId: number, ledgerAccountId: number, { skipReload = false } = {}): Promise<boolean> {
 if (!accountingApi) {
  setError(t('error_bridge'));
  return false;
 }

 const draft = ledgerTransactionDrafts[getLedgerTransactionDraftKey(transactionId, ledgerAccountId)];
 const transaction = transactions.find((currentTransaction) => currentTransaction.id === transactionId);

 if (!draft || !transaction) {
  return false;
 }

 const built = buildLedgerTransactionUpdate(transactionId, ledgerAccountId, draft, transaction);
 if ('error' in built) {
  setError(t(built.error));
  return false;
 }
 const { payload } = built;

 // The row's pre-edit persisted state, for the saved-edit undo/redo stack — same field set as
 // `payload` above (not the full `Transaction` shape), read straight from `transaction` before
 // this save overwrites it.
 const previousPayload: TransactionUpdateInput = {
  id: transaction.id,
  accountFromId: transaction.accountFromId,
  accountToId: transaction.accountToId,
  currencyId: transaction.currencyId,
  amount: transaction.amount,
  type: transaction.type,
  exchangeRateFrom: transaction.exchangeRateFrom,
  commissionFrom: transaction.commissionFrom,
  exchangeRateTo: transaction.exchangeRateTo,
  commissionTo: transaction.commissionTo,
  exchangeRateFromReversed: transaction.exchangeRateFromReversed,
  exchangeRateToReversed: transaction.exchangeRateToReversed,
  exchangeActualAmount: transaction.exchangeActualAmount,
  charges: transaction.charges,
  chargesCurrencyId: transaction.chargesCurrencyId,
  chargesPayer: transaction.chargesPayer,
  chargesExchangeRate: transaction.chargesExchangeRate,
  chargesDescription: transaction.chargesDescription,
  description: transaction.description,
  counterParty: transaction.counterParty,
  distributionLocationId: transaction.distributionLocationId,
  createdAt: transaction.createdAt,
 };

 if (blockedByPastEditLock([transaction.createdAt, payload.createdAt], Boolean(transaction.isArchived))) {
  return false;
 }

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
  pushLedgerEditAction({
   undo: async () => {
    await accountingApi.updateTransaction(previousPayload);
    applyTransactionPatch(previousPayload);
    await loadData();
   },
   redo: async () => {
    await accountingApi.updateTransaction(payload);
    applyTransactionPatch(payload);
    await loadData();
   },
  });
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
  const tx = transactions.find((t) => t.id === entry.transactionId);
  if (!tx) continue;
  if (!ledgerTransactionDrafts[draftKey]) {
   newDrafts[draftKey] = buildLedgerTransactionDraft(tx, ledger.accountId);
   const isOutgoing = tx.accountFromId === ledger.accountId;
   if (isOutgoing ? tx.exchangeRateFromReversed : tx.exchangeRateToReversed) {
    newRateReversed[draftKey] = true;
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
 // they don't each prompt). Builds the same updated record each row's real save would
 // write and warns once, only if some row's edit actually moves a reconciled balance
 // (not merely because the row sits at/before a lock line — see `useReconciliationLocks`).
 let batchLockHit: { accountId: number; boundary: { balance: number } } | null = null;
 for (const key of keys) {
  const [txIdStr, accIdStr] = key.split(':');
  const transactionId = parseInt(txIdStr, 10);
  const accId = parseInt(accIdStr, 10);
  const draft = ledgerTransactionDrafts[key];
  if (!draft) continue;
  const tx = transactions.find((t) => t.id === transactionId);
  if (!tx) continue;
  const built = buildLedgerTransactionUpdate(transactionId, accId, draft, tx);
  if ('error' in built) continue;
  batchLockHit = transactionEditImpact(tx, built.payload);
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
 await onDeleteTransaction(entry.transactionId);
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
 const anchorRefId = entry.transactionId;
 try {
  const created = await accountingApi.createReconciliation({
   accountId: ledgerAccountId,
   anchorRefId,
   anchorCreatedAt: entry.createdAt,
   balance: entry.runningBalance,
   note: '',
  });
  setReconciliations((prev) => [
   ...prev,
   { id: created.id, accountId: ledgerAccountId, anchorKind: 'transaction', anchorRefId, anchorCreatedAt: entry.createdAt, balance: entry.runningBalance, note: '', createdAt: new Date().toISOString() },
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

// Dismisses a rate/commission anomaly badge (see ledgerAnomalies.ts) the user reviewed and
// judged fine — shared workspace-wide, so it stops flagging for every member, not just the
// one who ignored it. `accountId` is which side of the transaction this applies to.
async function onIgnoreAnomaly(kind: 'rate' | 'commission', transactionId: number, accountId: number) {
 if (!(await confirmDialog({ message: t('ignore_anomaly_confirm'), confirmText: t('ignore_anomaly_confirm_button') }))) return;
 try {
  const created = await accountingApi.createIgnoredAnomaly({ kind, transactionId, accountId });
  if (created.id != null) {
   setIgnoredAnomalies((prev) => [...prev, { id: created.id as number, kind, transactionId, accountId, createdAt: new Date().toISOString() }]);
  }
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
  await onDeleteTransaction(entry.transactionId, { offerUndo: false });
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

async function onWriteOffLedgerRow(entry: ClientLedgerEntry, ledgerAccountId: number) {
 if (!accountingApi) {
  setError(t('error_bridge'));
  return;
 }
 const balance = entry.runningBalance;
 const maxAmount = Math.abs(balance);
 if (maxAmount <= 0) return;

 const account = clientAccounts.find((a) => a.id === ledgerAccountId);
 if (!account) return;
 const currencyLabel = account.currencySymbol || account.currencyCode;

 // The user picks how much of the running balance at this row to write off — not necessarily
 // all of it (e.g. a small reconciliation difference with another accountant). Capped at the
 // balance itself so a write-off can only move the balance toward zero, never past it.
 const input = await promptDialog({
  title: t('write_off_confirm_title'),
  message: t('write_off_row_prompt_message')
   .replace('{balance}', balance.toLocaleString(numLocale, { maximumFractionDigits: 2 }))
   .replace('{currency}', currencyLabel),
  defaultValue: maxAmount.toLocaleString('en-US', { maximumFractionDigits: 2, useGrouping: false }),
  placeholder: maxAmount.toString(),
 });
 if (input == null) return;
 const amount = parseFloat(input);
 if (!Number.isFinite(amount) || amount <= 0) {
  setError(t('write_off_invalid_amount'));
  return;
 }
 if (amount > maxAmount + 1e-9) {
  setError(t('write_off_amount_exceeds').replace('{max}', maxAmount.toLocaleString(numLocale, { maximumFractionDigits: 2 })).replace('{currency}', currencyLabel));
  return;
 }

 // Time-place the write-off strictly after the target row (and before the next one when
 // there's room), so it sorts right after this row in the ledger. Must never land on the
 // exact same createdAt as the target.
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

 // Reconciliation guard: inserting a row at/before a lock line rewrites reconciled history.
 if (!(await confirmIfLocked([ledgerAccountId], createdAt, NEW_ROW_REF_ID))) return;

 // balance > 0 means this account is owed money — a write-off must move the balance DOWN
 // toward zero, i.e. net negatively, which is the "to" side's sign (see
 // computeTransactionSideNetChange); balance < 0 is the mirror "from" side case.
 try {
  await accountingApi.createTransaction({
   accountFromId: balance > 0 ? null : ledgerAccountId,
   accountToId: balance > 0 ? ledgerAccountId : null,
   currencyId: account.currencyId,
   amount,
   type: 'adjustment',
   isArchived: false,
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
   description: t('write_off_description'),
   descriptionFrom: '',
   descriptionTo: '',
   exchangeActualAmount: null,
   archiveNote: '',
   counterParty: '',
   distributionLocationId: null,
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

 // Reconciliation guard: the reflow below rewrites createdAt for every row in the date group —
 // not just the ones dragged — and each of those transactions touches TWO accounts (this
 // ledger's own account and its counterparty), either of which may independently be reconciled.
 // Re-time each affected transaction through the same balance-aware check a direct edit uses
 // (transactionEditImpact: old createdAt vs new, evaluated against every account it touches).
 // This must check every reflowed row, not just the explicitly dragged ones: when the dragged
 // row is itself a reconciliation anchor (or lands next to one), a same-day "bystander" that
 // wasn't dragged can still cross the live-resolved lock boundary as a byproduct of the reflow —
 // checking only `dragSet` misses that case entirely.
 let dragLockHit: { accountId: number; boundary: LockBoundary } | null = null;
 for (const [key, newCreatedAt] of newTimes) {
  const entry = entryMap.get(key);
  if (!entry) continue;
  if (new Date(entry.createdAt).getTime() === new Date(newCreatedAt).getTime()) continue;
  const tx = transactions.find((t) => t.id === entry.transactionId);
  if (!tx) continue;
  dragLockHit = transactionEditImpact(tx, { ...tx, createdAt: newCreatedAt });
  if (dragLockHit) break;
 }
 if (
  dragLockHit &&
  !(await confirmDialog({
   title: t('reconcile_warn_title'),
   message: t('reconcile_warn_message', { balance: formatLockBalance(dragLockHit.accountId, dragLockHit.boundary.balance) }),
   confirmText: t('reconcile_warn_confirm'),
   tone: 'danger',
  }))
 ) {
  return;
 }

 // Optimistically apply the new timestamps so the rows reorder instantly, before the round-trip.
 setTransactions((prev) =>
  prev.map((tx) => {
   const nc = newTimes.get(`${tx.id}:${accountId}`);
   return nc ? { ...tx, createdAt: nc } : tx;
  }),
 );

 try {
  for (const [key, newCreatedAt] of newTimes) {
   const entry = entryMap.get(key);
   if (!entry || !newCreatedAt) continue;
   // Skip rows whose timestamp didn't actually change, to avoid needless writes.
   if (new Date(entry.createdAt).getTime() === new Date(newCreatedAt).getTime()) continue;
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
    counterParty: tx.counterParty,
    distributionLocationId: tx.distributionLocationId,
    createdAt: newCreatedAt,
   });
  }
  setError('');
  await loadData();
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_update'));
  await loadData();
 }
}

function selectLedgerEntriesForRange(
 ledger: ClientAccountLedger,
 fromDate: string,
 toDate: string,
 fromEntryKey?: string | null,
 toEntryKey?: string | null,
): ClientLedgerEntry[] {
 const candidates = ledger.entries.filter((e) => {
  const d = e.createdAt.slice(0, 10);
  return d >= fromDate && d <= toDate;
 });
 const startIdx = fromEntryKey ? Math.max(0, candidates.findIndex((e) => ledgerEntryKey(e) === fromEntryKey)) : 0;
 const endIdxRaw = toEntryKey ? candidates.findIndex((e) => ledgerEntryKey(e) === toEntryKey) : -1;
 const endIdx = endIdxRaw === -1 ? candidates.length - 1 : endIdxRaw;
 return startIdx <= endIdx ? candidates.slice(startIdx, endIdx + 1) : [];
}

// A last-line-of-defense "second accountant" check before a ledger leaves the app: flags
// exchange rates that deviate sharply from other transactions in the same currency pair
// (most notably a ×/÷ toggle mistake, which is off by 10s-to-100s-x), plus exchange-transaction
// commissions that break from this account's own commission history — and requires the user
// to explicitly acknowledge before export proceeds. Mirrors the confirmIfLocked pattern.
async function confirmIfLedgerAnomalies(entries: ClientLedgerEntry[], ledgerCurrencyCode: string, accountId: number): Promise<boolean> {
 const rateSamples = buildRateSamples(transactions);
 const commissionSamples = buildCommissionSamples(transactions);
 const flaggedRates = entries
  .map((entry) => ({ entry, anomaly: checkLedgerEntry(entry, ledgerCurrencyCode, rateSamples) }))
  .filter((x): x is { entry: ClientLedgerEntry; anomaly: NonNullable<typeof x.anomaly> } => x.anomaly != null)
  .map(({ entry, anomaly }) => `${formatDateValue(entry.createdAt, pdfSettings.dateFormat)} · ${entry.description || entry.counterpartyName} — ${t('ledger_anomaly_entered')}: ${formatRateValue(anomaly.enteredRate)}, ${t('ledger_anomaly_expected')}: ~${formatRateValue(anomaly.referenceRate)}`);
 const flaggedCommissions = entries
  .map((entry) => ({ entry, anomaly: checkLedgerEntryCommission(entry, accountId, commissionSamples) }))
  .filter((x): x is { entry: ClientLedgerEntry; anomaly: NonNullable<typeof x.anomaly> } => x.anomaly != null)
  .map(({ entry, anomaly }) => `${formatDateValue(entry.createdAt, pdfSettings.dateFormat)} · ${entry.description || entry.counterpartyName} — ${t('ledger_anomaly_entered')}: ${anomaly.enteredCommission}%, ${t('ledger_anomaly_expected')}: ~${formatRateValue(anomaly.referenceCommission)}%`);
 const allLines = [...flaggedRates, ...flaggedCommissions];
 if (allLines.length === 0) return true;
 const shown = allLines.slice(0, 8);
 if (allLines.length > shown.length) shown.push(t('ledger_anomaly_more', { count: String(allLines.length - shown.length) }));
 return confirmDialog({
  title: t('ledger_anomaly_warn_title'),
  message: `${t('ledger_anomaly_warn_message')}\n\n${shown.join('\n')}`,
  confirmText: t('ledger_anomaly_warn_confirm'),
  tone: 'danger',
 });
}

// Same "second accountant" gate as confirmIfLedgerAnomalies, for a different concern: entries
// with no exchange rate entered yet (pendingRate, see ledgerBalances.ts) are excluded from the
// running balance and rendered as a dash in the export — easy to miss unless flagged explicitly.
async function confirmIfLedgerPendingPricing(entries: ClientLedgerEntry[]): Promise<boolean> {
 const pending = entries.filter((entry) => entry.pendingRate);
 if (pending.length === 0) return true;
 const shown = pending.slice(0, 8).map((entry) => `${formatDateValue(entry.createdAt, pdfSettings.dateFormat)} · ${entry.description || entry.counterpartyName}`);
 if (pending.length > shown.length) shown.push(t('ledger_anomaly_more', { count: String(pending.length - shown.length) }));
 return confirmDialog({
  title: t('ledger_pending_pricing_warn_title'),
  message: `${t('ledger_pending_pricing_warn_message')}\n\n${shown.join('\n')}`,
  confirmText: t('ledger_pending_pricing_warn_confirm'),
  tone: 'danger',
 });
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
  const selected = selectLedgerEntriesForRange(ledger, fromDate, toDate, fromEntryKey, toEntryKey);
  if (!(await confirmIfLedgerAnomalies(selected, ledger.currencyCode, ledger.accountId))) return;
  if (!(await confirmIfLedgerPendingPricing(selected))) return;
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
  const selected = selectLedgerEntriesForRange(ledger, fromDate, toDate, fromEntryKey, toEntryKey);
  if (!(await confirmIfLedgerAnomalies(selected, ledger.currencyCode, ledger.accountId))) return;
  if (!(await confirmIfLedgerPendingPricing(selected))) return;

  type ExcelColDef = { key: LedgerColumnKey; header: string; cell: (e: ClientLedgerEntry) => string | number };
  const allCols: ExcelColDef[] = [
   { key: 'created', header: t('date'), cell: (e) => formatDateValue(e.createdAt, pdfSettings.dateFormat) },
   { key: 'counterparty', header: t('counterparty'), cell: (e) => e.counterpartyName },
   { key: 'direction', header: t('direction'), cell: (e) => t(e.direction === 'outgoing' ? 'outgoing' : 'incoming') },
   { key: 'type', header: t('transaction_type'), cell: (e) => t(transactionTypeLabelKey(e.type)) },
   { key: 'amount', header: t('amount'), cell: (e) => e.amount },
   { key: 'exchangeRate', header: t('exchange_rate'), cell: (e) => (e.pendingRate ? '' : e.exchangeRateReversed ? 1 / e.exchangeRate : e.exchangeRate) },
   { key: 'commission', header: t('commission'), cell: (e) => e.commission },
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
  openOneSidedTransactionModal,
  onSubmitOneSidedTransaction,
  openNewTransactionModal,
  closeNewTransactionModal,
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
  onIgnoreAnomaly,
  onToggleLedgerEntrySelection,
  onDeleteSelectedLedgerEntries,
  onEditSelectedLedgerEntries,
  onWriteOffLedgerRow,
  onLedgerRowDrop,
  onExportLedgerPdf,
  onExportLedgerExcel,
  combinedLedgerHistory,
 };
}
