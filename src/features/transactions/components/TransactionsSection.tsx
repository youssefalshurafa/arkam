'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ChangeEvent, FormEvent, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from 'react';
import { usePointerDrag } from '@/shared/hooks/usePointerDrag';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTheme } from '@/contexts/ThemeContext';
import { resolveHighlightBg } from '@/shared/utils/highlightColor';
import { useTranslation } from '@/hooks/useTranslation';
import { panelClassName, tableWrapClassName, seamlessInputClassName, seamlessSelectClassName, editingRowRingClassName } from '@/shared/styles';
import { SkTablePanel, SK_TX } from '@/shared/components/skeletons/Skeletons';
import { TableZoomControl } from '@/shared/components/TableZoomControl';
import { saveArchiveFilter, saveTableZoom, saveTxFilter } from '@/shared/lib/localStorage';
import { formatAmountInput, normalizeDecimalInput, normalizePlainDecimalInput } from '@/shared/utils/decimal';
import { formatRateValue, highlightPenCursor, ledgerSelectWidth, ltrIsolate } from '@/shared/utils/format';
import { transactionTypeLabelKey } from '@/shared/utils/transactionType';
import { formatDateValue, localDateKey, isBeforeToday } from '@/shared/utils/date';
import { useAppStatusStore } from '@/shared/store/appStatusStore';
import { ContextMenu, useContextMenu } from '@/shared/components/ContextMenu';
import ChargesEditFields from '@/shared/components/ChargesEditFields';
import EditableField from '@/shared/components/EditableField';
import type { DraftHistory } from '@/shared/hooks/useDraftHistory';
import { useTransactionsStore, type ArchiveExportModalState } from '@/features/transactions/store/transactionsStore';
import { useLongPress } from '@/shared/hooks/useLongPress';
import { useDescriptionSuggestions } from '@/shared/hooks/useDescriptionSuggestions';
import { DescriptionSuggestField } from '@/shared/components/DescriptionSuggestField';
import AccountSearchSelect from '@/features/transactions/components/AccountSearchSelect';
import ArchiveExportModal from '@/features/transactions/components/ArchiveExportModal';
import NewTransactionForm from '@/features/transactions/components/NewTransactionForm';
import { filterRealClientAccounts } from '@/shared/utils/systemAccounts';
import { anomalyKey, type FlaggedAnomaly } from '@/features/ledger/utils/ledgerAnomalies';
import type {
 Client,
 ClientAccount,
 Currency,
 Section,
 Transaction,
 TransactionTableDraft,
 TransactionTableRow,
 TransactionUpdateInput,
} from '@/shared/types';

type CurrencyTotal = { code: string; symbol: string; total: number };
type SumCurrencyTotal = CurrencyTotal & { count: number };

// Numeric fields force dir="ltr" regardless of page language (see the amount/charges/
// commission/exchangeRate inputs); free-text fields (description) have no explicit dir and
// follow the page's direction. A field's own effective direction — not the physical key —
// decides which end of its text counts as "start" for caret-boundary purposes.
function isFieldRTL(field: HTMLInputElement, pageIsRTL: boolean): boolean {
 return field.dir === 'rtl' || (field.dir !== 'ltr' && pageIsRTL);
}

// Whether pressing `key` moves the caret toward the logical start of the field's text: in an
// ltr field physical Left does; in an rtl field (text runs right-to-left) physical Right does.
function keyMeansCaretToStart(fieldIsRTL: boolean, key: 'ArrowLeft' | 'ArrowRight'): boolean {
 return fieldIsRTL ? key === 'ArrowRight' : key === 'ArrowLeft';
}

// Arrow left/right while editing a row: move focus to the neighbouring editable field, in the
// row's actual DOM order. For text inputs this only triggers at the start or end of the value
// (relative to that field's own direction) so the caret can still be moved within the text
// normally; date inputs are left alone entirely since the browser uses left/right to move
// between their own day/month/year segments; selects have no native left/right behavior so
// they always move. Under RTL the row's visual column order is mirrored (same DOM order,
// flipped rendering), so which physical key means "next column" flips too.
function focusAdjacentRowField(event: React.KeyboardEvent<HTMLTableRowElement>, pageIsRTL: boolean) {
 if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
 const target = event.target;
 if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) return;
 if (target instanceof HTMLInputElement) {
  if (target.type === 'checkbox' || target.type === 'date') return;
  try {
   const wantStart = keyMeansCaretToStart(isFieldRTL(target, pageIsRTL), event.key);
   const boundaryPos = wantStart ? 0 : target.value.length;
   if (target.selectionStart !== boundaryPos || target.selectionEnd !== boundaryPos) return;
  } catch {
   /* input type doesn't support text selection (shouldn't happen for the types used here) */
  }
 }

 const row = event.currentTarget;
 const focusables = Array.from(row.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input:not([type="checkbox"]), select')).filter((node) => !node.disabled);
 const idx = focusables.indexOf(target);
 if (idx === -1) return;
 const forward = event.key === 'ArrowRight' ? 1 : -1;
 const step = pageIsRTL ? -forward : forward;
 const next = focusables[idx + step];
 if (!next) return;

 event.preventDefault();
 next.focus();
 if (next instanceof HTMLInputElement && next.type !== 'date') {
  const wantStart = keyMeansCaretToStart(isFieldRTL(next, pageIsRTL), event.key);
  const pos = wantStart ? 0 : next.value.length;
  try {
   next.setSelectionRange(pos, pos);
  } catch {
   /* input type doesn't support text selection */
  }
 }
}

type TransactionsSectionProps = {
 isLoading: boolean;
 section: Section;
 clients: Client[];
 clientAccounts: ClientAccount[];
 enabledCurrencies: Currency[];
 transactions: Transaction[];
 clientAccountMap: Map<number, ClientAccount>;
 currencyMap: Map<number, Currency>;
 displayedTransactionRows: TransactionTableRow[];
 paginatedTransactions: TransactionTableRow[];
 transactionsPager: ReactNode;
 txFilterClientOptions: string[];
 visibleTransactionColumnCount: number;
 selectedTransactionSums: CurrencyTotal[];
 archiveCurrencyTotals: CurrencyTotal[];
 workspaceAnomalies: FlaggedAnomaly[];
 getTransactionTableDraft: (transactionId: number) => TransactionTableDraft | null;
 updateTransactionTableDraft: (transactionId: number, nextValues: Partial<TransactionTableDraft>) => void;
 txTableHistory: DraftHistory;
 highlightedTxRows: Map<number, string>;
 txRowClickHighlight: boolean;
 txRowClickActive: boolean;
 txRowHighlightColor: string;
 txSumMode: boolean;
 txSumSelection: Set<number>;
 txSumByCurrency: SumCurrencyTotal[];
 transactionsImportInputRef: RefObject<HTMLInputElement | null>;
 onCancelAllTransactions: () => void;
 onCopyTransactionRow: (row: TransactionTableRow) => void;
 onDeleteSelectedTransactions: () => void;
 onDeleteTransactionTableRow: (row: TransactionTableRow) => void;
 onToggleTransactionArchiveHidden: (row: TransactionTableRow) => void;
 onEditAllTransactions: () => void;
 onExportArchivePdf: (range?: ArchiveExportModalState) => void;
 openArchiveExportModal: () => void;
 onImportTransactionsFile: (event: ChangeEvent<HTMLInputElement>) => void;
 onPasteCopiedTransaction: () => void;
 onEditTransactionInForm: (row: TransactionTableRow) => void;
 onCancelEditTransaction: () => void;
 onArchiveEntrySubmit: (event: FormEvent<HTMLFormElement>) => void;
 onEditArchiveEntryInForm: (row: TransactionTableRow) => void;
 onCancelArchiveEntryEdit: () => void;
 onSaveAllTransactions: () => void;
 onSaveTransactionTableRow: (transactionId: number, opts?: { skipReload?: boolean }) => void;
 onToggleSelectAllTransactions: () => void;
 onToggleTransactionSelection: (transactionId: number) => void;
 onTransactionRowDrop: (draggedIds: number[], targetId: number, dropHalf: 'top' | 'bottom') => void;
 onTransactionSubmit: (event: FormEvent<HTMLFormElement>, onCreated?: () => void) => void;
 openClientLedger: (client: Client, origin?: 'clients' | 'organization-clients', accountId?: number | null) => void;
 openTransactionExportModal: () => void;
 openTransactionTableSettingsModal: () => void;
 setTxRowClickMode: (mode: 'highlight' | 'copy' | 'none') => void;
 toggleTxRowHighlight: (txnId: number) => void;
 toggleTxSumMode: () => void;
 toggleTxSumEntry: (id: number) => void;
 lockPastEditsEnabled: boolean;
 onUpdateTransactionFields: (transactionId: number, patch: Partial<TransactionUpdateInput>) => void | Promise<void>;
};

