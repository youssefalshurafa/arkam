'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { choiceDialog, confirmDialog } from '@/components/ui/AppDialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { accountingApi } from '@/lib/accountingApi';
import { transactionTypeLabelKey } from '@/shared/utils/transactionType';
import { NEW_ROW_REF_ID, marksAffectedByReorder, type LockBoundary } from '@/features/ledger/utils/reconciliation';
import { ledgerEntryKey, getLedgerTransactionDraftKey } from '@/features/ledger/utils/ledgerEntries';
import { buildRateSamples, checkLedgerEntry, buildCommissionSamples, checkLedgerEntryCommission } from '@/features/ledger/utils/ledgerAnomalies';
import type { ReviewEngineSettings } from '@/features/ledger/utils/reviewSettings';
import { isSameTransactionUpdate, transactionUpdateSnapshot } from '@/features/ledger/utils/transactionUpdate';
import { generateLedgerHtml } from '@/features/pdf/pdfExport';
import { formatRateValue } from '@/shared/utils/format';
import { formatDateValue, localDateKey } from '@/shared/utils/date';
import { resolveCreatedAt, nextCreatedAtForDate } from '@/shared/utils/createdAt';
import { ledgerColumnOrderStorageKeyPrefix } from '@/shared/lib/localStorage';
import { LEDGER_EDIT_FIELD_KEYS } from '@/shared/types';
import { useWorkspaceActions } from '@/features/workspace/hooks/useWorkspaceActions';
import { useLedgerStore } from '@/features/ledger/store/ledgerStore';
import { computeClientLedgers } from '@/features/ledger/utils/ledgerBalances';
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
 IgnoredAnomaly,
 LedgerColumnKey,
 LedgerEditFieldKey,
 LedgerTransactionDraft,
 PdfColVisibility,
 Reconciliation,
 TransactionUpdateInput,
 Transaction,
} from '@/shared/types';

// How long to wait after the last optimistic ledger write before reconciling with the server.
// Long enough that a run of quick edits collapses into one refetch, short enough that anything
// the server decided differently surfaces while the user is still looking at the same rows.
const WORKSPACE_RESYNC_DELAY_MS = 1_500;

// Every row-edit field routes its keydown through the same handler, and the description column's
// field can be rendered as a textarea (DescriptionSuggestField), so the event is typed over both.
type LedgerEditFieldKeyEvent = ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>;

// One already-SAVED edit to a ledger row, reversible/replayable by re-issuing the same update
// API call with the previous/next persisted values. Distinct from `DraftHistory`, which only
// rewinds unsaved keystrokes in a currently-open row.
type LedgerEditAction = { undo: () => Promise<void>; redo: () => Promise<void> };