export default function TransactionsSection(props: TransactionsSectionProps) {
 const {
  isLoading, section, clients, clientAccounts, enabledCurrencies, transactions, clientAccountMap, currencyMap,
  displayedTransactionRows, paginatedTransactions, transactionsPager, txFilterClientOptions, visibleTransactionColumnCount,
  selectedTransactionSums, archiveCurrencyTotals, workspaceAnomalies,
  getTransactionTableDraft, updateTransactionTableDraft, txTableHistory, highlightedTxRows, txRowClickHighlight, txRowClickActive, txRowHighlightColor,
  txSumMode, txSumSelection, txSumByCurrency,
  transactionsImportInputRef, onCancelAllTransactions, onCopyTransactionRow, onDeleteSelectedTransactions,
  onDeleteTransactionTableRow, onToggleTransactionArchiveHidden, onEditAllTransactions, onExportArchivePdf, openArchiveExportModal, onImportTransactionsFile, onPasteCopiedTransaction, onEditTransactionInForm, onCancelEditTransaction,
  onArchiveEntrySubmit, onEditArchiveEntryInForm, onCancelArchiveEntryEdit,
  onSaveAllTransactions, onSaveTransactionTableRow, onToggleSelectAllTransactions, onToggleTransactionSelection,
  onTransactionRowDrop, onTransactionSubmit, openClientLedger, openTransactionExportModal, openTransactionTableSettingsModal,
  setTxRowClickMode, toggleTxRowHighlight, toggleTxSumMode, toggleTxSumEntry, lockPastEditsEnabled, onUpdateTransactionFields,
 } = props;
 const { language, isRTL } = useLanguage();
 const isDark = useTheme().resolvedTheme === 'dark';
 const { t } = useTranslation(language);
 // French uses 'en-US' grouping (comma thousands, period decimal) instead of the
 // official fr-FR narrow-no-break-space separator, which renders as near-invisible.
 const numLocale = language === 'fr' ? 'en-US' : language;
 const showToast = useAppStatusStore((s) => s.showToast);
 // Right-click row actions (Edit/Delete) — replaces the row's icon-button cluster with a
 // single context menu when not editing.
 const rowContextMenu = useContextMenu();
 // Toolbar gear button: opens Import/Export/Table Settings as a dropdown instead of three
 // separate icon buttons.
 const gearMenu = useContextMenu();
 // Alert next to the bulk-select button: lists today's transactions still missing a sender
 // or receiver, so they don't quietly sit unnoticed in the main list until someone happens
 // to open the Archive section.
 const missingCounterpartyMenu = useContextMenu();
 const missingCounterpartyToday = useMemo(() => {
  if (section !== 'transactions') return [];
  const today = localDateKey();
  return transactions.filter((txn) => !txn.isArchived && txn.type !== 'adjustment' && (!txn.accountFromId || !txn.accountToId) && !txn.counterParty?.trim() && txn.createdAt.slice(0, 10) === today);
 }, [transactions, section]);
 // Alert next to the same button: workspace-wide rate/commission anomaly badges (see
 // ledgerAnomalies.ts) that haven't been reviewed and dismissed yet. Clicking an item jumps
 // to that entry's client ledger, where the actual badge (and its "ignore" action) lives.
 const anomalyReviewMenu = useContextMenu();
 const clientMap = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);
 const { selectedTransactionIds, setSelectedTransactionIds, editingRowIds, setEditingRowIds, isEditAllTransactions, dragRowId, setDragRowId, dragOverRowId, setDragOverRowId, dragOverHalf, setDragOverHalf, transactionTableSettings: transactionTableSettingsStore, archiveTableSettings, txSortDir, setTxSortDir, txFilterOpen, setTxFilterOpen, txFilterSearch, setTxFilterSearch, txFilterWholeWord, setTxFilterWholeWord, txFilterClient, setTxFilterClient, txFilterDateFrom, setTxFilterDateFrom, txFilterDateTo, setTxFilterDateTo, txFilterHideExpenses, setTxFilterHideExpenses, archiveFilterOpen, setArchiveFilterOpen, archiveFilterSearch, setArchiveFilterSearch, archiveFilterWholeWord, setArchiveFilterWholeWord, archiveFilterClient, setArchiveFilterClient, archiveFilterDateFrom, setArchiveFilterDateFrom, archiveFilterDateTo, setArchiveFilterDateTo, archiveFilterHideExpenses, setArchiveFilterHideExpenses, archiveFilterShowHidden, setArchiveFilterShowHidden, commissionExpandedTxns, setCommissionExpandedTxns, expensesExpandedTxns, setExpensesExpandedTxns, isNewTransactionSectionOpen, setIsNewTransactionSectionOpen, isNewArchiveSectionOpen, setIsNewArchiveSectionOpen, editingTransaction, transactionTableDrafts, isSubmittingTransaction, copiedTransaction, tableRateFromReversed, setTableRateFromReversed, tableRateToReversed, setTableRateToReversed, isImportingTransactions, setInfoTransactionId, archiveEntryForm, setArchiveEntryForm, editingArchiveEntry, newArchiveEntryDate, setNewArchiveEntryDate, isSubmittingArchiveEntry, tableZoom, setTableZoom } = useTransactionsStore();
 // Archive keeps its own column-visibility/date-format settings, separate from the
 // Transactions table (see transactionsStore.ts) — resolve whichever is active here so
 // every downstream read of `transactionTableSettings` in this file is section-aware.
 const transactionTableSettings = section === 'archive' ? archiveTableSettings : transactionTableSettingsStore;
 // Archive keeps its own collapse flag (defaults closed — creating an archived transaction
 // is rare) so it doesn't inherit the Transactions form's open state when switching sections.
 const newSectionOpen = section === 'archive' ? isNewArchiveSectionOpen : isNewTransactionSectionOpen;
 const setNewSectionOpen = section === 'archive' ? setIsNewArchiveSectionOpen : setIsNewTransactionSectionOpen;
 // Archive keeps its own search/date/client filter bar too (see archiveFilter* in
 // transactionsStore.ts) — resolve whichever is active so the two pages never show or share
 // each other's search term/date range.
 const isArchiveSection = section === 'archive';
 const filterOpen = isArchiveSection ? archiveFilterOpen : txFilterOpen;
 const setFilterOpen = isArchiveSection ? setArchiveFilterOpen : setTxFilterOpen;
 const filterSearch = isArchiveSection ? archiveFilterSearch : txFilterSearch;
 const setFilterSearch = isArchiveSection ? setArchiveFilterSearch : setTxFilterSearch;
 const filterWholeWord = isArchiveSection ? archiveFilterWholeWord : txFilterWholeWord;
 const setFilterWholeWord = isArchiveSection ? setArchiveFilterWholeWord : setTxFilterWholeWord;
 const filterClient = isArchiveSection ? archiveFilterClient : txFilterClient;
 const setFilterClient = isArchiveSection ? setArchiveFilterClient : setTxFilterClient;
 const filterDateFrom = isArchiveSection ? archiveFilterDateFrom : txFilterDateFrom;
 const setFilterDateFrom = isArchiveSection ? setArchiveFilterDateFrom : setTxFilterDateFrom;
 const filterDateTo = isArchiveSection ? archiveFilterDateTo : txFilterDateTo;
 const setFilterDateTo = isArchiveSection ? setArchiveFilterDateTo : setTxFilterDateTo;
 const filterHideExpenses = isArchiveSection ? archiveFilterHideExpenses : txFilterHideExpenses;
 const setFilterHideExpenses = isArchiveSection ? setArchiveFilterHideExpenses : setTxFilterHideExpenses;
 // Persist the search/date filter bar so it survives a refresh and follows the user to
 // another device (see saveTxFilter/saveArchiveFilter in shared/lib/localStorage.ts) — each
 // section under its own storage key so they never overwrite each other.
 useEffect(() => {
  const filter = { search: filterSearch, wholeWord: filterWholeWord, dateFrom: filterDateFrom, dateTo: filterDateTo };
  if (isArchiveSection) saveArchiveFilter(filter);
  else saveTxFilter(filter);
 }, [isArchiveSection, filterSearch, filterWholeWord, filterDateFrom, filterDateTo]);
 // When a row is loaded into the form for editing, bring the form into view.
 const editFormRef = useRef<HTMLDivElement | null>(null);
 const transactionFormRef = useRef<HTMLFormElement | null>(null);
 const archiveEntryFormRef = useRef<HTMLFormElement | null>(null);
 const editingId = editingTransaction?.id;
 useEffect(() => {
  if (editingId != null) editFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
 }, [editingId]);
 // True archive entries (never touch a ledger) use the small independent ArchiveEntryForm
 // fields below; an incomplete-but-real transaction surfaced on the Archive page (missing a
 // party) is still edited with the full Transaction form — see openRowMenu's isArchived routing.
 const isArchiveEntryMode = section === 'archive' && !editingTransaction;

 // Shared by the row's onContextMenu (desktop right-click) and its visible "⋮" button
 // (touch devices have no right-click event to hook into). contextMenuRowId drives a
 // border on whichever row the open menu belongs to, so it's clear which row the menu's
 // actions apply to; closeRowMenu clears it alongside the menu itself.
 const [contextMenuRowId, setContextMenuRowId] = useState<number | null>(null);
 // iOS Safari has no equivalent of Android's long-press-fires-contextmenu behavior, so the
 // row menu is otherwise unreachable by touch-and-hold on iPhone — see useLongPress.ts.
 const rowLongPress = useLongPress();

 // Selection mode: the per-row select checkboxes stay hidden until the user opts in via
 // the toolbar "Select" toggle. Turning it off also clears any current selection so a
 // stale set doesn't linger (and keep the bulk-delete button showing) after exiting.
 const [selectionMode, setSelectionMode] = useState(false);
 const toggleSelectionMode = () => {
  setSelectionMode((on) => {
   if (on) setSelectedTransactionIds(new Set());
   return !on;
  });
 };

 const openRowMenu = (event: ReactMouseEvent, txn: TransactionTableRow) => {
  if (editingRowIds.has(txn.id)) return;
  // Archived rows are exempt (see db.js's createTransaction comment) — only a real,
  // balance-affecting row locks its Edit/Delete actions.
  const rowLocked = lockPastEditsEnabled && !txn.isArchived && isBeforeToday(txn.createdAt);
  setContextMenuRowId(txn.id);
  rowContextMenu.open(event, [
   { key: 'edit', label: t('edit'), onSelect: () => (txn.isArchived ? onEditArchiveEntryInForm(txn) : onEditTransactionInForm(txn)), disabled: rowLocked },
   { key: 'info', label: t('transaction_more_info_action'), onSelect: () => setInfoTransactionId(txn.id) },
   { key: 'copy', label: t('copy_transaction'), onSelect: () => onCopyTransactionRow(txn) },
   ...(section === 'archive'
    ? [{ key: 'archive-hidden', label: t(txn.archiveHidden ? 'tx_unhide_from_archive' : 'tx_hide_from_archive'), onSelect: () => void onToggleTransactionArchiveHidden(txn) }]
    : []),
   { key: 'delete', label: t('delete'), onSelect: () => void onDeleteTransactionTableRow(txn), tone: 'danger' as const, disabled: rowLocked },
  ]);
 };
 const closeRowMenu = () => {
  rowContextMenu.close();
  setContextMenuRowId(null);
 };

 // Row drag-to-reorder via pointer events (not native HTML5 drag-and-drop, which never fires
 // from a touch gesture — the reason this was unusable on mobile). See usePointerDrag for why.
 // The drag handle sits inside the row, so a drag gesture ends with a browser-synthesized
 // `click` that bubbles to the row's onClick and would toggle the highlight/copy. This flag,
 // set while a drag is in flight, lets that onClick swallow the stray post-drag click so
 // reordering a row never also highlights it.
 const justDraggedRef = useRef(false);
 const transactionRowDrag = usePointerDrag<number>({
  parseKey: (raw) => Number(raw),
  onDragStart: (id) => {
   justDraggedRef.current = true;
   setDragRowId(id);
  },
  onHoverChange: (overId, half) => {
   setDragOverRowId(overId);
   if (half) setDragOverHalf(half);
  },
  onDrop: (draggedId, overId, half) => {
   if (overId !== null && draggedId !== overId && half) {
    // If the dragged row is part of the selection, drag the whole selection; otherwise just this row.
    const idsToMove = selectedTransactionIds.has(draggedId) && selectedTransactionIds.size > 1 ? [...selectedTransactionIds] : [draggedId];
    void onTransactionRowDrop(idsToMove, overId, half);
   }
   setDragRowId(null);
   setDragOverRowId(null);
   // Clear after the synthetic click has had its chance to fire (and be swallowed). If the
   // drop landed on a different row the click never reaches a row's onClick, so this timeout
   // is what resets the flag in that case.
   setTimeout(() => {
    justDraggedRef.current = false;
   }, 0);
  },
  // Short "what am I dragging" label for the floating ghost badge (see usePointerDrag).
  renderGhost: (id) => {
   const row = displayedTransactionRows.find((r) => r.id === id);
   if (!row) return '…';
   const amount = row.amount.toLocaleString(numLocale, { maximumFractionDigits: 2 });
   const who = row.clientFromName || row.clientToName || row.description;
   return who ? `${who} · ${amount} ${row.currencyCode}` : `${amount} ${row.currencyCode}`;
  },
 });

 // The data columns' relative widths (as percentages of the table, summing to 100 when every
 // column is visible). Hardcoded percentages that don't renormalize when optional columns
 // (charges/commission/archive) are hidden leave a gap that table-auto layout hands to the
 // two icon columns instead — widening them well past their content on wide screens/fewer
 // visible columns. Recomputing the percentages against only the currently visible columns'
 // weights keeps them always summing to 100, so the icon columns (fixed px width below)
 // never absorb leftover space.
 const columnWeights: Array<[boolean, number]> = [
  [transactionTableSettings.columns.created, 10],
  [transactionTableSettings.columns.description, 15],
  [transactionTableSettings.columns.type, 10],
  [transactionTableSettings.columns.accountFrom, 17],
  [transactionTableSettings.columns.accountTo, 17],
  [transactionTableSettings.columns.amount, 13],
  [transactionTableSettings.columns.exchangeRate, 12],
  [transactionTableSettings.columns.charges, 13],
  [transactionTableSettings.columns.commission, 15],
  [section === 'archive', 16],
 ];
 const totalColumnWeight = columnWeights.reduce((sum, [visible, weight]) => (visible ? sum + weight : sum), 0) || 1;
 const colWidthPercent = (weight: number) => `${((weight / totalColumnWeight) * 100).toFixed(2)}%`;

 const changeTableZoom = (z: number) => {
  setTableZoom(z);
  saveTableZoom('transactions', z);
 };
 // Treasury/Cashbox accounts are ordinary client_accounts rows (see ClientAccount.isSystem) and
 // must never appear as a selectable "real client" in this ordinary transaction form's pickers.
 // (Also used by the table row-edit AccountSearchSelect calls below — the create-form's own copy
 // of this, and the pickers/options that depend on it, now live in NewTransactionForm.)
 const realClientAccounts = useMemo(() => filterRealClientAccounts(clientAccounts), [clientAccounts]);

 const { suggestions: archiveDescriptionSuggestions, excludeSuggestion: excludeArchiveDescriptionSuggestion } = useDescriptionSuggestions({
  transactions,
  query: archiveEntryForm.description,
  accountIds: [archiveEntryForm.accountFromId, archiveEntryForm.accountToId],
 });
 // Only one row's description suggestions are ever live at a time (whichever row is focused)
 // — hooks can't be called per-row inside the table's .map(), so this single shared instance
 // retargets to whichever row last gained focus; every other row gets an empty list.
 const [activeDescriptionRowId, setActiveDescriptionRowId] = useState<number | null>(null);
 const activeDescriptionDraft = activeDescriptionRowId != null ? (transactionTableDrafts[activeDescriptionRowId] ?? getTransactionTableDraft(activeDescriptionRowId)) : null;
 const { suggestions: rowDescriptionSuggestions, excludeSuggestion: excludeRowDescriptionSuggestion } = useDescriptionSuggestions({
  transactions,
  query: activeDescriptionDraft?.description ?? '',
  accountIds: [activeDescriptionDraft?.accountFromId ?? null, activeDescriptionDraft?.accountToId ?? null],
 });

 if (isLoading) {
  return (
        <section className="flex flex-col gap-6">
         <SkTablePanel
          panelClassName={panelClassName}
          tableWrapClassName={tableWrapClassName}
          cols={SK_TX}
          titleWidth="w-40"
          rows={10}
         />
        </section>
  );
 }

 return (
  <>
        {transactionRowDrag.dragGhost}
        <section className="flex flex-col gap-6 xl:flex-row xl:items-start">
         {(section === 'transactions' || section === 'archive') && newSectionOpen ? (
          <div
           ref={editFormRef}
           className={`border p-5 shadow-sm xl:w-96 xl:shrink-0 ${editingTransaction ? 'border-accent bg-surface-2' : 'border-border bg-surface'}`}
          >
           <div className="flex items-start justify-between gap-3">
            <h2 className="text-xl font-semibold">
             {editingTransaction || editingArchiveEntry ? t('update_transaction') : section === 'archive' ? t('archive_new_transaction') : t('new_transaction')}
            </h2>
            <div className="flex shrink-0 items-center gap-2">
             {editingTransaction || editingArchiveEntry ? (
              <button
               type="button"
               onClick={() => (editingArchiveEntry ? onCancelArchiveEntryEdit() : onCancelEditTransaction())}
               title={t('cancel_edit')}
               className="inline-flex shrink-0 items-center gap-1.5 rounded border border-border-strong bg-surface-2 px-2.5 py-1.5 text-xs font-semibold text-fg-muted transition hover:bg-surface-hover"
              >
               {t('cancel_edit')}
              </button>
             ) : (
              // Same underlying reset onCancelEditTransaction/onCancelArchiveEntryEdit already do
              // when leaving edit mode — reused here to blank out a fresh, not-yet-saved draft
              // instead of retyping over it by hand.
              <button
               type="button"
               onClick={() => (isArchiveEntryMode ? onCancelArchiveEntryEdit() : onCancelEditTransaction())}
               title={t('clear_form')}
               aria-label={t('clear_form')}
               className="inline-flex shrink-0 items-center justify-center rounded border border-border-strong bg-surface-2 p-1.5 text-fg-muted transition hover:bg-surface-hover"
              >
               <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
               >
                <path d="M20 4 14 10" />
                <path d="M14 10 4.5 19.5" />
                <path d="M14 10 17.5 17" />
                <path d="M4.5 19.5 17.5 17" />
                <path d="M14 10 8 18" />
                <path d="M14 10 11 19" />
                <path d="M14 10 14.3 18.5" />
               </svg>
              </button>
             )}
             {copiedTransaction && !editingTransaction && !isArchiveEntryMode ? (
              <button
               type="button"
               onClick={onPasteCopiedTransaction}
               title={t('paste_transaction')}
               aria-label={t('paste_transaction')}
               className="inline-flex shrink-0 items-center gap-1.5 rounded border border-blue-200 bg-accent-weak px-2.5 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent-weak"
              >
               <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
               >
                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                <rect
                 x="9"
                 y="3"
                 width="6"
                 height="4"
                 rx="1"
                />
               </svg>
              </button>
             ) : null}
             {newSectionOpen ? (
              <button
               type="button"
               onClick={() => (isArchiveEntryMode ? archiveEntryFormRef.current?.requestSubmit() : transactionFormRef.current?.requestSubmit())}
               disabled={isArchiveEntryMode ? isSubmittingArchiveEntry : isSubmittingTransaction}
               title={editingTransaction || editingArchiveEntry ? t('update_transaction') : t('save_transaction')}
               aria-label={editingTransaction || editingArchiveEntry ? t('update_transaction') : t('save_transaction')}
               className="inline-flex shrink-0 items-center justify-center rounded border border-border-strong bg-surface-2 p-1.5 text-fg-muted transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
               <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
               >
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
                <path d="M17 21v-8H7v8" />
                <path d="M7 3v5h8" />
               </svg>
              </button>
             ) : null}
             <button
              type="button"
              onClick={() => setNewSectionOpen(false)}
              title={t('transactions_hide_new')}
              aria-label={t('transactions_hide_new')}
              className="inline-flex shrink-0 items-center justify-center rounded border border-border-strong p-1.5 text-fg-faint transition hover:bg-surface-hover hover:text-fg"
             >
              <svg
               width="16"
               height="16"
               viewBox="0 0 24 24"
               fill="none"
               stroke="currentColor"
               strokeWidth="2.5"
               strokeLinecap="round"
               strokeLinejoin="round"
               aria-hidden
              >
               <path d="M6 18L18 6M6 6l12 12" />
              </svg>
             </button>
            </div>
           </div>
           <p className="mt-1 text-sm text-fg-muted">{section === 'archive' ? t('archive_new_transaction_hint') : t('transactions_description')}</p>

           {isArchiveEntryMode ? (
            <form
             ref={archiveEntryFormRef}
             onSubmit={onArchiveEntrySubmit}
             className="mt-5 max-w-md"
            >
             <label className="block text-sm font-medium">{t('date')}</label>
             <input
              type="date"
              value={newArchiveEntryDate}
              max={localDateKey()}
              onChange={(event) => setNewArchiveEntryDate(event.target.value > localDateKey() ? localDateKey() : event.target.value)}
              className="mt-2 w-full rounded border border-border-strong px-3 py-2 outline-none ring-blue-300 focus:ring"
             />

             <label className="mt-4 block text-sm font-medium">{t('transaction_account_from')}</label>
             <div className="mt-2">
              <AccountSearchSelect
               accounts={clientAccounts}
               value={archiveEntryForm.accountFromId}
               onChange={(id) => setArchiveEntryForm((current) => ({ ...current, accountFromId: id }))}
               placeholder={t('transaction_account_placeholder')}
               clearLabel={t('clear_selection')}
               isRTL={isRTL}
              />
             </div>

             <label className="mt-4 block text-sm font-medium">{t('transaction_account_to')}</label>
             <div className="mt-2">
              <AccountSearchSelect
               accounts={clientAccounts}
               value={archiveEntryForm.accountToId}
               onChange={(id) => setArchiveEntryForm((current) => ({ ...current, accountToId: id }))}
               placeholder={t('transaction_account_placeholder')}
               clearLabel={t('clear_selection')}
               isRTL={isRTL}
              />
             </div>

             <label className="mt-4 block text-sm font-medium">{t('transaction_amount')}</label>
             <div className="mt-2 flex gap-2">
              <input
               type="text"
               inputMode="decimal"
               dir="ltr"
               value={archiveEntryForm.amount}
               onChange={(event) => setArchiveEntryForm((current) => ({ ...current, amount: formatAmountInput(event.target.value) }))}
               className="min-w-0 flex-1 rounded border border-border-strong px-3 py-2 outline-none ring-blue-300 focus:ring"
               placeholder="0.00"
              />
              <select
               value={archiveEntryForm.currencyId ?? ''}
               onChange={(event) => setArchiveEntryForm((current) => ({ ...current, currencyId: event.target.value ? Number(event.target.value) : null }))}
               className="w-28 rounded border border-border-strong px-2 py-2 text-sm outline-none ring-blue-300 focus:ring"
               required
              >
               <option value="">{t('transaction_currency_placeholder')}</option>
               {enabledCurrencies.map((cur) => (
                <option
                 key={cur.id}
                 value={cur.id}
                >
                 {cur.code}
                </option>
               ))}
              </select>
             </div>

             <label className="mt-4 block text-sm font-medium">{t('transaction_description')}</label>
             <div className="mt-2">
              <DescriptionSuggestField
               as="textarea"
               value={archiveEntryForm.description}
               onChange={(value) => setArchiveEntryForm((current) => ({ ...current, description: value }))}
               suggestions={archiveDescriptionSuggestions}
               onExcludeSuggestion={excludeArchiveDescriptionSuggestion}
               removeSuggestionLabel={t('transaction_description_suggestion_remove')}
               className="min-h-16 w-full rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
               placeholder={t('transaction_description_placeholder')}
              />
             </div>

             <label className="mt-4 block text-sm font-medium">{t('archive_more_info')}</label>
             <input
              type="text"
              value={archiveEntryForm.archiveNote}
              onChange={(event) => setArchiveEntryForm((current) => ({ ...current, archiveNote: event.target.value }))}
              placeholder={t('archive_more_info_placeholder')}
              className="mt-2 w-full rounded border border-border-strong px-3 py-2 outline-none ring-blue-300 focus:ring"
             />

             <button
              type="submit"
              disabled={isSubmittingArchiveEntry}
              className="mt-6 w-full rounded bg-blue-700 px-4 py-2 font-medium text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
             >
              {editingArchiveEntry ? t('update_transaction') : t('save_transaction')}
             </button>
            </form>
           ) : (
           <NewTransactionForm
            clientAccounts={clientAccounts}
            clientAccountMap={clientAccountMap}
            enabledCurrencies={enabledCurrencies}
            currencyMap={currencyMap}
            transactions={transactions}
            section={section}
            lockPastEditsEnabled={lockPastEditsEnabled}
            onTransactionSubmit={onTransactionSubmit}
            formRef={transactionFormRef}
           />
           )}
          </div>
         ) : null}

         <div className={`${panelClassName} min-w-0 xl:flex-1`}>
          <div className="flex items-start justify-between gap-4">
           <div>
            <h2 className="text-xl font-semibold">{section === 'archive' ? t('archive_title') : t('transactions_title')}</h2>
            {section === 'archive' ? <p className="mt-1 text-sm text-fg-muted">{t('archive_description')}</p> : null}
           </div>
           <div className="flex flex-wrap items-center gap-2">
            <input
             ref={transactionsImportInputRef}
             type="file"
             accept=".xlsx,.xls,.csv"
             onChange={onImportTransactionsFile}
             className="hidden"
            />
            {section === 'archive' ? (
             <button
              type="button"
              onClick={openArchiveExportModal}
              className="cursor-pointer rounded border border-blue-600 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800"
             >
              {t('archive_export_pdf')}
             </button>
            ) : null}
            <button
             type="button"
             onClick={toggleSelectionMode}
             title={t('bulk_select')}
             aria-pressed={selectionMode}
             className={`cursor-pointer rounded border p-2 transition ${selectionMode ? 'border-blue-600 bg-accent-weak text-accent' : 'border-border-strong text-fg-muted hover:bg-surface-hover'}`}
            >
             <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
             >
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
             </svg>
            </button>
            {missingCounterpartyToday.length > 0 ? (
             <button
              type="button"
              onClick={(e) =>
               missingCounterpartyMenu.open(
                e,
                missingCounterpartyToday.map((txn) => ({
                 key: String(txn.id),
                 label: `${txn.clientFromName || txn.clientToName || t('transaction_description')} · ${txn.amount.toLocaleString(numLocale)} ${txn.currencyCode}`,
                 onSelect: () => onEditTransactionInForm(txn),
                })),
               )
              }
              title={t('missing_counterparty_alert', { count: missingCounterpartyToday.length })}
              className="relative cursor-pointer rounded border border-warn bg-warn-bg p-2 text-warn-text transition hover:opacity-80"
             >
              <svg
               width="16"
               height="16"
               viewBox="0 0 24 24"
               fill="none"
               stroke="currentColor"
               strokeWidth="1.8"
               strokeLinecap="round"
               strokeLinejoin="round"
               aria-hidden
              >
               <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
               <line
                x1="12"
                y1="9"
                x2="12"
                y2="13"
               />
               <line
                x1="12"
                y1="17"
                x2="12.01"
                y2="17"
               />
              </svg>
              <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-bad px-1 text-[10px] font-bold text-white">
               {missingCounterpartyToday.length}
              </span>
             </button>
            ) : null}
            {workspaceAnomalies.length > 0 ? (
             <button
              type="button"
              onClick={(e) =>
               anomalyReviewMenu.open(
                e,
                workspaceAnomalies.map((anomaly) => {
                 const tx = transactions.find((t) => t.id === anomaly.transactionId);
                 const account = clientAccountMap.get(anomaly.accountId);
                 const kindLabel = anomaly.kind === 'rate' ? t('ledger_anomaly_badge') : t('ledger_anomaly_commission_badge');
                 const amountLabel = tx ? `${tx.amount.toLocaleString(numLocale)} ${tx.currencyCode}` : '';
                 return {
                  key: anomalyKey(anomaly.kind, anomaly.transactionId, anomaly.accountId),
                  label: `${account?.clientName ?? ''} · ${kindLabel}${amountLabel ? ` · ${amountLabel}` : ''}`,
                  onSelect: () => {
                   const client = account ? clients.find((c) => c.id === account.clientId) : undefined;
                   if (client) openClientLedger(client, 'clients', anomaly.accountId);
                  },
                 };
                }),
               )
              }
              title={t('anomaly_review_alert', { count: workspaceAnomalies.length })}
              className="relative cursor-pointer rounded border border-warn bg-warn-bg p-2 text-warn-text transition hover:opacity-80"
             >
              <svg
               width="16"
               height="16"
               viewBox="0 0 24 24"
               fill="none"
               stroke="currentColor"
               strokeWidth="1.8"
               strokeLinecap="round"
               strokeLinejoin="round"
               aria-hidden
              >
               <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
               <line
                x1="12"
                y1="9"
                x2="12"
                y2="13"
               />
               <line
                x1="12"
                y1="17"
                x2="12.01"
                y2="17"
               />
              </svg>
              <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-bad px-1 text-[10px] font-bold text-white">
               {workspaceAnomalies.length}
              </span>
             </button>
            ) : null}
            <button
             type="button"
             onClick={(e) =>
              gearMenu.open(e, [
               {
                key: 'import',
                label: isImportingTransactions ? t('import_sheet_loading') : t('import_sheet'),
                disabled: isImportingTransactions,
                icon: (
                 <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                 </svg>
                ),
                onSelect: () => transactionsImportInputRef.current?.click(),
               },
               {
                key: 'export',
                label: t('transactions_export_title'),
                icon: (
                 <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                 </svg>
                ),
                onSelect: openTransactionExportModal,
               },
               {
                key: 'settings',
                label: t('transactions_more_settings'),
                icon: (
                 <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                  <circle cx="12" cy="12" r="3" />
                 </svg>
                ),
                onSelect: openTransactionTableSettingsModal,
               },
              ])
             }
             title={t('transactions_more_settings')}
             className="cursor-pointer rounded border border-border-strong p-2 text-fg-muted transition hover:bg-surface-hover"
            >
             <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
             >
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle
               cx="12"
               cy="12"
               r="3"
              />
             </svg>
            </button>
            {selectedTransactionIds.size > 0 ? (
             <button
              type="button"
              onClick={() => void onDeleteSelectedTransactions()}
              title={`${t('delete')} (${selectedTransactionIds.size})`}
              aria-label={`${t('delete')} (${selectedTransactionIds.size})`}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-red-600 bg-red-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
             >
              <svg
               width="16"
               height="16"
               viewBox="0 0 24 24"
               fill="none"
               stroke="currentColor"
               strokeWidth="1.8"
               strokeLinecap="round"
               strokeLinejoin="round"
               aria-hidden
              >
               <path d="M3 6h18" />
               <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
               <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
               <path d="M10 11v6M14 11v6" />
              </svg>
              {selectedTransactionIds.size}
             </button>
            ) : null}
            {selectedTransactionSums.map((sum) => (
             <span
              key={sum.code || 'none'}
              className="inline-flex items-center gap-1.5 rounded border border-border-strong bg-surface-2 px-3 py-2 text-sm text-fg-muted"
             >
              <span className="font-semibold text-fg">{sum.total.toLocaleString(numLocale)}</span>
              <span className="text-fg-faint">{sum.symbol || sum.code}</span>
             </span>
            ))}
            {Object.keys(transactionTableDrafts).length > 0 ? (
             <>
              <button
               type="button"
               title={t('undo')}
               onClick={txTableHistory.undo}
               disabled={!txTableHistory.canUndo}
               className="cursor-pointer rounded border border-border-strong bg-surface p-2 text-fg-muted transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
               <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
               >
                <path d="M9 14 4 9l5-5" />
                <path d="M4 9h11a5 5 0 0 1 0 10h-1" />
               </svg>
              </button>
              <button
               type="button"
               title={t('redo')}
               onClick={txTableHistory.redo}
               disabled={!txTableHistory.canRedo}
               className="cursor-pointer rounded border border-border-strong bg-surface p-2 text-fg-muted transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
               <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
               >
                <path d="m15 14 5-5-5-5" />
                <path d="M20 9H9a5 5 0 0 0 0 10h1" />
               </svg>
              </button>
             </>
            ) : null}
            {(section === 'transactions' || section === 'archive') && !newSectionOpen ? (
             <button
              type="button"
              onClick={() => setNewSectionOpen(true)}
              aria-expanded={newSectionOpen}
              title={t('transactions_show_new')}
              className="cursor-pointer rounded border border-blue-600 bg-blue-700 p-2 text-white transition hover:bg-blue-800"
             >
              <svg
               xmlns="http://www.w3.org/2000/svg"
               viewBox="0 0 24 24"
               fill="none"
               stroke="currentColor"
               strokeWidth="2.5"
               className="h-4 w-4"
               aria-hidden="true"
              >
               <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 4v16M4 12h16"
               />
              </svg>
             </button>
            ) : null}
           </div>
          </div>

          {/* Row-click modes (highlight/copy/sum) live on their own row below the main
              toolbar, separate from the settings/download/upload icons above. */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
           <button
            type="button"
            title={t('ledger_click_highlight_mode')}
            onClick={() => setTxRowClickMode(txRowClickActive && txRowClickHighlight && !txSumMode ? 'none' : 'highlight')}
            aria-pressed={txRowClickActive && txRowClickHighlight && !txSumMode}
            className={`cursor-pointer rounded border px-2 py-2 text-sm font-semibold transition ${
             txRowClickActive && txRowClickHighlight && !txSumMode ? 'border-amber-400 bg-warn-bg text-warn-text hover:bg-warn-bg' : 'border-border-strong text-fg-muted hover:bg-surface-hover'
            }`}
           >
            <svg
             width="16"
             height="16"
             viewBox="0 0 24 24"
             fill="none"
             stroke="currentColor"
             strokeWidth="1.8"
             strokeLinecap="round"
             strokeLinejoin="round"
             aria-hidden
            >
             <path d="m9 11-6 6v3h9l3-3" />
             <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
            </svg>
           </button>
           <button
            type="button"
            title={t('ledger_click_copy_mode')}
            onClick={() => setTxRowClickMode(txRowClickActive && !txRowClickHighlight && !txSumMode ? 'none' : 'copy')}
            aria-pressed={txRowClickActive && !txRowClickHighlight && !txSumMode}
            className={`cursor-pointer rounded border px-2 py-2 text-sm font-semibold transition ${
             txRowClickActive && !txRowClickHighlight && !txSumMode ? 'border-blue-400 bg-accent-weak text-accent hover:bg-accent-weak' : 'border-border-strong text-fg-muted hover:bg-surface-hover'
            }`}
           >
            <svg
             width="16"
             height="16"
             viewBox="0 0 24 24"
             fill="none"
             stroke="currentColor"
             strokeWidth="1.8"
             strokeLinecap="round"
             strokeLinejoin="round"
             aria-hidden
            >
             <rect
              x="9"
              y="9"
              width="13"
              height="13"
              rx="2"
              ry="2"
             />
             <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
           </button>
           <button
            type="button"
            title={t('tx_sum_mode_hint')}
            onClick={toggleTxSumMode}
            aria-pressed={txSumMode}
            className={`cursor-pointer rounded border px-2 py-2 text-sm font-semibold transition ${
             txSumMode ? 'border-purple-400 bg-violet-bg text-violet-text hover:bg-violet-bg' : 'border-border-strong text-fg-muted hover:bg-surface-hover'
            }`}
           >
            <svg
             width="16"
             height="16"
             viewBox="0 0 24 24"
             fill="none"
             stroke="currentColor"
             strokeWidth="1.8"
             strokeLinecap="round"
             strokeLinejoin="round"
             aria-hidden
            >
             <path d="M18 6H7l5 6-5 6h11" />
            </svg>
           </button>
           {txSumByCurrency.map((sum) => (
            <span
             key={sum.code || 'none'}
             className="inline-flex items-center gap-1.5 rounded border border-purple-300 bg-violet-bg px-3 py-2 text-sm text-fg-muted"
            >
             <span className="font-medium text-fg-faint">
              {sum.code || t('amount')} ({sum.count})
             </span>
             <span className="font-semibold text-fg">{sum.total.toLocaleString(numLocale)}</span>
            </span>
           ))}
          </div>

          <div className="mt-3 rounded border border-border bg-surface-2">
           <button
            type="button"
            onClick={() => setFilterOpen((o) => !o)}
            aria-expanded={filterOpen}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-fg-muted transition hover:bg-surface-hover"
           >
            <svg
             width="14"
             height="14"
             viewBox="0 0 24 24"
             fill="none"
             stroke="currentColor"
             strokeWidth="2"
             strokeLinecap="round"
             strokeLinejoin="round"
             aria-hidden
            >
             <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            {t('tx_filter_toggle')}
            {(filterSearch || filterClient || filterDateFrom || filterDateTo || filterHideExpenses || archiveFilterShowHidden) && (
             <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-xs font-semibold text-white leading-none">
              {[filterSearch, filterClient, filterDateFrom, filterDateTo, filterHideExpenses, archiveFilterShowHidden].filter(Boolean).length}
             </span>
            )}
            <svg
             width="14"
             height="14"
             viewBox="0 0 24 24"
             fill="none"
             stroke="currentColor"
             strokeWidth="2"
             strokeLinecap="round"
             strokeLinejoin="round"
             aria-hidden
             className={`ml-auto transition-transform ${filterOpen ? 'rotate-180' : ''}`}
            >
             <path d="M6 9l6 6 6-6" />
            </svg>
           </button>
           {filterOpen && (
            <div className="flex flex-wrap items-end gap-2 border-t border-border px-3 py-3">
             <div className="flex min-w-36 flex-1 flex-col gap-1">
              <label className="text-xs font-medium text-fg-faint">{t('tx_filter_search')}</label>
              <div className="relative">
               <input
                type="text"
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
                placeholder={t('tx_filter_search_placeholder')}
                className={`w-full rounded border border-border-strong bg-surface px-2 py-1.5 text-sm outline-none ring-blue-300 focus:ring ${isRTL ? 'pl-14' : 'pr-14'}`}
               />
               <div className={`absolute inset-y-0 flex items-center gap-0.5 ${isRTL ? 'left-1' : 'right-1'}`}>
                <button
                 type="button"
                 onClick={() => setFilterWholeWord((w) => !w)}
                 title={t('tx_filter_whole_word')}
                 aria-label={t('tx_filter_whole_word')}
                 aria-pressed={filterWholeWord}
                 className={`flex h-5 w-6 items-center justify-center rounded text-[11px] font-semibold transition ${
                  filterWholeWord ? 'bg-accent-weak text-accent ring-1 ring-inset ring-blue-400' : 'text-fg-faint hover:bg-surface-hover hover:text-fg-muted'
                 }`}
                >
                 <span className="border-b border-current leading-none">ab</span>
                </button>
                {filterSearch ? (
                 <button
                  type="button"
                  onClick={() => setFilterSearch('')}
                  title={t('clear_selection')}
                  aria-label={t('clear_selection')}
                  className="flex h-5 w-5 items-center justify-center rounded text-fg-faint hover:bg-surface-hover hover:text-fg-muted"
                 >
                  <svg
                   width="12"
                   height="12"
                   viewBox="0 0 24 24"
                   fill="none"
                   stroke="currentColor"
                   strokeWidth="2"
                   strokeLinecap="round"
                   strokeLinejoin="round"
                   aria-hidden
                  >
                   <line
                    x1="18"
                    y1="6"
                    x2="6"
                    y2="18"
                   />
                   <line
                    x1="6"
                    y1="6"
                    x2="18"
                    y2="18"
                   />
                  </svg>
                 </button>
                ) : null}
               </div>
              </div>
             </div>
             <div className="flex min-w-36 flex-1 flex-col gap-1">
              <label className="text-xs font-medium text-fg-faint">{t('tx_filter_client')}</label>
              <select
               value={filterClient}
               onChange={(e) => setFilterClient(e.target.value)}
               className="rounded border border-border-strong bg-surface px-2 py-1.5 text-sm outline-none ring-blue-300 focus:ring"
              >
               <option value="">{t('tx_filter_client_all')}</option>
               {txFilterClientOptions.map((name) => (
                <option
                 key={name}
                 value={name}
                >
                 {name}
                </option>
               ))}
              </select>
             </div>
             <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-fg-faint">{t('tx_filter_date_from')}</label>
              <input
               type="date"
               value={filterDateFrom}
               onChange={(e) => setFilterDateFrom(e.target.value)}
               className="rounded border border-border-strong bg-surface px-2 py-1.5 text-sm outline-none ring-blue-300 focus:ring"
              />
             </div>
             <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-fg-faint">{t('tx_filter_date_to')}</label>
              <input
               type="date"
               value={filterDateTo}
               onChange={(e) => setFilterDateTo(e.target.value)}
               className="rounded border border-border-strong bg-surface px-2 py-1.5 text-sm outline-none ring-blue-300 focus:ring"
              />
             </div>
             <label className="flex cursor-pointer select-none items-center gap-2 self-end rounded border border-border-strong bg-surface px-3 py-1.5 text-sm text-fg-muted transition hover:bg-surface-hover">
              <input
               type="checkbox"
               checked={filterHideExpenses}
               onChange={(e) => setFilterHideExpenses(e.target.checked)}
               className="h-4 w-4 cursor-pointer rounded border-border-strong text-accent focus:ring-blue-300"
              />
              {t('tx_filter_hide_expenses')}
             </label>
             {section === 'archive' ? (
              <label className="flex cursor-pointer select-none items-center gap-2 self-end rounded border border-border-strong bg-surface px-3 py-1.5 text-sm text-fg-muted transition hover:bg-surface-hover">
               <input
                type="checkbox"
                checked={archiveFilterShowHidden}
                onChange={(e) => setArchiveFilterShowHidden(e.target.checked)}
                className="h-4 w-4 cursor-pointer rounded border-border-strong text-accent focus:ring-blue-300"
               />
               {t('tx_filter_show_hidden')}
              </label>
             ) : null}
             {(filterSearch || filterClient || filterDateFrom || filterDateTo || filterHideExpenses || archiveFilterShowHidden) && (
              <button
               type="button"
               onClick={() => {
                setFilterSearch('');
                setFilterWholeWord(false);
                setFilterClient('');
                setFilterDateFrom('');
                setFilterDateTo('');
                setFilterHideExpenses(false);
                setArchiveFilterShowHidden(false);
               }}
               className="self-end rounded border border-border-strong bg-surface px-3 py-1.5 text-sm text-fg-muted transition hover:bg-surface-hover"
              >
               {t('tx_filter_clear')}
              </button>
             )}
            </div>
           )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
           {transactionsPager}
           <TableZoomControl
            zoom={tableZoom}
            onZoomChange={changeTableZoom}
            className=""
           />
          </div>
          <div className={`${tableWrapClassName} max-h-[70vh] overflow-y-auto`}>
           <table
            className="w-full text-sm"
            style={{ zoom: String(tableZoom) }}
           >
            <colgroup>
             <col className="w-10" />
             {selectionMode ? <col className="w-12" /> : null}
             {transactionTableSettings.columns.created ? <col style={{ width: colWidthPercent(10) }} /> : null}
             {transactionTableSettings.columns.description ? <col style={{ width: colWidthPercent(15) }} /> : null}
             {transactionTableSettings.columns.type ? <col style={{ width: colWidthPercent(10) }} /> : null}
             {transactionTableSettings.columns.accountFrom ? <col style={{ width: colWidthPercent(17) }} /> : null}
             {transactionTableSettings.columns.accountTo ? <col style={{ width: colWidthPercent(17) }} /> : null}
             {transactionTableSettings.columns.amount ? <col style={{ width: colWidthPercent(13) }} /> : null}
             {transactionTableSettings.columns.exchangeRate ? <col style={{ width: colWidthPercent(12) }} /> : null}
             {transactionTableSettings.columns.charges ? <col style={{ width: colWidthPercent(13) }} /> : null}
             {transactionTableSettings.columns.commission ? <col style={{ width: colWidthPercent(15) }} /> : null}
             {section === 'archive' ? <col style={{ width: colWidthPercent(16) }} /> : null}
            </colgroup>
            <thead className="sticky top-0 z-20 bg-surface-hover text-fg-muted">
             <tr>
              <th className="w-px whitespace-nowrap px-1 py-3">
               {isEditAllTransactions ? (
                <div className="flex flex-col items-center gap-1">
                 <button
                  type="button"
                  title={t('save_changes')}
                  onClick={() => void onSaveAllTransactions()}
                  className="rounded p-1 text-good-text hover:bg-good-bg"
                 >
                  <svg
                   width="13"
                   height="13"
                   viewBox="0 0 24 24"
                   fill="none"
                   stroke="currentColor"
                   strokeWidth="2"
                   strokeLinecap="round"
                   strokeLinejoin="round"
                   aria-hidden
                  >
                   <polyline points="20 6 9 17 4 12" />
                  </svg>
                 </button>
                 <button
                  type="button"
                  title={t('cancel')}
                  onClick={() => onCancelAllTransactions()}
                  className="rounded p-1 text-fg-faint hover:bg-surface-hover"
                 >
                  <svg
                   width="13"
                   height="13"
                   viewBox="0 0 24 24"
                   fill="none"
                   stroke="currentColor"
                   strokeWidth="2"
                   strokeLinecap="round"
                   strokeLinejoin="round"
                   aria-hidden
                  >
                   <line
                    x1="18"
                    y1="6"
                    x2="6"
                    y2="18"
                   />
                   <line
                    x1="6"
                    y1="6"
                    x2="18"
                    y2="18"
                   />
                  </svg>
                 </button>
                </div>
               ) : (
                <button
                 type="button"
                 title="Edit all rows"
                 onClick={() => onEditAllTransactions()}
                 className="rounded p-1 text-fg-faint hover:bg-surface-hover hover:text-accent"
                >
                 <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                 >
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                 </svg>
                </button>
               )}
              </th>
              {selectionMode ? (
               <th className="w-px whitespace-nowrap px-2 py-3">
                <input
                 type="checkbox"
                 checked={paginatedTransactions.length > 0 && paginatedTransactions.every((t) => selectedTransactionIds.has(t.id))}
                 onChange={onToggleSelectAllTransactions}
                 aria-label="Select all"
                 className="h-4 w-4 cursor-pointer rounded border-border-strong"
                />
               </th>
              ) : null}
              {transactionTableSettings.columns.created ? (
               <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>
                <button
                 type="button"
                 onClick={() => setTxSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
                 className="inline-flex items-center gap-1 hover:text-accent transition-colors"
                 title={txSortDir === 'desc' ? t('sort_asc') : t('sort_desc')}
                >
                 {t('date')}
                 <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                 >
                  {txSortDir === 'desc' ? (
                   <>
                    <path d="M12 5v14" />
                    <path d="M5 12l7 7 7-7" />
                   </>
                  ) : (
                   <>
                    <path d="M12 19V5" />
                    <path d="M5 12l7-7 7 7" />
                   </>
                  )}
                 </svg>
                </button>
               </th>
              ) : null}
              {transactionTableSettings.columns.description ? (
               <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_description')}</th>
              ) : null}
              {transactionTableSettings.columns.type ? (
               <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_type')}</th>
              ) : null}
              {transactionTableSettings.columns.accountFrom ? (
               <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_account_from')}</th>
              ) : null}
              {transactionTableSettings.columns.accountTo ? (
               <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_account_to')}</th>
              ) : null}
              {transactionTableSettings.columns.amount ? <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_amount')}</th> : null}
              {transactionTableSettings.columns.exchangeRate ? <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_exchange_rate')}</th> : null}
              {transactionTableSettings.columns.charges ? <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('charges')}</th> : null}
              {transactionTableSettings.columns.commission ? <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('commission')}</th> : null}
              {section === 'archive' ? <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('archive_more_info')}</th> : null}
             </tr>
            </thead>
            <tbody>
             {paginatedTransactions.map((txn, index) => (
              <tr
               key={txn.id}
               data-drag-key={txn.id}
               onContextMenu={(e) => openRowMenu(e, txn)}
               {...rowLongPress.bind((e) => openRowMenu(e, txn))}
               onKeyDown={(e) => {
                focusAdjacentRowField(e, isRTL);
                // Enter saves the row being edited (ignore Enter inside multi-line fields).
                if (e.key !== 'Enter') return;
                if (!editingRowIds.has(txn.id)) return;
                if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
                e.preventDefault();
                void onSaveTransactionTableRow(txn.id);
               }}
               className={`border-t border-border align-top transition-colors hover:bg-surface-hover ${txn.isArchived || (txn.type !== 'adjustment' && (!txn.accountFromId || !txn.accountToId) && !txn.counterParty?.trim()) ? 'bg-warn-bg' : index % 2 === 1 ? 'bg-surface-2' : 'bg-surface'} ${
                section === 'archive' && txn.archiveHidden ? 'opacity-50' : ''
               } ${
                dragRowId !== null && selectedTransactionIds.has(dragRowId) && selectedTransactionIds.has(txn.id) ? 'opacity-40' : dragRowId === txn.id ? 'opacity-40' : ''
               } ${dragOverRowId === txn.id && dragOverHalf === 'top' ? 'border-t-2 border-t-blue-500' : ''} ${
                dragOverRowId === txn.id && dragOverHalf === 'bottom' ? 'border-b-2 border-b-blue-500' : ''
               } ${
                contextMenuRowId === txn.id
                 ? 'ring-2 ring-inset ring-indigo-400'
                 : editingRowIds.has(txn.id) || editingTransaction?.id === txn.id
                   ? editingRowRingClassName
                   : ''
               }`}
               style={(() => {
                const color = highlightedTxRows.get(txn.id);
                const isEditingRow = editingRowIds.has(txn.id);
                return {
                 // Suppresses iOS's own text-selection magnifier/callout so it doesn't visually
                 // collide with the long-press-triggered row menu (see useLongPress.ts).
                 WebkitTouchCallout: 'none',
                 WebkitUserSelect: 'none',
                 userSelect: 'none',
                 ...(color ? { backgroundColor: resolveHighlightBg(color, isDark) } : {}),
                 ...(isEditingRow || txSumMode || !txRowClickActive ? {} : txRowClickHighlight ? { cursor: highlightPenCursor(txRowHighlightColor) } : { cursor: 'copy' }),
                };
               })()}
               onClick={(e) => {
                if (rowLongPress.consumeLongPress()) return;
                const isEditingRow = editingRowIds.has(txn.id);
                if (isEditingRow) return;
                // Swallow the click synthesized at the end of a drag so reordering a row
                // doesn't also highlight/copy it.
                if (justDraggedRef.current) {
                 justDraggedRef.current = false;
                 return;
                }
                if ((e.target as HTMLElement).closest('button, a, input, select, textarea, label')) return;
                // Sum mode owns clicks exclusively via the amount cell's own button (excluded
                // above); a click elsewhere in the row is a no-op instead of falling through to
                // highlight/copy.
                if (txSumMode) return;
                // Neutral pointer: no click mode engaged, so a row click does nothing.
                if (!txRowClickActive) return;
                if (txRowClickHighlight) {
                 toggleTxRowHighlight(txn.id);
                 return;
                }
                const td = (e.target as HTMLElement).closest('td');
                // Skip the leading non-data columns (actions, plus the checkbox column when
                // selection mode is on) so only real cell text is copied.
                if (!td || (td as HTMLTableCellElement).cellIndex < (selectionMode ? 2 : 1)) return;
                const raw = (td as HTMLElement).innerText.trim();
                const text = raw.replace(/\s+([A-Z]{2,5}|[$€£¥₹₩₪₺₽฿₫])$/, '').trim() || raw;
                if (text) navigator.clipboard.writeText(text).then(() => showToast(t('toast_copied'), e));
               }}
              >
               {(() => {
                const isEditingRow = editingRowIds.has(txn.id);
                const draft = isEditingRow ? getTransactionTableDraft(txn.id) : null;

                return (
                 <>
                  <td className="w-px whitespace-nowrap px-1 py-3 align-top">
                   {isEditingRow ? (
                    <div className="flex flex-col items-center gap-1">
                     {/* Dragging is disabled while editing (matches the previous native-drag
                         behavior) — this handle is a static visual placeholder here. */}
                     <span className="cursor-grab text-fg-faint hover:text-fg-faint active:cursor-grabbing" title="Drag to reorder">
                      <svg
                       width="12"
                       height="12"
                       viewBox="0 0 24 24"
                       fill="currentColor"
                       aria-hidden
                      >
                       <circle
                        cx="9"
                        cy="5"
                        r="1.5"
                       />
                       <circle
                        cx="15"
                        cy="5"
                        r="1.5"
                       />
                       <circle
                        cx="9"
                        cy="12"
                        r="1.5"
                       />
                       <circle
                        cx="15"
                        cy="12"
                        r="1.5"
                       />
                       <circle
                        cx="9"
                        cy="19"
                        r="1.5"
                       />
                       <circle
                        cx="15"
                        cy="19"
                        r="1.5"
                       />
                      </svg>
                     </span>
                     {/* 2×2 grid: save/cancel on the top row, delete/reverse on the bottom row. */}
                     <div className="grid grid-cols-2 gap-1">
                     <button
                      type="button"
                      title={t('save_changes')}
                      onClick={() => void onSaveTransactionTableRow(txn.id)}
                      className="rounded p-1 text-good-text hover:bg-good-bg"
                     >
                      <svg
                       width="14"
                       height="14"
                       viewBox="0 0 24 24"
                       fill="none"
                       stroke="currentColor"
                       strokeWidth="2"
                       strokeLinecap="round"
                       strokeLinejoin="round"
                       aria-hidden
                      >
                       <polyline points="20 6 9 17 4 12" />
                      </svg>
                     </button>
                     <button
                      type="button"
                      title={t('cancel')}
                      onClick={() =>
                       setEditingRowIds((prev) => {
                        const next = new Set(prev);
                        next.delete(txn.id);
                        return next;
                       })
                      }
                      className="rounded p-1 text-fg-faint hover:bg-surface-hover"
                     >
                      <svg
                       width="14"
                       height="14"
                       viewBox="0 0 24 24"
                       fill="none"
                       stroke="currentColor"
                       strokeWidth="2"
                       strokeLinecap="round"
                       strokeLinejoin="round"
                       aria-hidden
                      >
                       <line
                        x1="18"
                        y1="6"
                        x2="6"
                        y2="18"
                       />
                       <line
                        x1="6"
                        y1="6"
                        x2="18"
                        y2="18"
                       />
                      </svg>
                     </button>
                     <button
                      type="button"
                      title={t('delete')}
                      onClick={() => void onDeleteTransactionTableRow(txn)}
                      className="rounded p-1 text-bad-text hover:bg-bad-bg"
                     >
                      <svg
                       width="14"
                       height="14"
                       viewBox="0 0 24 24"
                       fill="none"
                       stroke="currentColor"
                       strokeWidth="1.8"
                       strokeLinecap="round"
                       strokeLinejoin="round"
                       aria-hidden
                      >
                       <polyline points="3 6 5 6 21 6" />
                       <path d="M19 6l-1 14H6L5 6" />
                       <path d="M10 11v6M14 11v6" />
                       <path d="M9 6V4h6v2" />
                      </svg>
                     </button>
                     {draft && (
                      <button
                       type="button"
                       title={t('ledger_swap_parties')}
                       onClick={() =>
                        updateTransactionTableDraft(txn.id, {
                         accountFromId: draft.accountToId,
                         accountToId: draft.accountFromId,
                         exchangeRateFrom: draft.exchangeRateTo,
                         exchangeRateTo: draft.exchangeRateFrom,
                        })
                       }
                       className="rounded p-1 text-fg-faint hover:bg-surface-hover hover:text-accent"
                      >
                       <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                       >
                        <path d="M7 4 3 8l4 4M3 8h13.5" />
                        <path d="M17 20l4-4-4-4m4 4H7.5" />
                       </svg>
                      </button>
                     )}
                     </div>
                    </div>
                   ) : (
                    // Row actions (edit/delete) live in the right-click context menu (desktop,
                    // see onContextMenu on the <tr> above) plus the visible "⋮" button beside it,
                    // which is the only way to reach them on touch devices (no right-click there).
                    <div className="flex items-center justify-center gap-1">
                     <span
                      {...transactionRowDrag.dragHandleProps(txn.id)}
                      className="cursor-grab text-fg-faint hover:text-fg-faint active:cursor-grabbing"
                      title="Drag to reorder"
                     >
                      <svg
                       width="12"
                       height="12"
                       viewBox="0 0 24 24"
                       fill="currentColor"
                       aria-hidden
                      >
                       <circle
                        cx="9"
                        cy="5"
                        r="1.5"
                       />
                       <circle
                        cx="15"
                        cy="5"
                        r="1.5"
                       />
                       <circle
                        cx="9"
                        cy="12"
                        r="1.5"
                       />
                       <circle
                        cx="15"
                        cy="12"
                        r="1.5"
                       />
                       <circle
                        cx="9"
                        cy="19"
                        r="1.5"
                       />
                       <circle
                        cx="15"
                        cy="19"
                        r="1.5"
                       />
                      </svg>
                     </span>
                     <button
                      type="button"
                      title={t('row_actions_menu')}
                      aria-label={t('row_actions_menu')}
                      onClick={(e) => openRowMenu(e, txn)}
                      className="rounded p-0.5 text-fg-faint hover:bg-surface-hover hover:text-fg-muted"
                     >
                      <svg
                       width="12"
                       height="12"
                       viewBox="0 0 24 24"
                       fill="currentColor"
                       aria-hidden
                      >
                       <circle cx="12" cy="5" r="1.8" />
                       <circle cx="12" cy="12" r="1.8" />
                       <circle cx="12" cy="19" r="1.8" />
                      </svg>
                     </button>
                    </div>
                   )}
                  </td>
                  {selectionMode ? (
                   <td className="w-px whitespace-nowrap px-2 py-3 align-middle">
                    <input
                     type="checkbox"
                     checked={selectedTransactionIds.has(txn.id)}
                     onChange={() => onToggleTransactionSelection(txn.id)}
                     aria-label={`Select transaction ${txn.id}`}
                     className="h-4 w-4 cursor-pointer rounded border-border-strong"
                    />
                   </td>
                  ) : null}
                  {transactionTableSettings.columns.created ? (
                   <td className="px-4 py-3 text-fg-faint">
                    {isEditingRow && draft ? (
                     <input
                      type="date"
                      value={draft.createdDate}
                      max={localDateKey()}
                      min={lockPastEditsEnabled && !txn.isArchived ? localDateKey() : undefined}
                      onChange={(event) => updateTransactionTableDraft(txn.id, { createdDate: event.target.value > localDateKey() ? localDateKey() : event.target.value })}
                      className={`${seamlessInputClassName} w-full text-sm text-fg`}
                     />
                    ) : (
                     <span className="inline-flex items-center gap-1.5">
                      {formatDateValue(txn.createdAt, transactionTableSettings.dateFormat)}
                     </span>
                    )}
                   </td>
                  ) : null}
                  {transactionTableSettings.columns.description ? (
                   <td className="px-4 py-3 text-fg-muted whitespace-nowrap">
                    {isEditingRow && draft ? (
                     <DescriptionSuggestField
                      value={draft.description}
                      onChange={(value) => updateTransactionTableDraft(txn.id, { description: value })}
                      onFocus={() => setActiveDescriptionRowId(txn.id)}
                      suggestions={activeDescriptionRowId === txn.id ? rowDescriptionSuggestions : []}
                      onExcludeSuggestion={excludeRowDescriptionSuggestion}
                      removeSuggestionLabel={t('transaction_description_suggestion_remove')}
                      className={`${seamlessInputClassName} min-w-28 text-sm text-fg`}
                      placeholder={t('transaction_description_placeholder')}
                     />
                    ) : (
                     txn.description || <span className="text-fg-faint">-</span>
                    )}
                   </td>
                  ) : null}
                  {transactionTableSettings.columns.type ? (
                   <td className="px-4 py-3 text-fg-muted whitespace-nowrap">
                    {isEditingRow && draft ? (
                     <select
                      value={draft.type}
                      onChange={(event) => updateTransactionTableDraft(txn.id, { type: event.target.value })}
                      style={{ width: ledgerSelectWidth(t(transactionTypeLabelKey(draft.type)), 7, 2) }}
                      className={`${seamlessSelectClassName} text-xs text-fg`}
                     >
                      {/* 'buy'/'sell' can no longer be newly selected, but a row already saved with
                          one of them must keep showing it — otherwise the select's bound value
                          matches no option and the browser silently displays a different one. */}
                      {draft.type === 'buy' ? <option value="buy">{t('transaction_type_buy')}</option> : null}
                      {draft.type === 'sell' ? <option value="sell">{t('transaction_type_sell')}</option> : null}
                      <option value="exchange">{t('transaction_type_exchange')}</option>
                      <option value="transfer">{t('transaction_type_transfer')}</option>
                      <option value="adjustment">{t('transaction_type_adjustment')}</option>
                     </select>
                    ) : (
                     t(transactionTypeLabelKey(txn.type))
                    )}
                   </td>
                  ) : null}
                  {transactionTableSettings.columns.accountFrom ? (
                   <td className={`px-4 py-3 font-medium text-fg whitespace-nowrap${isEditingRow ? ' min-w-52' : ''}`}>
                    {isEditingRow && draft ? (
                     <div className="space-y-2">
                      <AccountSearchSelect
                       accounts={realClientAccounts}
                       value={draft.accountFromId}
                       onChange={(id) => updateTransactionTableDraft(txn.id, { accountFromId: id })}
                       placeholder={t('transaction_account_placeholder')}
                       clearLabel={t('clear_selection')}
                       isRTL={isRTL}
                      />
                      {draft.type === 'adjustment' && (!draft.accountFromId || !draft.accountToId) ? (
                       <input
                        type="text"
                        value={draft.counterParty}
                        onChange={(event) => updateTransactionTableDraft(txn.id, { counterParty: event.target.value })}
                        placeholder={t('adjustment_counter_party_placeholder')}
                        className={`${seamlessInputClassName} w-full text-xs text-fg`}
                       />
                      ) : null}
                     </div>
                    ) : (
                     <>
                      {(() => {
                       const fromAccount = clientAccountMap.get(txn.accountFromId ?? -1);
                       const fromClient = fromAccount ? clientMap.get(fromAccount.clientId) : null;

                       return fromClient ? (
                        <a
                         href={`/clients/${fromClient.id}`}
                         onClick={(e) => {
                          if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
                          e.preventDefault();
                          openClientLedger(fromClient, 'clients', fromAccount?.id);
                         }}
                         className="cursor-pointer text-left hover:text-accent hover:underline"
                        >
                         {txn.clientFromName} <span className="text-xs font-normal text-fg-faint">{txn.accountFromCurrencySymbol || txn.accountFromCurrencyCode}</span>
                        </a>
                       ) : txn.accountFromId ? (
                        <div>
                         {txn.clientFromName} <span className="text-xs font-normal text-fg-faint">{txn.accountFromCurrencySymbol || txn.accountFromCurrencyCode}</span>
                        </div>
                       ) : txn.counterParty?.trim() ? (
                        <span className="italic text-fg-faint">{txn.counterParty}</span>
                       ) : (
                        <span className="italic text-fg-faint">-</span>
                       );
                      })()}
                     </>
                    )}
                   </td>
                  ) : null}
                  {transactionTableSettings.columns.accountTo ? (
                   <td className={`px-4 py-3 font-medium text-fg whitespace-nowrap${isEditingRow ? ' min-w-52' : ''}`}>
                    {isEditingRow && draft ? (
                     <div className="space-y-2">
                      <AccountSearchSelect
                       accounts={realClientAccounts}
                       value={draft.accountToId}
                       onChange={(id) => updateTransactionTableDraft(txn.id, { accountToId: id })}
                       placeholder={t('transaction_account_placeholder')}
                       clearLabel={t('clear_selection')}
                       isRTL={isRTL}
                      />
                     </div>
                    ) : (
                     <>
                      {(() => {
                       const toAccount = clientAccountMap.get(txn.accountToId ?? -1);
                       const toClient = toAccount ? clientMap.get(toAccount.clientId) : null;

                       return toClient ? (
                        <a
                         href={`/clients/${toClient.id}`}
                         onClick={(e) => {
                          if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
                          e.preventDefault();
                          openClientLedger(toClient, 'clients', toAccount?.id);
                         }}
                         className="cursor-pointer text-left hover:text-accent hover:underline"
                        >
                         {txn.clientToName} <span className="text-xs font-normal text-fg-faint">{txn.accountToCurrencySymbol || txn.accountToCurrencyCode}</span>
                        </a>
                       ) : txn.accountToId ? (
                        <div>
                         {txn.clientToName} <span className="text-xs font-normal text-fg-faint">{txn.accountToCurrencySymbol || txn.accountToCurrencyCode}</span>
                        </div>
                       ) : txn.counterParty?.trim() ? (
                        <span className="italic text-fg-faint">{txn.counterParty}</span>
                       ) : (
                        <span className="italic text-fg-faint">-</span>
                       );
                      })()}
                     </>
                    )}
                   </td>
                  ) : null}
                  {transactionTableSettings.columns.amount ? (
                   <td className="px-4 py-3 text-fg-muted">
                    {isEditingRow && draft ? (
                     <div className="flex gap-2">
                      <input
                       type="text"
                       inputMode="decimal"
                       dir="ltr"
                       value={formatAmountInput(draft.amount)}
                       onChange={(event) => updateTransactionTableDraft(txn.id, { amount: normalizeDecimalInput(event.target.value) })}
                       className={`${seamlessInputClassName} min-w-16 text-sm text-fg`}
                      />
                      <select
                       value={draft.currencyId ?? ''}
                       onChange={(event) => updateTransactionTableDraft(txn.id, { currencyId: event.target.value ? Number(event.target.value) : null })}
                       className={`${seamlessSelectClassName} w-20 text-sm text-fg`}
                      >
                       <option value="">{t('transaction_currency_placeholder')}</option>
                       {enabledCurrencies.map((currency) => (
                        <option
                         key={currency.id}
                         value={currency.id}
                        >
                         {currency.code}
                        </option>
                       ))}
                      </select>
                     </div>
                    ) : txSumMode ? (
                     (() => {
                      const inSum = txSumSelection.has(txn.id);
                      return (
                       <button
                        type="button"
                        onClick={() => toggleTxSumEntry(txn.id)}
                        className={`cursor-pointer whitespace-nowrap rounded px-1.5 py-0.5 transition ${inSum ? 'bg-violet-bg ring-1 ring-purple-400' : 'hover:bg-violet-bg'}`}
                       >
                        <span className="font-semibold">{txn.amount.toLocaleString(numLocale)}</span> <span className="text-fg-faint">{txn.currencySymbol || txn.currencyCode}</span>
                       </button>
                      );
                     })()
                    ) : (
                     <span className="whitespace-nowrap">
                      <span className="font-semibold">{txn.amount.toLocaleString(numLocale)}</span> <span className="text-fg-faint">{txn.currencySymbol || txn.currencyCode}</span>
                     </span>
                    )}
                   </td>
                  ) : null}
                  {transactionTableSettings.columns.exchangeRate ? (
                   <td className="whitespace-nowrap px-4 py-3 text-fg-muted">
                    {isEditingRow && draft ? (
                     <div className="space-y-2">
                      {/* From-leg rate — editable only when the sent amount's currency differs
                          from the source account currency (otherwise the rate is a meaningless 1). */}
                      {txn.currencyCode && txn.accountFromCurrencyCode && txn.currencyCode !== txn.accountFromCurrencyCode ? (
                       <div className="space-y-1">
                        <div className="flex items-center justify-between gap-1">
                         <span className="text-xs text-fg-faint">
                          {tableRateFromReversed[txn.id] ? ltrIsolate(`1 ${txn.accountFromCurrencyCode} = ? ${txn.currencyCode}`) : ltrIsolate(`1 ${txn.currencyCode} = ? ${txn.accountFromCurrencyCode}`)}
                         </span>
                         <button
                          type="button"
                          title="Reverse rate direction"
                          onClick={() => {
                           const val = parseFloat(draft.exchangeRateFrom) || 1;
                           updateTransactionTableDraft(txn.id, { exchangeRateFrom: (1 / val).toFixed(6).replace(/\.?0+$/, '') });
                           setTableRateFromReversed((prev) => ({ ...prev, [txn.id]: !prev[txn.id] }));
                          }}
                          className="ml-1 inline-flex items-center gap-0.5 rounded p-0.5 text-fg-faint hover:text-fg-muted"
                         >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                           <path d="M7 4 3 8l4 4M3 8h13.5" />
                           <path d="M17 20l4-4-4-4m4 4H7.5" />
                          </svg>
                          <span className="text-xs font-semibold" aria-hidden>
                           {tableRateFromReversed[txn.id] ? '÷' : '×'}
                          </span>
                         </button>
                        </div>
                        <input
                         type="text"
                         inputMode="decimal"
                         dir="ltr"
                         value={draft.exchangeRateFrom}
                         onChange={(event) => updateTransactionTableDraft(txn.id, { exchangeRateFrom: normalizePlainDecimalInput(event.target.value) })}
                         className={`${seamlessInputClassName} w-full min-w-16 text-sm text-fg`}
                         placeholder={t('transaction_exchange_rate')}
                        />
                       </div>
                      ) : null}
                      {/* To-leg rate — only when the received currency differs from the destination account. */}
                      {txn.currencyCode && txn.accountToCurrencyCode && txn.currencyCode !== txn.accountToCurrencyCode ? (
                       <div className="space-y-1">
                        <div className="flex items-center justify-between gap-1">
                         <span className="text-xs text-fg-faint">
                          {tableRateToReversed[txn.id] ? ltrIsolate(`1 ${txn.accountToCurrencyCode} = ? ${txn.currencyCode}`) : ltrIsolate(`1 ${txn.currencyCode} = ? ${txn.accountToCurrencyCode}`)}
                         </span>
                         <button
                          type="button"
                          title="Reverse rate direction"
                          onClick={() => {
                           const val = parseFloat(draft.exchangeRateTo) || 1;
                           updateTransactionTableDraft(txn.id, { exchangeRateTo: (1 / val).toFixed(6).replace(/\.?0+$/, '') });
                           setTableRateToReversed((prev) => ({ ...prev, [txn.id]: !prev[txn.id] }));
                          }}
                          className="ml-1 inline-flex items-center gap-0.5 rounded p-0.5 text-fg-faint hover:text-fg-muted"
                         >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                           <path d="M7 4 3 8l4 4M3 8h13.5" />
                           <path d="M17 20l4-4-4-4m4 4H7.5" />
                          </svg>
                          <span className="text-xs font-semibold" aria-hidden>
                           {tableRateToReversed[txn.id] ? '÷' : '×'}
                          </span>
                         </button>
                        </div>
                        <input
                         type="text"
                         inputMode="decimal"
                         dir="ltr"
                         value={draft.exchangeRateTo}
                         onChange={(event) => updateTransactionTableDraft(txn.id, { exchangeRateTo: normalizePlainDecimalInput(event.target.value) })}
                         className={`${seamlessInputClassName} w-full min-w-16 text-sm text-fg`}
                         placeholder={t('transaction_exchange_rate')}
                        />
                       </div>
                      ) : null}
                     </div>
                    ) : txn.exchangeRateFrom !== 1 || txn.exchangeRateTo !== 1 ? (
                     <div className="space-y-0.5 text-xs">
                      {txn.exchangeRateFrom !== 1 ? (
                       <div>
                        {txn.clientFromName}: {txn.exchangeRateFromReversed ? formatRateValue(1 / txn.exchangeRateFrom) : formatRateValue(txn.exchangeRateFrom)}
                       </div>
                      ) : null}
                      {txn.exchangeRateTo !== 1 ? (
                       <div>
                        {txn.clientToName}: {txn.exchangeRateToReversed ? formatRateValue(1 / txn.exchangeRateTo) : formatRateValue(txn.exchangeRateTo)}
                       </div>
                      ) : null}
                     </div>
                    ) : (
                     <span className="text-fg-faint">-</span>
                    )}
                   </td>
                  ) : null}
                  {transactionTableSettings.columns.charges ? (
                   <td className="px-4 py-3 text-fg-muted">
                    {isEditingRow && draft ? (
                     (() => {
                      const isZero = parseFloat(draft.charges) === 0;
                      const expanded = expensesExpandedTxns.has(txn.id);
                      if (isZero && !expanded) {
                       return (
                        <button
                         type="button"
                         onClick={() => setExpensesExpandedTxns((prev) => new Set([...prev, txn.id]))}
                         className="text-sm text-accent hover:underline"
                        >
                         + {t('add_expenses')}
                        </button>
                       );
                      }
                      return (
                       <ChargesEditFields
                        t={t}
                        charges={draft.charges}
                        onChargesChange={(value) => updateTransactionTableDraft(txn.id, { charges: value })}
                        chargesPayer={draft.chargesPayer}
                        onChargesPayerChange={(chargesPayer) => updateTransactionTableDraft(txn.id, { chargesPayer })}
                        chargesDescription={draft.chargesDescription}
                        onChargesDescriptionChange={(value) => updateTransactionTableDraft(txn.id, { chargesDescription: value })}
                        fromLabel={txn.clientFromName}
                        toLabel={txn.clientToName}
                        meLabel={t('charges_payer_me')}
                       />
                      );
                     })()
                    ) : txn.charges ? (
                     <div>
                      <span className="whitespace-nowrap">
                       <span>{txn.charges.toLocaleString(numLocale)}</span>
                       {txn.chargesCurrencyCode && <span className="text-fg-faint"> {txn.chargesCurrencyCode}</span>}
                      </span>
                      {txn.chargesExchangeRate !== 1 && txn.chargesCurrencyCode && <div className="text-xs text-fg-faint">@ {txn.chargesExchangeRate.toFixed(4)}</div>}
                      {txn.chargesPayer && (
                       <div className="text-xs text-fg-faint">
                        {txn.chargesPayer === 'from'
                         ? txn.clientFromName
                         : txn.chargesPayer === 'to'
                           ? txn.clientToName
                           : txn.chargesPayer === 'me_to_from'
                             ? t('charges_payer_me_to_name', { name: txn.clientFromName })
                             : txn.chargesPayer === 'me_to_to'
                               ? t('charges_payer_me_to_name', { name: txn.clientToName })
                               : txn.chargesPayer === 'from_to_me'
                                 ? t('charges_payer_name_to_me', { name: txn.clientFromName })
                                 : txn.chargesPayer === 'to_to_me'
                                   ? t('charges_payer_name_to_me', { name: txn.clientToName })
                                   : ''}
                       </div>
                      )}
                      {txn.chargesDescription && <div className="text-xs italic text-fg-faint">{txn.chargesDescription}</div>}
                     </div>
                    ) : (
                     <span className="text-fg-faint">-</span>
                    )}
                   </td>
                  ) : null}
                  {transactionTableSettings.columns.commission ? (
                   <td className="px-4 py-3 text-fg-muted">
                    {isEditingRow && draft ? (
                     (() => {
                      const bothZero = parseFloat(draft.commissionFrom) === 0 && parseFloat(draft.commissionTo) === 0;
                      const expanded = commissionExpandedTxns.has(txn.id);
                      if (bothZero && !expanded) {
                       return (
                        <button
                         type="button"
                         onClick={() => setCommissionExpandedTxns((prev) => new Set([...prev, txn.id]))}
                         className="text-sm text-accent hover:underline"
                        >
                         + {t('add_commission')}
                        </button>
                       );
                      }
                      return (
                       <div className="space-y-2">
                        <div className="flex items-center gap-2">
                         <span className="shrink-0 text-xs text-fg-faint">{txn.clientFromName}:</span>
                         <input
                          type="text"
                          inputMode="decimal"
                          dir="ltr"
                          value={draft.commissionFrom}
                          onChange={(event) => updateTransactionTableDraft(txn.id, { commissionFrom: normalizePlainDecimalInput(event.target.value) })}
                          className={`${seamlessInputClassName} min-w-12 text-sm text-fg`}
                          placeholder="0"
                         />
                         <span className="text-xs text-fg-faint">%</span>
                        </div>
                        <div className="flex items-center gap-2">
                         <span className="shrink-0 text-xs text-fg-faint">{txn.clientToName}:</span>
                         <input
                          type="text"
                          inputMode="decimal"
                          dir="ltr"
                          value={draft.commissionTo}
                          onChange={(event) => updateTransactionTableDraft(txn.id, { commissionTo: normalizePlainDecimalInput(event.target.value) })}
                          className={`${seamlessInputClassName} min-w-12 text-sm text-fg`}
                          placeholder="0"
                         />
                         <span className="text-xs text-fg-faint">%</span>
                        </div>
                       </div>
                      );
                     })()
                    ) : (
                     (() => {
                      const parts: string[] = [];
                      if (txn.commissionFrom) parts.push(`${txn.clientFromName}: ${formatRateValue(txn.commissionFrom)}%`);
                      if (txn.commissionTo) parts.push(`${txn.clientToName}: ${formatRateValue(txn.commissionTo)}%`);
                      return parts.length > 0 ? (
                       <div className="space-y-0.5 text-xs">
                        {parts.map((p, i) => (
                         <div key={i}>{p}</div>
                        ))}
                       </div>
                      ) : (
                       <span className="text-fg-faint">-</span>
                      );
                     })()
                    )}
                   </td>
                  ) : null}
                  {section === 'archive' ? (
                   <td className="px-4 py-3 text-fg-muted">
                    <div className="flex w-full items-center gap-2">
                    {isEditingRow && draft ? (
                     <input
                      type="text"
                      value={draft.archiveNote}
                      onChange={(event) => updateTransactionTableDraft(txn.id, { archiveNote: event.target.value })}
                      placeholder={t('archive_more_info_placeholder')}
                      className={`${seamlessInputClassName} w-full text-sm text-fg`}
                     />
                    ) : (
                     <div className="min-w-0 flex-1" title={txn.archiveNote || undefined}>
                      <EditableField
                       editValue={txn.archiveNote}
                       display={txn.archiveNote || <span className="text-fg-faint">-</span>}
                       align={isRTL ? 'right' : 'left'}
                       placeholder={t('archive_more_info_placeholder')}
                       className="block w-full truncate"
                       onCommit={(raw) => void onUpdateTransactionFields(txn.id, { archiveNote: raw })}
                      />
                     </div>
                    )}
                    {txn.isArchived ? (
                     <span
                      title={t('archive_only_badge_hint')}
                      aria-label={t('archive_only_badge')}
                      className="ml-auto inline-flex shrink-0 items-center justify-center rounded border border-amber-300 bg-warn-bg p-1 text-warn-text"
                     >
                      <svg
                       width="12"
                       height="12"
                       viewBox="0 0 24 24"
                       fill="none"
                       stroke="currentColor"
                       strokeWidth="2.2"
                       strokeLinecap="round"
                       strokeLinejoin="round"
                       aria-hidden
                      >
                       <rect
                        x="3"
                        y="4"
                        width="18"
                        height="4"
                        rx="1"
                       />
                       <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
                       <path d="M10 12h4" />
                      </svg>
                     </span>
                    ) : null}
                    </div>
                   </td>
                  ) : null}
                 </>
                );
               })()}
              </tr>
             ))}
             {displayedTransactionRows.length === 0 ? (
              <tr>
               <td
                className="px-4 py-6 text-fg-faint"
                colSpan={visibleTransactionColumnCount - (selectionMode ? 0 : 1) + (section === 'archive' ? 1 : 0)}
               >
                {section === 'archive' ? t('archive_empty') : t('no_transactions')}
               </td>
              </tr>
             ) : null}
            </tbody>
            {section === 'archive' && archiveCurrencyTotals.length > 0 ? (
             <tfoot>
              <tr className="border-t-2 border-border-strong bg-surface-2">
               <td
                colSpan={visibleTransactionColumnCount - (selectionMode ? 0 : 1) + 1}
                className="px-4 py-3"
               >
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                 <span className="text-sm font-semibold uppercase tracking-wide text-fg-faint">{t('archive_totals')}</span>
                 {archiveCurrencyTotals.map((total) => (
                  <span
                   key={total.code}
                   className="text-sm font-semibold text-fg"
                  >
                   {total.total.toLocaleString(numLocale)} <span className="font-normal text-fg-faint">{total.symbol || total.code}</span>
                  </span>
                 ))}
                </div>
               </td>
              </tr>
             </tfoot>
            ) : null}
           </table>
          </div>
          {transactionsPager}
         </div>
        </section>
   <ContextMenu menu={rowContextMenu.menu} onClose={closeRowMenu} zoom={tableZoom} />
   <ContextMenu menu={gearMenu.menu} onClose={gearMenu.close} zoom={tableZoom} />
   <ContextMenu menu={missingCounterpartyMenu.menu} onClose={missingCounterpartyMenu.close} zoom={tableZoom} />
   <ContextMenu menu={anomalyReviewMenu.menu} onClose={anomalyReviewMenu.close} zoom={tableZoom} />
   {editingRowIds.size > 0 && typeof document !== 'undefined' ? createPortal(
    <div className={`fixed bottom-6 z-30 flex flex-col gap-3 sm:hidden ${isRTL ? 'left-6' : 'right-6'}`}>
     <button
      type="button"
      title={t('save_changes')}
      onClick={() => void onSaveAllTransactions()}
      className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg active:bg-emerald-700"
     >
      <svg
       width="22"
       height="22"
       viewBox="0 0 24 24"
       fill="none"
       stroke="currentColor"
       strokeWidth="2.5"
       strokeLinecap="round"
       strokeLinejoin="round"
       aria-hidden
      >
       <polyline points="20 6 9 17 4 12" />
      </svg>
     </button>
     <button
      type="button"
      title={t('cancel')}
      onClick={() => onCancelAllTransactions()}
      className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-fg-faint shadow-lg ring-1 ring-slate-300 active:bg-surface-hover"
     >
      <svg
       width="20"
       height="20"
       viewBox="0 0 24 24"
       fill="none"
       stroke="currentColor"
       strokeWidth="2.5"
       strokeLinecap="round"
       strokeLinejoin="round"
       aria-hidden
      >
       <line x1="18" y1="6" x2="6" y2="18" />
       <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
     </button>
    </div>,
    document.body,
   ) : null}

   <ArchiveExportModal
    displayedTransactionRows={displayedTransactionRows}
    highlightedTxRows={highlightedTxRows}
    onExport={onExportArchivePdf}
   />
  </>
 );
}