type UseLedgerActionsParams = {
 clientAccounts: ClientAccount[];
 transactions: Transaction[];
 reconciliations: Reconciliation[];
 ignoredAnomalies: IgnoredAnomaly[];
 reviewSettings: ReviewEngineSettings;
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
 ignoredAnomalies,
 reviewSettings,
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
  lockAccountLabel,
  warnLockHit,
  checkLockForNewRow,
  checkLockForEdit,
  checkLockForBatchEdit,
  checkLockForBatchDelete,
  transactionEditImpact,
  blockedByPastEditLock,
 } = useReconciliationLocks({
  reconciliations,
  clientAccountMap,
  lockPastEditsEnabled,
 });
 const { applyTransactionPatch } = useTransactionPatchers({ clientAccountMap, currencyMap });

 // Reconciling refetch after optimistic ledger writes, coalesced. `loadData` invalidates the
 // whole workspace snapshot — every organization, client, account and transaction in one
 // round-trip — which is far too heavy to run once per saved row: editing a column with the
 // arrow keys fired one per keystroke. The optimistic patch already shows the right values, so
 // this exists only to pick up anything the server decided differently; running it once after
 // the user stops is enough, and keeps a run of edits from queueing a reload behind each one.
 const resyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
 const scheduleWorkspaceResync = useCallback(() => {
  if (resyncTimerRef.current) clearTimeout(resyncTimerRef.current);
  resyncTimerRef.current = setTimeout(() => {
   resyncTimerRef.current = null;
   void loadData();
  }, WORKSPACE_RESYNC_DELAY_MS);
 }, [loadData]);
 // A pending resync is dropped if the ledger unmounts; whatever mounts next fetches on its own.
 useEffect(() => () => {
  if (resyncTimerRef.current) clearTimeout(resyncTimerRef.current);
 }, []);

 // Saves no longer hold the UI open until the server answers, which means a row can be closed
 // and looking saved while its write is still on the wire. That window is short, but this is
 // accounting data: closing the tab inside it would drop the edit with nothing on screen to
 // suggest it hadn't landed. Track the writes still in flight and let the browser ask before
 // unloading — the listener only exists while something is genuinely pending.
 const pendingWritesRef = useRef(0);
 // One stable listener identity for the whole hook's life — a fresh closure per call would be
 // added under one identity and removed under another, leaving the warning armed forever.
 const warnOnUnloadRef = useRef((event: BeforeUnloadEvent) => event.preventDefault());
 const trackPendingWrite = useCallback(<T,>(request: Promise<T>): Promise<T> => {
  if (pendingWritesRef.current === 0) window.addEventListener('beforeunload', warnOnUnloadRef.current);
  pendingWritesRef.current += 1;
  return request.finally(() => {
   pendingWritesRef.current -= 1;
   if (pendingWritesRef.current === 0) window.removeEventListener('beforeunload', warnOnUnloadRef.current);
  });
 }, []);
 useEffect(() => {
  const warn = warnOnUnloadRef.current;
  return () => window.removeEventListener('beforeunload', warn);
 }, []);

 const draggedLedgerColumn = useLedgerStore((s) => s.draggedLedgerColumn);
 const setDraggedLedgerColumn = useLedgerStore((s) => s.setDraggedLedgerColumn);
 const setLedgerColumnOrder = useLedgerStore((s) => s.setLedgerColumnOrder);
 const ledgerColumnOrder = useLedgerStore((s) => s.ledgerColumnOrder);
 // Read on demand rather than subscribing. This hook runs inside the page component, and a
 // ledger draft changes on every keystroke, so subscribing here re-rendered the whole page —
 // and every section mounted under it — once per character typed. Every read below happens
 // inside an event handler, never during render, so there is nothing to subscribe for.
 const getLedgerTransactionDrafts = () => useLedgerStore.getState().ledgerTransactionDrafts;
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
 const copiedTransaction = useTransactionsStore((s) => s.copiedTransaction);
 const setTxSplitDescription = useTransactionsStore((s) => s.setTxSplitDescription);
 const setNewTransactionDate = useTransactionsStore((s) => s.setNewTransactionDate);
 const setIsNewTransactionExpensesOpen = useTransactionsStore((s) => s.setIsNewTransactionExpensesOpen);
 const setIsNewTransactionExpensesOpen2 = useTransactionsStore((s) => s.setIsNewTransactionExpensesOpen2);

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
  return action;
 }

 // Takes back an entry pushed for an edit that turned out not to have landed. Optimistic saves
 // push their undo entry up front so undo works the instant the row closes; when the write then
 // fails and the row is rolled back, its entry has to come off the stack too, or the next undo
 // would "revert" a change the server never made.
 function dropLedgerEditAction(action: LedgerEditAction) {
  pastLedgerActions.current = pastLedgerActions.current.filter((entry) => entry !== action);
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

// Fills the open one-sided-transaction modal from a row copied on the Transactions page
// (useTransactionsStore's `copiedTransaction`), mirroring the Transactions page's own
// onPasteCopiedTransaction. The modal only has one real account side — this ledger's own
// account, fixed by whichever `direction` is currently selected — so the copied row's
// from/to-side fields are picked based on that direction rather than copying both sides.
// Deliberately leaves `date` untouched (stays at today, as set when the modal opened): a paste
// is a template for a fresh transaction, not a way to backdate one to the copied row's date.
// The Transactions page's own paste does the same.
function onPasteIntoOneSidedTransaction() {
 if (!copiedTransaction) return;
 const row = copiedTransaction;
 setOneSidedTransactionModal((prev) => {
  if (!prev) return prev;
  const isClientFrom = prev.direction === 'client_from';
  const rate = isClientFrom ? row.exchangeRateFrom : row.exchangeRateTo;
  const reversed = !!(isClientFrom ? row.exchangeRateFromReversed : row.exchangeRateToReversed);
  return {
   ...prev,
   type: row.type,
   amount: row.amount ? String(row.amount) : '',
   currencyId: row.currencyId,
   exchangeRate: rate ? (reversed ? formatRateValue(1 / rate) : String(rate)) : '',
   exchangeRateReversed: reversed,
   commission: String(isClientFrom ? row.commissionFrom : row.commissionTo),
   charges: row.charges ? String(row.charges) : '0',
   chargesCurrencyId: row.chargesCurrencyId,
   chargesPayer: row.chargesPayer,
   chargesExchangeRate: String(row.chargesExchangeRate || 1),
   chargesDescription: row.chargesDescription,
   charges2: row.charges2 ? String(row.charges2) : '0',
   charges2CurrencyId: row.charges2CurrencyId,
   chargesPayer2: row.chargesPayer2,
   charges2ExchangeRate: String(row.charges2ExchangeRate || 1),
   charges2Description: row.charges2Description,
   description: row.description,
   counterParty: row.counterParty || '',
  };
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
 // Both expenses sections are shared, sticky store state (a paste or an edit of a row that
 // carried charges leaves them expanded), so a fresh entry here must collapse them itself —
 // same reset the Transactions page does when it clears its own form.
 setIsNewTransactionExpensesOpen(false);
 setIsNewTransactionExpensesOpen2(false);
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
 const lock = await checkLockForNewRow([accountFromId, accountToId], createdAt, NEW_ROW_REF_ID);
 if (!lock.proceed) {
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
  charges2: parseFloat(oneSidedTransactionModal.charges2) || 0,
  charges2CurrencyId: oneSidedTransactionModal.currencyId,
  chargesPayer2: oneSidedTransactionModal.chargesPayer2,
  charges2ExchangeRate: 1,
  charges2Description: oneSidedTransactionModal.charges2Description,
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
  await accountingApi.createTransaction({ ...txPayload, acknowledgeReconciliationOverride: lock.overrode });
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
  charges2: String(transaction.charges2 || 0),
  charges2CurrencyId: transaction.charges2CurrencyId,
  chargesPayer2: transaction.chargesPayer2,
  charges2ExchangeRate: String(transaction.charges2ExchangeRate || 1),
  charges2Description: transaction.charges2Description,
  distributionLocationId: transaction.distributionLocationId,
 };
}

function updateLedgerTransactionDraft(transactionId: number, ledgerAccountId: number, nextValues: Partial<LedgerTransactionDraft>) {
 ledgerHistory.record();
 setLedgerTransactionDrafts((current) => {
  const draftKey = getLedgerTransactionDraftKey(transactionId, ledgerAccountId);
  // Self-heal like the Transactions page's equivalent (updateTransactionTableDraft): a row can
  // render open (editingLedgerRowKeys still has its key) with its draft entry missing — e.g.
  // openClientLedger()/the client-ledger route effect wipe the whole draft map on navigation
  // without also closing edit mode — in which case falling through to "not editing, drop the
  // keystroke" silently ate every keystroke and looked like a frozen input until a full reload.
  // Rebuilding from the live transaction here means the field recovers instead.
  const existingDraft =
   current[draftKey] ??
   (() => {
    const transaction = transactions.find((t) => t.id === transactionId);
    return transaction ? buildLedgerTransactionDraft(transaction, ledgerAccountId) : null;
   })();
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
 const existingDraft = getLedgerTransactionDrafts()[draftKey];
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
 // A reversed rate is SHOWN as 1/rate and inverted again on the way back, and that round-trip
 // loses precision at formatRateValue's six decimals: a stored 10.5 displays as 0.095238 and
 // comes back as 10.5000105. Saving a row nobody edited would therefore nudge the stored rate a
 // little further every time — and, worse for the common case, an untouched reversed row could
 // never compare equal to what is stored, so it would keep paying for a save it doesn't need.
 // When the field still holds the exact string the row was opened with, and nothing else that
 // changes what the rate MEANS has moved, the user didn't touch it: keep the stored value.
 const originalDraft = buildLedgerTransactionDraft(transaction, ledgerAccountId);
 const originalIsOutgoing = transaction.accountFromId === ledgerAccountId;
 const storedRate = originalIsOutgoing ? transaction.exchangeRateFrom : transaction.exchangeRateTo;
 // Direction, account and currency all change what the rate MEANS, so if any of them moved the
 // rate must be re-derived from what the user left in the field. Only when all three are steady
 // can a stored rate legitimately be carried over.
 const rateContextUnchanged =
  draft.direction === originalDraft.direction &&
  draft.ledgerAccountId === originalDraft.ledgerAccountId &&
  draft.currencyId === originalDraft.currencyId;
 const rateUntouched =
  rateContextUnchanged &&
  draft.exchangeRate === originalDraft.exchangeRate &&
  rateIsReversed === (originalIsOutgoing ? !!transaction.exchangeRateFromReversed : !!transaction.exchangeRateToReversed);
 // Flipping the reverse toggle rewrites the draft's rate text to the 6dp inverse (see the
 // toggle in LedgerSection), so `rateUntouched` fails purely because the flag moved — and the
 // save then inverts that truncated text back, nudging the stored rate every time. That is the
 // drift the comment above describes, and a sweep of this project's production data found 16
 // rates carrying it (e.g. 0.8809020436927414, which is 0.8809 after a round-trip).
 //
 // So compare against what we would DISPLAY for the stored rate under the flag now in effect:
 // if the field still holds exactly that, the number itself has not changed, whatever the flag
 // did. An exact string match rather than a tolerance, so a genuine edit — however small — is
 // always honoured.
 const storedRateAsShown = storedRate > 0 ? (rateIsReversed ? formatRateValue(1 / storedRate) : String(storedRate)) : '';
 const rateShownUnchanged = rateContextUnchanged && storedRateAsShown !== '' && draft.exchangeRate.trim() === storedRateAsShown;
 const exchangeRate = rateUntouched || rateShownUnchanged ? storedRate : rateIsReversed ? 1 / rawLedgerRate : rawLedgerRate;
 const commission = parseFloat(draft.commission) || 0;

 // Senderless/receiverless transactions are a legitimate, permanent shape (no counterparty on
 // that side), so the counterparty is never required here — neither for a row that never had
 // one (editing e.g. just the exchange rate must not be blocked by a side that was never meant
 // to be filled in) nor for one being deliberately cleared, which turns the row into a one-sided
 // transaction exactly like clearing it from the transactions table or the details modal does.
 // Only this ledger's own side is mandatory. `originalCounterpartyId` is still needed below to
 // detect a counterparty being ADDED; it uses the transaction's ORIGINAL side relative to this
 // ledger account (not draft.direction), since reversing direction in the draft must not
 // reinterpret which side the original counterparty was already missing from.
 const originalCounterpartyId = originalIsOutgoing ? transaction.accountToId : transaction.accountFromId;
 if (!draft.ledgerAccountId || !amount || draft.currencyId == null) {
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
  charges2: parseFloat(draft.charges2) || 0,
  charges2CurrencyId: draft.currencyId,
  chargesPayer2: draft.chargesPayer2,
  charges2ExchangeRate: 1,
  charges2Description: draft.charges2Description,
  description: draft.description,
  counterParty: draft.counterParty,
  distributionLocationId: draft.distributionLocationId,
  createdAt,
 };
 return { payload };
}

async function onSaveLedgerTransaction(
 transactionId: number,
 ledgerAccountId: number,
 // `overrideReconciliation` is only meaningful with `batch: true` — onSaveAllLedger runs the
 // lock check once for the whole batch and passes its decision down, since each row here skips
 // its own check. A single-row save derives it from its own guard below and ignores this.
 { batch = false, overrideReconciliation = false }: { batch?: boolean; overrideReconciliation?: boolean } = {},
): Promise<boolean> {
 if (!accountingApi) {
  setError(t('error_bridge'));
  return false;
 }

 const draft = getLedgerTransactionDrafts()[getLedgerTransactionDraftKey(transactionId, ledgerAccountId)];
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
 const previousPayload = transactionUpdateSnapshot(transaction);

 // Opening a row for edit and leaving it alone — which is most of what arrowing up and down a
 // column does — used to cost a full round-trip and a `loadData()` refetch per row, plus a
 // possible reconciliation prompt, all to write back values identical to the ones already there.
 // Treat that as a cancel: report success so the caller closes the row and drops the draft, but
 // touch neither the server nor the undo stack, since there is nothing to undo.
 if (isSameTransactionUpdate(payload, previousPayload)) {
  return true;
 }

 if (blockedByPastEditLock([transaction.createdAt, payload.createdAt], Boolean(transaction.isArchived))) {
  return false;
 }

 // Single-row saves check the lock here; batch saves are checked once up-front in
 // onSaveAllLedger (which checks the whole batch at once) to avoid one dialog per row.
 let overrodeLock = overrideReconciliation;
 if (!batch) {
  const lock = await checkLockForEdit(transaction, payload);
  if (!lock.proceed) {
   return false;
  }
  overrodeLock = lock.overrode;
 }

 const pushUndo = () =>
  pushLedgerEditAction({
   // Undo/redo replay an edit the user already confirmed, so they carry that same decision:
   // if the original edit did not override a lock, neither of these may either.
   undo: async () => {
    await accountingApi.updateTransaction({ ...previousPayload, acknowledgeReconciliationOverride: overrodeLock });
    applyTransactionPatch(previousPayload);
    await loadData();
   },
   redo: async () => {
    await accountingApi.updateTransaction({ ...payload, acknowledgeReconciliationOverride: overrodeLock });
    applyTransactionPatch(payload);
    await loadData();
   },
  });

 // Batch saves stay synchronous: onSaveAllLedger fires them all in parallel and needs each
 // row's real outcome to decide which rows may close, so it can't be handed a provisional yes.
 if (batch) {
  try {
   await accountingApi.updateTransaction({ ...payload, acknowledgeReconciliationOverride: overrodeLock });
   setError('');
   applyTransactionPatch(payload);
   pushUndo();
   return true;
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_update'));
   return false;
  }
 }

 // A single-row save doesn't wait for the server. The row's new values are already known — the
 // write is a plain UPDATE of exactly what's in `payload` — so the cache is patched, the row
 // closes, and the request goes out behind it. Waiting bought nothing but the delay the user
 // felt on every save and on every arrow-key step between rows.
 setError('');
 applyTransactionPatch(payload);
 const undoEntry = pushUndo();
 void trackPendingWrite(accountingApi.updateTransaction({ ...payload, acknowledgeReconciliationOverride: overrodeLock }))
  // Resync rather than refetch-per-save: several quick edits (or a run of arrow-key steps)
  // collapse into one refetch once the user pauses, instead of a full workspace reload each.
  .then(() => scheduleWorkspaceResync())
  .catch((e) => {
   // The write never landed, so put the row back the way it was rather than leaving the
   // optimistic values on screen as though they had been saved, and take its undo entry back
   // off the stack. loadData() re-reads the server's actual state, which is the only thing
   // that can be trusted after a failure.
   applyTransactionPatch(previousPayload);
   dropLedgerEditAction(undoEntry);
   setError(e instanceof Error ? e.message : t('error_failed_update'));
   void loadData();
  });
 return true;
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
  if (!getLedgerTransactionDrafts()[draftKey]) {
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

 // One up-front lock check for the whole batch (the per-row saves below pass `batch`, so
 // they don't each prompt). Builds the same updated record each row's real save would
 // write and warns once, only if some row's edit actually moves a reconciled balance
 // (not merely because the row sits at/before a lock line — see `useReconciliationLocks`).
 const edits: Array<{ oldTx: Transaction; newPayload: TransactionUpdateInput }> = [];
 for (const key of keys) {
  const [txIdStr, accIdStr] = key.split(':');
  const transactionId = parseInt(txIdStr, 10);
  const accId = parseInt(accIdStr, 10);
  const draft = getLedgerTransactionDrafts()[key];
  if (!draft) continue;
  const tx = transactions.find((t) => t.id === transactionId);
  if (!tx) continue;
  const built = buildLedgerTransactionUpdate(transactionId, accId, draft, tx);
  if ('error' in built) continue;
  // A row nobody touched writes nothing (see onSaveLedgerTransaction), so it must not weigh in
  // on whether this batch needs a reconciliation warning either.
  if (isSameTransactionUpdate(built.payload, transactionUpdateSnapshot(tx))) continue;
  edits.push({ oldTx: tx, newPayload: built.payload });
 }
 const batchLock = await checkLockForBatchEdit(edits);
 if (!batchLock.proceed) {
  return;
 }

 // Fire all saves in parallel so 100+ rows finish in one round-trip batch rather than sequentially.
 // Each save applies its optimistic patch, so the table is already up to date here.
 const results = await Promise.all(
  keys.map(async (key) => {
   const [txIdStr, accIdStr] = key.split(':');
   const ok = await onSaveLedgerTransaction(parseInt(txIdStr, 10), parseInt(accIdStr, 10), { batch: true, overrideReconciliation: batchLock.overrode });
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
 if (!getLedgerTransactionDrafts()[draftKey]) {
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
 if (transaction && !getLedgerTransactionDrafts()[rowKey]) {
  const isOutgoing = transaction.accountFromId === ledgerAccountId;
  setLedgerRateReversed((prev) => ({
   ...prev,
   ...(isOutgoing ? (transaction.exchangeRateFromReversed ? { [rowKey]: true } : {}) : transaction.exchangeRateToReversed ? { [rowKey]: true } : {}),
  }));
  setLedgerTransactionDrafts((prev) => ({ ...prev, [rowKey]: buildLedgerTransactionDraft(transaction, ledgerAccountId) }));
 }
 setEditingLedgerRowKeys((prev) => new Set([...prev, rowKey]));
}

function onLedgerEditFieldSideKey(event: LedgerEditFieldKeyEvent, field: LedgerEditFieldKey, entry: ClientLedgerEntry, ledgerAccountId: number): boolean {
 if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return false;
 const input = event.currentTarget;
 // A date field owns ←/→ for its own day/month/year segments, and has no text selection to read
 // (the selectionStart getter throws on it), so there is no "caret at the edge" to hand over on.
 if (input.type === 'date') return false;
 const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
 const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
 if ((event.key === 'ArrowLeft' && !atStart) || (event.key === 'ArrowRight' && !atEnd)) return false;

 const editableFieldOrder = orderedLedgerColumnOptions
  .map((column) => column.key)
  .filter((key): key is LedgerEditFieldKey => (LEDGER_EDIT_FIELD_KEYS as readonly string[]).includes(key));
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
  // Same reason as the date guard above, from the other side: placing a caret in a date field
  // throws rather than doing nothing, so it is landed on as a whole instead.
  if (target.type !== 'date') {
   const pos = event.key === 'ArrowRight' ? 0 : target.value.length;
   target.setSelectionRange(pos, pos);
  }
 }
 return true;
}

function onLedgerEditFieldArrowKey(
 event: LedgerEditFieldKeyEvent,
 field: LedgerEditFieldKey,
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
  if (!target) return false;
  target.focus();
  target.select?.();
  return true;
 };
 if (editingLedgerRowKeys.has(neighborKey)) {
  focusNeighborField();
  return;
 }
 // Focus has to reach the neighbour's input INSIDE this keydown, before the browser is free to
 // dispatch another key. Opening the row normally and focusing from a setTimeout left a real gap
 // — the save closes this row a microtask later, which unmounts the input the user is typing in
 // and drops focus to <body>, while the neighbour's input isn't focused until the timer runs
 // after two full re-renders of the table (~100ms here, longer on a big ledger). Everything
 // typed in that window went to <body> and was silently lost, so a fast "type, arrow down, type"
 // run left rows looking untouched and then jumping to half-typed values as the focus caught up.
 // flushSync mounts the neighbour's inputs now, so the focus move is part of this same task and
 // no keystroke can slip in between.
 flushSync(() => openLedgerRowForEdit(neighbor, ledgerAccountId));
 // Only if the row somehow didn't render (nothing to focus) is a deferred retry worth it: once
 // focus has landed, a second focus()+select() would re-select whatever the user has typed since
 // and let the next character wipe it.
 if (!focusNeighborField()) setTimeout(focusNeighborField, 0);
 void onSaveLedgerRow(entry.transactionId, ledgerAccountId);
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
 const anchorTransactionId = entry.transactionId;
 const ledger = selectedClientLedgers.find((l) => l.accountId === ledgerAccountId);
 const anchorIdx = ledger?.entries.findIndex((e) => e.transactionId === anchorTransactionId) ?? -1;
 // Fixed, immutable membership snapshot: every transaction id at-or-before this row right now,
 // captured once so the lock is independent of any row's later live position — reordering rows
 // within this set (even this anchor row itself) never needs to touch this record again.
 const lockedTransactionIds = anchorIdx >= 0 ? ledger!.entries.slice(0, anchorIdx + 1).map((e) => e.transactionId) : [anchorTransactionId];
 const anchorDate = entry.createdAt.slice(0, 10);
 try {
  const created = await accountingApi.createReconciliation({
   accountId: ledgerAccountId,
   anchorTransactionId,
   anchorDate,
   balance: entry.runningBalance,
   note: '',
   lockedTransactionIds,
  });
  setReconciliations((prev) => [
   ...prev,
   { id: created.id, accountId: ledgerAccountId, anchorTransactionId, anchorDate, lockedTransactionIds, balance: entry.runningBalance, note: '', createdAt: new Date().toISOString() },
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

// Dismisses a rate/commission anomaly badge, or a pending-exchange-rate warning-list entry
// (see ledgerAnomalies.ts), the user reviewed and judged fine — shared workspace-wide, so it
// stops flagging for every member, not just the one who ignored it. `accountId` is which side
// of the transaction this applies to.
async function onIgnoreAnomaly(kind: 'rate' | 'commission' | 'pendingRate', transactionId: number, accountId: number, reason?: string, description?: string) {
 const message = reason ? `${reason}\n\n${t('ignore_anomaly_confirm')}` : t('ignore_anomaly_confirm');
 // A rate flag on a described row offers a third answer: accept this rate as normal for every row
 // carrying that description. That is the only way a small group ever stops being flagged — it can
 // never reach the sample count needed to form a reference of its own. The offer is explicit
 // rather than inferred, because it changes how OTHER rows are judged, and it teaches rather than
 // exempts: a row in the group at a genuinely wrong rate still flags (see buildAcceptedRates).
 const groupLabel = kind === 'rate' ? (description ?? '').trim() : '';
 let scope: 'row' | 'description' = 'row';
 if (groupLabel) {
  const answer = await choiceDialog({
   message: `${message}\n\n${t('ignore_anomaly_scope_hint', { description: groupLabel })}`,
   choices: [
    { key: 'row', label: t('ignore_anomaly_scope_row') },
    { key: 'description', label: t('ignore_anomaly_scope_description', { description: groupLabel }) },
   ],
  });
  if (answer !== 'row' && answer !== 'description') return;
  scope = answer;
 } else if (!(await confirmDialog({ message, confirmText: t('ignore_anomaly_confirm_button') }))) {
  return;
 }
 try {
  const created = await accountingApi.createIgnoredAnomaly({ kind, transactionId, accountId, scope });
  if (created.id != null) {
   setIgnoredAnomalies((prev) => [...prev, { id: created.id as number, kind, transactionId, accountId, scope, createdAt: new Date().toISOString() }]);
  }
  setError('');
  await loadData();
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_save'));
 }
}

// Puts a dismissed warning back. The ignore confirmation has always promised this ("it won't be
// flagged again unless you un-ignore it later") but there was no way to actually do it: the row
// stopped being flagged and nothing recorded that a judgement had been made, so an ignore fired
// by mistake — or one whose reasoning stopped holding — was permanent. Workspace-wide, matching
// the ignore itself.
async function onRestoreIgnoredAnomaly(kind: 'rate' | 'commission' | 'pendingRate', transactionId: number, accountId: number) {
 const ignored = ignoredAnomalies.find((entry) => entry.kind === kind && entry.transactionId === transactionId && entry.accountId === accountId);
 if (!ignored) return;
 try {
  await accountingApi.deleteIgnoredAnomaly(ignored.id);
  setIgnoredAnomalies((prev) => prev.filter((entry) => entry.id !== ignored.id));
  setError('');
  await loadData();
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_delete'));
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
 if (!accountingApi) {
  setError(t('error_bridge'));
  return;
 }
 const keys = [...selectedLedgerEntryKeys];
 const transactionIds: number[] = [];
 const rowsToDelete: Array<{ accountFromId: number | null; accountToId: number | null; createdAt: string; id: number }> = [];
 for (const key of keys) {
  const [txIdStr, accIdStr] = key.split(':');
  const txId = Number(txIdStr);
  const accId = Number(accIdStr);
  const ledger = selectedClientLedgers.find((l) => l.accountId === accId);
  const entry = ledger?.entries.find((e) => e.transactionId === txId);
  if (!entry) continue;
  const tx = transactions.find((t) => t.id === txId);
  if (!tx) continue;
  transactionIds.push(txId);
  rowsToDelete.push({ accountFromId: tx.accountFromId, accountToId: tx.accountToId, createdAt: tx.createdAt, id: tx.id });
 }
 if (!transactionIds.length) return;

 // One batch dialog for the whole selection, same pattern as the transactions table's own
 // bulk delete — not one dialog per locked row.
 const deleteLock = await checkLockForBatchDelete(rowsToDelete, 'transactions_delete_selected_confirm', { count: transactionIds.length });
 if (!deleteLock.proceed) {
  return;
 }

 try {
  await accountingApi.deleteTransactionsBulk({ transactionIds, acknowledgeReconciliationOverride: deleteLock.overrode });
  setSelectedLedgerEntryKeys(new Set());
  setError('');
  await loadData();
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_delete'));
 }
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

 // What this move does to every ✓ it can reach.
 //
 // A ✓'s balance is the sum of the rows above it, so a reorder can only move it by changing
 // WHICH rows those are. Swapping two rows that both sit between the same pair of ✓ lines —
 // or both above, or both below — leaves every set identical and every agreed balance exactly
 // where it was, so nothing is reported and the drag proceeds in silence. That is nearly every
 // drag, and interrupting it would be wrong.
 //
 // The reach is wider than the ledger on screen: re-timing a row also moves it inside the
 // COUNTERPARTY's ledger, which is reconciled independently, so a drag here can shift a ✓ the
 // user cannot see. Those are checked too and named by client, since an unnamed figure from
 // another ledger would be impossible to place.
 //
 // Re-pointing a ✓ is also what MAKES a crossing move possible: the ledger orders by reconciled
 // depth before createdAt (see computeClientLedgers), deliberately, so a row with a stray
 // timestamp cannot drift above a ✓ on its own. Moving the line with the row is the honest
 // expression of "this row now stands above the agreed balance", and leaves that protection
 // intact for rows nobody dragged.
 const reflowedTransactions = transactions.map((tx) => {
  const rescheduled = newTimes.get(`${tx.id}:${accountId}`);
  return rescheduled ? { ...tx, createdAt: rescheduled } : tx;
 });
 const ledgerEntriesFor = (targetAccountId: number, source: Transaction[]) => {
  const owner = clientAccountMap.get(targetAccountId);
  if (!owner) return null;
  return (
   computeClientLedgers({
    selectedClientForLedger: { id: owner.clientId },
    section: 'client-ledger',
    pdfExportModal: null,
    clientAccounts,
    transactions: source,
    reconciliations,
    clientAccountMap,
    currencyMap,
    enabled: true,
   }).find((l) => l.accountId === targetAccountId)?.entries ?? null
  );
 };

 const proposedEntries = (() => {
  const reordered = [...currentOrder];
  const groupPositions = currentOrder.flatMap((key, index) => (dateOf(key) === targetDate ? [index] : []));
  groupPositions.forEach((position, i) => {
   reordered[position] = next[i];
  });
  return reordered.flatMap((key) => {
   const entry = entryMap.get(key);
   return entry ? [entry] : [];
  });
 })();

 // Every account a reflowed row touches, this ledger's own first so its ✓ leads the list.
 // Counterparty accounts with no reconciliation at all are dropped straight away: they have no
 // ✓ to move, and each one kept would otherwise cost two full ledger computations on drop.
 const reconciledAccountIds = new Set(reconciliations.map((r) => r.accountId));
 const touchedAccountIds = new Set<number>([accountId]);
 for (const key of newTimes.keys()) {
  const entry = entryMap.get(key);
  const tx = entry ? transactions.find((t) => t.id === entry.transactionId) : null;
  for (const side of [tx?.accountFromId, tx?.accountToId]) {
   if (side && reconciledAccountIds.has(side)) touchedAccountIds.add(side);
  }
 }

 const changedMarks: Array<{ accountId: number; id: number; from: number; to: number; lockedTransactionIds: number[] }> = [];
 for (const touchedAccountId of touchedAccountIds) {
  const before = touchedAccountId === accountId ? ledger.entries : ledgerEntriesFor(touchedAccountId, transactions);
  const after = touchedAccountId === accountId ? proposedEntries : ledgerEntriesFor(touchedAccountId, reflowedTransactions);
  if (!before || !after) continue;
  for (const change of marksAffectedByReorder(before, after)) {
   changedMarks.push({ accountId: touchedAccountId, ...change });
  }
 }

 if (changedMarks.length > 0) {
  const confirmed = await confirmDialog({
   title: t('reconcile_warn_title'),
   message: t('reconcile_reorder_changes_balance'),
   balanceChanges: changedMarks.map((change) => ({
    // The ledger being looked at needs no introduction; any other one does.
    label: change.accountId === accountId ? undefined : lockAccountLabel(change.accountId),
    from: formatLockBalance(change.accountId, change.from),
    to: formatLockBalance(change.accountId, change.to),
    fromNegative: change.from < 0,
    toNegative: change.to < 0,
   })),
   note: t('reconcile_reorder_changes_balance_note'),
   confirmText: t('reconcile_warn_confirm'),
   tone: 'danger',
  });
  if (!confirmed) return;
 }

 // Reconciliation guard: the reflow rewrites createdAt for every row in the date group — not
 // just the ones dragged — and each of those transactions touches up to two accounts (this
 // ledger's own account and its counterparty), either of which may independently be
 // reconciled. Re-time each affected transaction through the same balance-aware check a
 // direct edit uses. Under the frozen anchorDate/lockedTransactionIds model this can only
 // ever produce a hit if a row's CALENDAR DAY changes, which a same-day reflow never does —
 // so in practice a pure same-day reorder is always silent, including for the anchor's own
 // row — but every reflowed row (not just the explicitly dragged ones) is still checked as a
 // structural safety net, one dialog for the whole batch.
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

 // Routed through the shared warning so every reconciliation dialog in the app reads the same
 // and names the account it is about — which for a drag is frequently the counterparty's.
 if (dragLockHit && !(await warnLockHit(dragLockHit)).proceed) {
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
    charges2: tx.charges2,
    charges2CurrencyId: tx.charges2CurrencyId,
    chargesPayer2: tx.chargesPayer2,
    charges2ExchangeRate: tx.charges2ExchangeRate,
    charges2Description: tx.charges2Description,
    description: tx.description,
    counterParty: tx.counterParty,
    distributionLocationId: tx.distributionLocationId,
    createdAt: newCreatedAt,
    // Non-null only when this drag actually moves a reconciled balance and the user confirmed
    // it above (either guard) — otherwise the server still checks.
    acknowledgeReconciliationOverride: Boolean(dragLockHit) || changedMarks.length > 0,
   });
  }

  // Only after every row write landed, so a ✓ is never re-pointed at an order that failed
  // to save half way through.
  for (const mark of changedMarks) {
   await accountingApi.updateReconciliation({ id: mark.id, balance: mark.to, lockedTransactionIds: mark.lockedTransactionIds });
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
// to explicitly acknowledge before export proceeds. Mirrors the checkLockForNewRow pattern.
async function confirmIfLedgerAnomalies(entries: ClientLedgerEntry[], ledgerCurrencyCode: string, accountId: number): Promise<boolean> {
 // The badges and this gate are separately switchable: a workspace can want the quiet in-page
 // hints without an interruption on the way out, or the reverse. The checks below would return
 // nothing anyway when the engine is off, but returning early keeps the intent explicit.
 if (!reviewSettings.enabled || !reviewSettings.warnOnExport) return true;
 const rateSamples = buildRateSamples(transactions, reviewSettings);
 const commissionSamples = buildCommissionSamples(transactions, reviewSettings);
 const flaggedRates = entries
  .map((entry) => ({ entry, anomaly: checkLedgerEntry(entry, ledgerCurrencyCode, rateSamples) }))
  .filter((x): x is { entry: ClientLedgerEntry; anomaly: NonNullable<typeof x.anomaly> } => x.anomaly != null)
  .map(({ entry, anomaly }) => `${formatDateValue(entry.createdAt, pdfSettings.dateFormat)} · ${entry.description || entry.counterpartyName} — ${t('ledger_anomaly_entered')}: ${formatRateValue(anomaly.enteredRate)}, ${t('ledger_anomaly_expected')}: ~${formatRateValue(anomaly.referenceRate)}`);
 const flaggedCommissions = entries
  .map((entry) => ({ entry, anomaly: checkLedgerEntryCommission(entry, accountId, commissionSamples) }))
  .filter((x): x is { entry: ClientLedgerEntry; anomaly: NonNullable<typeof x.anomaly> } => x.anomaly != null)
  .map(({ entry, anomaly }) => {
   const head = `${formatDateValue(entry.createdAt, pdfSettings.dateFormat)} · ${entry.description || entry.counterpartyName} — ${t('ledger_anomaly_entered')}: ${anomaly.enteredCommission}%`;
   // 'implausible' has no reference history to quote (see CEILING_PERCENTILE), so the line states
   // the ceiling it broke rather than an "expected" value that was never observed. The other
   // reasons all quote a real prior value, whichever scope it came from, so one line serves them.
   return anomaly.reason === 'implausible'
    ? `${head}, ${t('ledger_anomaly_commission_implausible_export', { expected: formatRateValue(anomaly.referenceCommission) })}`
    : `${head}, ${t('ledger_anomaly_expected')}: ~${formatRateValue(anomaly.referenceCommission)}%`;
  });
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
  onSubmitOneSidedTransaction,
  onPasteIntoOneSidedTransaction,
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
  onRestoreIgnoredAnomaly,
  onToggleLedgerEntrySelection,
  onDeleteSelectedLedgerEntries,
  onEditSelectedLedgerEntries,
  onLedgerRowDrop,
  onExportLedgerPdf,
  onExportLedgerExcel,
  combinedLedgerHistory,
 };
}
