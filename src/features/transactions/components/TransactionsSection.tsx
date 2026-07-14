'use client';

import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ChangeEvent, FormEvent, KeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from 'react';
import { usePointerDrag } from '@/shared/hooks/usePointerDrag';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTheme } from '@/contexts/ThemeContext';
import { resolveHighlightBg } from '@/shared/utils/highlightColor';
import { useTranslation } from '@/hooks/useTranslation';
import { panelClassName, tableWrapClassName } from '@/shared/styles';
import { SkTablePanel, SK_TX } from '@/shared/components/skeletons/Skeletons';
import { TableZoomControl } from '@/shared/components/TableZoomControl';
import { getStoredTableZoom, saveTableZoom, getStoredDescriptionSuggestionExclusions, saveDescriptionSuggestionExclusions, getStoredExchangeSettings } from '@/shared/lib/localStorage';
import { formatAmountInput, normalizeDecimalInput, normalizePlainDecimalInput } from '@/shared/utils/decimal';
import { formatRateValue, HIGHLIGHT_PEN_CURSOR, ltrIsolate } from '@/shared/utils/format';
import { formatDateValue } from '@/shared/utils/date';
import { useAppStatusStore } from '@/shared/store/appStatusStore';
import { ContextMenu, useContextMenu } from '@/shared/components/ContextMenu';
import ChargesPayerSelects from '@/shared/components/ChargesPayerSelects';
import type { DraftHistory } from '@/shared/hooks/useDraftHistory';
import { useTransactionsStore, type ArchiveExportModalState } from '@/features/transactions/store/transactionsStore';
import AccountSearchSelect from '@/features/transactions/components/AccountSearchSelect';
import ArchiveExportModal from '@/features/transactions/components/ArchiveExportModal';
import { buildAccountOptions, type AccountOption } from '@/features/transactions/utils/accountOptions';
import type {
 Client,
 ClientAccount,
 Currency,
 Section,
 Transaction,
 TransactionTableDraft,
 TransactionTableRow,
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
 showChargesExchangeRate: boolean;
 showExchangeRateFrom: boolean;
 showExchangeRateTo: boolean;
 transactionAccountFromCurrencyCode: string | undefined;
 transactionAccountToCurrencyCode: string | undefined;
 transactionSelectedCurrencyCode: string | undefined;
 getTransactionTableDraft: (transactionId: number) => TransactionTableDraft | null;
 updateTransactionTableDraft: (transactionId: number, nextValues: Partial<TransactionTableDraft>) => void;
 txTableHistory: DraftHistory;
 highlightedTxRows: Map<number, string>;
 txRowClickHighlight: boolean;
 txRowClickActive: boolean;
 txSumMode: boolean;
 txSumSelection: Set<number>;
 txSumByCurrency: SumCurrencyTotal[];
 transactionsImportInputRef: RefObject<HTMLInputElement | null>;
 onCancelAllTransactions: () => void;
 onCopyTransactionRow: (row: TransactionTableRow) => void;
 onDeleteSelectedTransactions: () => void;
 onDeleteTransactionTableRow: (row: TransactionTableRow) => void;
 onEditAllTransactions: () => void;
 onExportArchivePdf: (range?: ArchiveExportModalState) => void;
 openArchiveExportModal: () => void;
 onImportTransactionsFile: (event: ChangeEvent<HTMLInputElement>) => void;
 onPasteCopiedTransaction: () => void;
 onSaveAllTransactions: () => void;
 onSaveTransactionTableRow: (transactionId: number, opts?: { skipReload?: boolean }) => void;
 onToggleSelectAllTransactions: () => void;
 onToggleTransactionSelection: (transactionId: number) => void;
 onTransactionRowDrop: (draggedIds: number[], targetId: number, dropHalf: 'top' | 'bottom') => void;
 onTransactionSubmit: (event: FormEvent<HTMLFormElement>) => void;
 openClientLedger: (client: Client, origin?: 'clients' | 'organization-clients', accountId?: number | null) => void;
 openTransactionExportModal: () => void;
 openTransactionTableSettingsModal: () => void;
 setTxRowClickMode: (mode: 'highlight' | 'copy' | 'none') => void;
 toggleTxRowHighlight: (txnId: number) => void;
 toggleTxSumMode: () => void;
 toggleTxSumEntry: (id: number) => void;
};

export default function TransactionsSection(props: TransactionsSectionProps) {
 const {
  isLoading, section, clients, clientAccounts, enabledCurrencies, transactions, clientAccountMap, currencyMap,
  displayedTransactionRows, paginatedTransactions, transactionsPager, txFilterClientOptions, visibleTransactionColumnCount,
  selectedTransactionSums, archiveCurrencyTotals, showChargesExchangeRate, showExchangeRateFrom, showExchangeRateTo,
  transactionAccountFromCurrencyCode, transactionAccountToCurrencyCode, transactionSelectedCurrencyCode,
  getTransactionTableDraft, updateTransactionTableDraft, txTableHistory, highlightedTxRows, txRowClickHighlight, txRowClickActive,
  txSumMode, txSumSelection, txSumByCurrency,
  transactionsImportInputRef, onCancelAllTransactions, onCopyTransactionRow, onDeleteSelectedTransactions,
  onDeleteTransactionTableRow, onEditAllTransactions, onExportArchivePdf, openArchiveExportModal, onImportTransactionsFile, onPasteCopiedTransaction,
  onSaveAllTransactions, onSaveTransactionTableRow, onToggleSelectAllTransactions, onToggleTransactionSelection,
  onTransactionRowDrop, onTransactionSubmit, openClientLedger, openTransactionExportModal, openTransactionTableSettingsModal,
  setTxRowClickMode, toggleTxRowHighlight, toggleTxSumMode, toggleTxSumEntry,
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
 const clientMap = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);
 const { selectedTransactionIds, setSelectedTransactionIds, editingRowIds, setEditingRowIds, isEditAllTransactions, dragRowId, setDragRowId, dragOverRowId, setDragOverRowId, dragOverHalf, setDragOverHalf, transactionTableSettings: transactionTableSettingsStore, archiveTableSettings, txSortDir, setTxSortDir, txFilterOpen, setTxFilterOpen, txFilterSearch, setTxFilterSearch, txFilterWholeWord, setTxFilterWholeWord, txFilterClient, setTxFilterClient, txFilterDateFrom, setTxFilterDateFrom, txFilterDateTo, setTxFilterDateTo, txFilterHideExpenses, setTxFilterHideExpenses, commissionExpandedTxns, setCommissionExpandedTxns, expensesExpandedTxns, setExpensesExpandedTxns, isNewTransactionSectionOpen, setIsNewTransactionSectionOpen, isNewTransactionExpensesOpen, setIsNewTransactionExpensesOpen, transactionTableDrafts, transactionForm, setTransactionForm, isSubmittingTransaction, txSplitDescription, setTxSplitDescription, newTransactionDate, setNewTransactionDate, copiedTransaction, txFromQuery, setTxFromQuery, txFromOpen, setTxFromOpen, txFromExpandedClient, setTxFromExpandedClient, txToQuery, setTxToQuery, txToOpen, setTxToOpen, txToExpandedClient, setTxToExpandedClient, descriptionSuggestOpen, setDescriptionSuggestOpen, txFromRateReversed, setTxFromRateReversed, txToRateReversed, setTxToRateReversed, tableRateFromReversed, setTableRateFromReversed, tableRateToReversed, setTableRateToReversed, isImportingTransactions } = useTransactionsStore();
 // Archive keeps its own column-visibility/date-format settings, separate from the
 // Transactions table (see transactionsStore.ts) — resolve whichever is active here so
 // every downstream read of `transactionTableSettings` in this file is section-aware.
 const transactionTableSettings = section === 'archive' ? archiveTableSettings : transactionTableSettingsStore;
 const isAdjustmentTransaction = section !== 'archive' && transactionForm.type === 'adjustment';
 // Exchange (صرف) transactions get the الفعلي (actual settled destination amount) section in
 // place of the "Extra Expenses" block. Archive-only records never touch a ledger, so they keep
 // the plain Extra Expenses behaviour.
 const isExchangeTransaction = section !== 'archive' && transactionForm.type === 'exchange';

 // Shared by the row's onContextMenu (desktop right-click) and its visible "⋮" button
 // (touch devices have no right-click event to hook into). contextMenuRowId drives a
 // border on whichever row the open menu belongs to, so it's clear which row the menu's
 // actions apply to; closeRowMenu clears it alongside the menu itself.
 const [contextMenuRowId, setContextMenuRowId] = useState<number | null>(null);

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

 // Descriptions dismissed from the autocomplete dropdown via its per-suggestion "x".
 // Persisted so a removed suggestion stays gone across reloads, even though the
 // suggestion list itself is derived live from past transactions each render.
 const [excludedDescriptionSuggestions, setExcludedDescriptionSuggestions] = useState<Set<string>>(() => getStoredDescriptionSuggestionExclusions());
 const excludeDescriptionSuggestion = (desc: string) => {
  setExcludedDescriptionSuggestions((current) => {
   const next = new Set(current);
   next.add(desc.trim().toLowerCase());
   saveDescriptionSuggestionExclusions(next);
   return next;
  });
 };
 const openRowMenu = (event: ReactMouseEvent, txn: Transaction) => {
  if (editingRowIds.has(txn.id)) return;
  setContextMenuRowId(txn.id);
  rowContextMenu.open(event, [
   { key: 'edit', label: t('edit'), onSelect: () => setEditingRowIds((prev) => new Set([...prev, txn.id])) },
   { key: 'copy', label: t('copy_transaction'), onSelect: () => onCopyTransactionRow(txn) },
   { key: 'delete', label: t('delete'), onSelect: () => void onDeleteTransactionTableRow(txn), tone: 'danger' as const },
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
  [transactionTableSettings.columns.accountFrom, 17],
  [transactionTableSettings.columns.accountTo, 17],
  [transactionTableSettings.columns.amount, 13],
  [transactionTableSettings.columns.charges, 13],
  [transactionTableSettings.columns.commission, 15],
  [section === 'archive', 16],
 ];
 const totalColumnWeight = columnWeights.reduce((sum, [visible, weight]) => (visible ? sum + weight : sum), 0) || 1;
 const colWidthPercent = (weight: number) => `${((weight / totalColumnWeight) * 100).toFixed(2)}%`;

 // Keyboard navigation for the From/To account pickers: the highlighted index tracks the row
 // that ↑/↓ move through and Enter activates. The option lists are flattened from the same
 // grouping the dropdowns render, so index N always points at the Nth rendered row.
 const [txFromHighlight, setTxFromHighlight] = useState(0);
 const [txToHighlight, setTxToHighlight] = useState(0);
 // Spreadsheet-style zoom for the (often very wide) transactions table, so it fits on narrow screens.
 const [tableZoom, setTableZoom] = useState(() => getStoredTableZoom('transactions'));
 // Max allowed deviation (in the destination currency) between the entered الفعلي actual amount
 // and the computed amount × rate. Enforced authoritatively at submit; used here for the live hint.
 const [exchangeTolerance] = useState(() => getStoredExchangeSettings().tolerance);
 const changeTableZoom = (z: number) => {
  setTableZoom(z);
  saveTableZoom('transactions', z);
 };
 const txFromOptions = useMemo(() => buildAccountOptions(clientAccounts, txFromQuery, txFromExpandedClient), [clientAccounts, txFromQuery, txFromExpandedClient]);
 const txToOptions = useMemo(() => buildAccountOptions(clientAccounts, txToQuery, txToExpandedClient), [clientAccounts, txToQuery, txToExpandedClient]);

 const selectFromAccount = (id: number) => {
  setTransactionForm((current) => ({ ...current, accountFromId: id }));
  setTxFromQuery('');
  setTxFromOpen(false);
  setTxFromExpandedClient(null);
 };
 const selectToAccount = (id: number) => {
  setTransactionForm((current) => ({ ...current, accountToId: id }));
  setTxToQuery('');
  setTxToOpen(false);
  setTxToExpandedClient(null);
 };

 // Shared arrow/Enter/Escape behaviour for both pickers. Enter on a group header expands or
 // collapses it (keeping the highlight put so the user can arrow into its accounts); Enter on
 // an account selects it.
 const handleAccountPickerKeyDown = (
  event: KeyboardEvent<HTMLInputElement>,
  isOpen: boolean,
  options: AccountOption[],
  highlight: number,
  setHighlight: (updater: (h: number) => number) => void,
  toggleExpanded: (clientId: number, expanded: boolean) => void,
  selectAccount: (id: number) => void,
  close: () => void,
 ) => {
  // Dropdown closed → let the keystroke do its normal thing (e.g. Enter submits the form).
  if (!isOpen) return;
  if (event.key === 'ArrowDown') {
   event.preventDefault();
   setHighlight((h) => (options.length ? (h + 1) % options.length : 0));
  } else if (event.key === 'ArrowUp') {
   event.preventDefault();
   setHighlight((h) => (options.length ? (h - 1 + options.length) % options.length : 0));
  } else if (event.key === 'Enter') {
   const option = options[highlight];
   if (!option) return;
   event.preventDefault();
   if (option.kind === 'group') toggleExpanded(option.clientId, option.expanded);
   else selectAccount(option.account.id);
  } else if (event.key === 'Escape') {
   close();
  }
 };

 const chargesCurrencyCode = transactionForm.chargesCurrencyId ? currencyMap.get(transactionForm.chargesCurrencyId)?.code : undefined;
 const chargesPayerAccountCurrencyCode =
  transactionForm.chargesPayer === 'from' ? transactionAccountFromCurrencyCode : transactionForm.chargesPayer === 'to' ? transactionAccountToCurrencyCode : undefined;

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
         {(section === 'transactions' || section === 'archive') && isNewTransactionSectionOpen ? (
          <div className={`${panelClassName} xl:w-96 xl:shrink-0`}>
           <div className="flex items-start justify-between gap-3">
            <h2 className="text-xl font-semibold">{section === 'archive' ? t('archive_new_transaction') : t('new_transaction')}</h2>
            <div className="flex shrink-0 items-center gap-2">
             {copiedTransaction ? (
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
               {t('paste_transaction')}
              </button>
             ) : null}
             <button
              type="button"
              onClick={() => setIsNewTransactionSectionOpen(false)}
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

           <form
            onSubmit={onTransactionSubmit}
            className="mt-5 max-w-md"
           >
            <label className="block text-sm font-medium">{t('transaction_type')}</label>
            <select
             value={transactionForm.type}
             onChange={(event) =>
              setTransactionForm((current) => ({
               ...current,
               type: event.target.value,
               chargesPayer: event.target.value === 'adjustment' ? '' : current.chargesPayer,
              }))
             }
             className="mt-2 w-full rounded border border-border-strong px-3 py-2 outline-none ring-blue-300 focus:ring"
            >
             <option value="exchange">{t('transaction_type_exchange')}</option>
             <option value="transfer">{t('transaction_type_transfer')}</option>
             {section === 'archive' ? null : <option value="adjustment">{t('transaction_type_adjustment')}</option>}
            </select>

            <label className="mt-4 block text-sm font-medium">{t('date')}</label>
            <input
             type="date"
             value={newTransactionDate}
             onChange={(event) => setNewTransactionDate(event.target.value)}
             className="mt-2 w-full rounded border border-border-strong px-3 py-2 outline-none ring-blue-300 focus:ring"
            />

            {isAdjustmentTransaction ? (
             <div className="mt-4">
              <label className="block text-sm font-medium">{t('adjustment_direction')}</label>
              <div className="mt-2 grid grid-cols-2 gap-2">
               <button
                type="button"
                onClick={() => setTransactionForm((current) => ({ ...current, adjustmentDirection: 'debit' }))}
                className={`rounded border px-3 py-2 text-sm font-semibold transition ${
                 transactionForm.adjustmentDirection === 'debit'
                  ? 'border-red-500 bg-bad-bg text-bad-text'
                  : 'border-border-strong bg-surface text-fg-muted hover:bg-surface-hover'
                }`}
               >
                {t('adjustment_direction_debit')}
               </button>
               <button
                type="button"
                onClick={() => setTransactionForm((current) => ({ ...current, adjustmentDirection: 'credit' }))}
                className={`rounded border px-3 py-2 text-sm font-semibold transition ${
                 transactionForm.adjustmentDirection === 'credit' ? 'border-emerald-500 bg-good-bg text-good-text' : 'border-border-strong bg-surface text-fg-muted hover:bg-surface-hover'
                }`}
               >
                {t('adjustment_direction_credit')}
               </button>
              </div>
             </div>
            ) : null}

            <label className="block text-sm font-medium">
             {isAdjustmentTransaction ? t('client') : t('transaction_account_from')}
             {isAdjustmentTransaction ? <span className="text-bad-text"> *</span> : null}
            </label>
            <div className="relative mt-2">
             <input
              type="text"
              value={
               txFromOpen
                ? txFromQuery
                : transactionForm.accountFromId
                  ? (clientAccounts.find((a) => a.id === transactionForm.accountFromId)?.clientName ?? '') +
                    ' · ' +
                    (clientAccounts.find((a) => a.id === transactionForm.accountFromId)?.currencyCode ?? '')
                  : ''
              }
              onChange={(event) => {
               setTxFromQuery(event.target.value);
               setTxFromOpen(true);
               setTxFromHighlight(0);
              }}
              onFocus={() => {
               setTxFromQuery('');
               setTxFromOpen(true);
               setTxFromHighlight(0);
              }}
              onBlur={() => setTimeout(() => setTxFromOpen(false), 150)}
              onKeyDown={(event) =>
               handleAccountPickerKeyDown(
                event,
                txFromOpen,
                txFromOptions,
                txFromHighlight,
                setTxFromHighlight,
                (clientId, expanded) => setTxFromExpandedClient(expanded && !txFromQuery.trim() ? null : clientId),
                selectFromAccount,
                () => setTxFromOpen(false),
               )
              }
              placeholder={t('transaction_account_placeholder')}
              className={`w-full rounded border border-border-strong px-3 py-2 outline-none ring-blue-300 focus:ring ${isRTL ? 'pl-9' : 'pr-9'}`}
              autoComplete="off"
             />
             {transactionForm.accountFromId && !txFromOpen ? (
              <button
               type="button"
               onMouseDown={(event) => {
                event.preventDefault();
                setTransactionForm((current) => ({ ...current, accountFromId: null }));
                setTxFromQuery('');
                setTxFromOpen(false);
               }}
               title={t('clear_selection')}
               aria-label={t('clear_selection')}
               className={`absolute inset-y-0 my-auto flex h-6 w-6 items-center justify-center rounded text-fg-faint hover:bg-surface-hover hover:text-fg-muted ${isRTL ? 'left-2' : 'right-2'}`}
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
             ) : null}
             {txFromOpen && (
              <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded border border-border bg-surface shadow-lg">
               {txFromOptions.length === 0 ? (
                <li className="px-3 py-2 text-sm text-fg-faint">{t('transaction_account_placeholder')}</li>
               ) : (
                txFromOptions.map((option, index) => {
                 const highlighted = index === txFromHighlight;
                 // Keeps the keyboard-highlighted row scrolled into view as ↑/↓ move past the fold.
                 const highlightRef = highlighted ? (el: HTMLLIElement | null) => el?.scrollIntoView({ block: 'nearest' }) : undefined;
                 if (option.kind === 'single') {
                  const account = option.account;
                  const selected = transactionForm.accountFromId === account.id;
                  return (
                   <li
                    key={`s${account.id}`}
                    ref={highlightRef}
                    onMouseDown={() => selectFromAccount(account.id)}
                    onMouseEnter={() => setTxFromHighlight(index)}
                    className={`cursor-pointer px-3 py-2 text-sm ${highlighted ? 'bg-accent-weak' : selected ? 'bg-accent-weak' : ''} ${selected ? 'font-medium text-accent' : 'text-fg'}`}
                   >
                    {account.clientName} · {account.currencyCode}
                   </li>
                  );
                 }
                 if (option.kind === 'group') {
                  const groupHasSelected = clientAccounts.some((a) => a.clientId === option.clientId && a.id === transactionForm.accountFromId);
                  return (
                   <li
                    key={`g${option.clientId}`}
                    ref={highlightRef}
                    onMouseDown={(e) => {
                     e.preventDefault();
                     setTxFromExpandedClient(option.expanded && !txFromQuery.trim() ? null : option.clientId);
                    }}
                    onMouseEnter={() => setTxFromHighlight(index)}
                    className={`flex cursor-pointer items-center justify-between px-3 py-2 text-sm ${highlighted ? 'bg-accent-weak' : ''} ${groupHasSelected ? 'font-medium text-accent' : 'text-fg'}`}
                   >
                    <span>
                     {option.clientName} <span className="text-fg-faint">({option.count})</span>
                    </span>
                    <svg
                     width="12"
                     height="12"
                     viewBox="0 0 24 24"
                     fill="none"
                     stroke="currentColor"
                     strokeWidth="2"
                     strokeLinecap="round"
                     strokeLinejoin="round"
                     className={`text-fg-faint transition-transform ${option.expanded ? 'rotate-180' : ''}`}
                     aria-hidden
                    >
                     <path d="m6 9 6 6 6-6" />
                    </svg>
                   </li>
                  );
                 }
                 const account = option.account;
                 const selected = transactionForm.accountFromId === account.id;
                 return (
                  <li
                   key={`c${account.id}`}
                   ref={highlightRef}
                   onMouseDown={() => selectFromAccount(account.id)}
                   onMouseEnter={() => setTxFromHighlight(index)}
                   className={`cursor-pointer py-2 pl-8 pr-3 text-sm ${highlighted ? 'bg-accent-weak' : selected ? 'bg-accent-weak' : ''} ${selected ? 'font-medium text-accent' : 'text-fg-muted'}`}
                  >
                   {account.currencyCode}
                   {account.currencySymbol ? ` (${account.currencySymbol})` : ''}
                  </li>
                 );
                })
               )}
              </ul>
             )}
            </div>

            {!isAdjustmentTransaction ? (
             <>
              <label className="mt-4 block text-sm font-medium">{t('transaction_account_to')}</label>
              <div className="relative mt-2">
               <input
                type="text"
                value={
                 txToOpen
                  ? txToQuery
                  : transactionForm.accountToId
                    ? (clientAccounts.find((a) => a.id === transactionForm.accountToId)?.clientName ?? '') +
                      ' · ' +
                      (clientAccounts.find((a) => a.id === transactionForm.accountToId)?.currencyCode ?? '')
                    : ''
                }
                onChange={(event) => {
                 setTxToQuery(event.target.value);
                 setTxToOpen(true);
                 setTxToHighlight(0);
                }}
                onFocus={() => {
                 setTxToQuery('');
                 setTxToOpen(true);
                 setTxToHighlight(0);
                }}
                onBlur={() => setTimeout(() => setTxToOpen(false), 150)}
                onKeyDown={(event) =>
                 handleAccountPickerKeyDown(
                  event,
                  txToOpen,
                  txToOptions,
                  txToHighlight,
                  setTxToHighlight,
                  (clientId, expanded) => setTxToExpandedClient(expanded && !txToQuery.trim() ? null : clientId),
                  selectToAccount,
                  () => setTxToOpen(false),
                 )
                }
                placeholder={t('transaction_account_placeholder')}
                className={`w-full rounded border border-border-strong px-3 py-2 outline-none ring-blue-300 focus:ring ${isRTL ? 'pl-9' : 'pr-9'}`}
                autoComplete="off"
               />
               {transactionForm.accountToId && !txToOpen ? (
                <button
                 type="button"
                 onMouseDown={(event) => {
                  event.preventDefault();
                  setTransactionForm((current) => ({ ...current, accountToId: null }));
                  setTxToQuery('');
                  setTxToOpen(false);
                 }}
                 title={t('clear_selection')}
                 aria-label={t('clear_selection')}
                 className={`absolute inset-y-0 my-auto flex h-6 w-6 items-center justify-center rounded text-fg-faint hover:bg-surface-hover hover:text-fg-muted ${isRTL ? 'left-2' : 'right-2'}`}
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
               ) : null}
               {txToOpen && (
                <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded border border-border bg-surface shadow-lg">
                 {txToOptions.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-fg-faint">{t('transaction_account_placeholder')}</li>
                 ) : (
                  txToOptions.map((option, index) => {
                   const highlighted = index === txToHighlight;
                   const highlightRef = highlighted ? (el: HTMLLIElement | null) => el?.scrollIntoView({ block: 'nearest' }) : undefined;
                   if (option.kind === 'single') {
                    const account = option.account;
                    const selected = transactionForm.accountToId === account.id;
                    return (
                     <li
                      key={`s${account.id}`}
                      ref={highlightRef}
                      onMouseDown={() => selectToAccount(account.id)}
                      onMouseEnter={() => setTxToHighlight(index)}
                      className={`cursor-pointer px-3 py-2 text-sm ${highlighted ? 'bg-accent-weak' : selected ? 'bg-accent-weak' : ''} ${selected ? 'font-medium text-accent' : 'text-fg'}`}
                     >
                      {account.clientName} · {account.currencyCode}
                     </li>
                    );
                   }
                   if (option.kind === 'group') {
                    const groupHasSelected = clientAccounts.some((a) => a.clientId === option.clientId && a.id === transactionForm.accountToId);
                    return (
                     <li
                      key={`g${option.clientId}`}
                      ref={highlightRef}
                      onMouseDown={(e) => {
                       e.preventDefault();
                       setTxToExpandedClient(option.expanded && !txToQuery.trim() ? null : option.clientId);
                      }}
                      onMouseEnter={() => setTxToHighlight(index)}
                      className={`flex cursor-pointer items-center justify-between px-3 py-2 text-sm ${highlighted ? 'bg-accent-weak' : ''} ${groupHasSelected ? 'font-medium text-accent' : 'text-fg'}`}
                     >
                      <span>{option.clientName}</span>
                      <span className="flex items-center gap-1 text-xs text-fg-faint">
                       {option.count}
                       <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={`transition-transform ${option.expanded ? 'rotate-180' : ''}`}
                        aria-hidden
                       >
                        <path d="m6 9 6 6 6-6" />
                       </svg>
                      </span>
                     </li>
                    );
                   }
                   const account = option.account;
                   const selected = transactionForm.accountToId === account.id;
                   return (
                    <li
                     key={`c${account.id}`}
                     ref={highlightRef}
                     onMouseDown={() => selectToAccount(account.id)}
                     onMouseEnter={() => setTxToHighlight(index)}
                     className={`cursor-pointer py-2 pl-8 pr-3 text-sm ${highlighted ? 'bg-accent-weak' : selected ? 'bg-accent-weak' : ''} ${selected ? 'font-medium text-accent' : 'text-fg-muted'}`}
                    >
                     {account.currencyCode}
                     {account.currencySymbol ? ` (${account.currencySymbol})` : ''}
                    </li>
                   );
                  })
                 )}
                </ul>
               )}
              </div>
             </>
            ) : null}

            <label className="mt-4 block text-sm font-medium">
             {t('transaction_amount')}
             {isAdjustmentTransaction ? <span className="text-bad-text"> *</span> : null}
            </label>
            <div className="mt-2 flex gap-2">
             <input
              type="text"
              inputMode="decimal"
              dir="ltr"
              value={transactionForm.amount}
              onChange={(event) => setTransactionForm((current) => ({ ...current, amount: formatAmountInput(event.target.value) }))}
              className="min-w-0 flex-1 rounded border border-border-strong px-3 py-2 outline-none ring-blue-300 focus:ring"
              placeholder="0.00"
              required
             />
             <select
              value={transactionForm.currencyId ?? ''}
              onChange={(event) =>
               setTransactionForm((current) => ({
                ...current,
                currencyId: event.target.value ? Number(event.target.value) : null,
               }))
              }
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

            <div className="mt-4 rounded border border-border bg-surface-2 p-4">
             <h3 className="text-sm font-semibold text-fg-muted">
              {t('transaction_account_from')}
              {transactionForm.accountFromId && clientAccountMap.get(transactionForm.accountFromId)?.clientName ? (
               <span className="ml-1.5 font-normal text-fg-faint">— {clientAccountMap.get(transactionForm.accountFromId)!.clientName}</span>
              ) : null}
             </h3>
             <div className={`mt-2 grid gap-2 ${showExchangeRateFrom && !isAdjustmentTransaction ? 'sm:grid-cols-2' : ''}`}>
              {showExchangeRateFrom && (
               <div>
                <div className="flex items-center justify-between">
                 <label className="block text-xs font-medium text-fg-faint">
                  {transactionSelectedCurrencyCode && transactionAccountFromCurrencyCode
                   ? txFromRateReversed
                     ? ltrIsolate(`1 ${transactionAccountFromCurrencyCode} = ? ${transactionSelectedCurrencyCode}`)
                     : ltrIsolate(`1 ${transactionSelectedCurrencyCode} = ? ${transactionAccountFromCurrencyCode}`)
                   : t('transaction_exchange_rate_from')}
                 </label>
                 {transactionSelectedCurrencyCode && transactionAccountFromCurrencyCode && transactionSelectedCurrencyCode !== transactionAccountFromCurrencyCode && (
                  <button
                   type="button"
                   title="Reverse rate direction"
                   onClick={() => {
                    const val = parseFloat(transactionForm.exchangeRateFrom) || 1;
                    setTransactionForm((c) => ({ ...c, exchangeRateFrom: (1 / val).toFixed(6).replace(/\.?0+$/, '') }));
                    setTxFromRateReversed((r) => !r);
                   }}
                   className="ml-1 inline-flex items-center gap-0.5 rounded p-0.5 text-fg-faint hover:text-fg-muted"
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
                   <span className="text-xs font-semibold" aria-hidden>
                    {txFromRateReversed ? '÷' : '×'}
                   </span>
                  </button>
                 )}
                </div>
                <input
                 type="text"
                 inputMode="decimal"
                 dir="ltr"
                 value={transactionForm.exchangeRateFrom}
                 onChange={(event) => setTransactionForm((current) => ({ ...current, exchangeRateFrom: normalizePlainDecimalInput(event.target.value) }))}
                 className="mt-1 w-full rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                 placeholder="1"
                />
               </div>
              )}
              {!isAdjustmentTransaction ? (
               <div>
                <label className="block text-xs font-medium text-fg-faint">{t('transaction_commission_from')} (%)</label>
                <input
                 type="text"
                 inputMode="decimal"
                 dir="ltr"
                 value={transactionForm.commissionFrom}
                 onChange={(event) => setTransactionForm((current) => ({ ...current, commissionFrom: normalizePlainDecimalInput(event.target.value) }))}
                 className="mt-1 w-full rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                 placeholder="0"
                />
               </div>
              ) : null}
             </div>
            </div>

            {!isAdjustmentTransaction ? (
             <div className="mt-3 rounded border border-border bg-surface-2 p-4">
              <h3 className="text-sm font-semibold text-fg-muted">
               {t('transaction_account_to')}
               {transactionForm.accountToId && clientAccountMap.get(transactionForm.accountToId)?.clientName ? (
                <span className="ml-1.5 font-normal text-fg-faint">— {clientAccountMap.get(transactionForm.accountToId)!.clientName}</span>
               ) : null}
              </h3>
              <div className={`mt-2 grid gap-2 ${showExchangeRateTo ? 'sm:grid-cols-2' : ''}`}>
               {showExchangeRateTo && (
                <div>
                 <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-fg-faint">
                   {transactionSelectedCurrencyCode && transactionAccountToCurrencyCode
                    ? txToRateReversed
                      ? ltrIsolate(`1 ${transactionAccountToCurrencyCode} = ? ${transactionSelectedCurrencyCode}`)
                      : ltrIsolate(`1 ${transactionSelectedCurrencyCode} = ? ${transactionAccountToCurrencyCode}`)
                    : t('transaction_exchange_rate_to')}
                  </label>
                  {transactionSelectedCurrencyCode && transactionAccountToCurrencyCode && transactionSelectedCurrencyCode !== transactionAccountToCurrencyCode && (
                   <button
                    type="button"
                    title="Reverse rate direction"
                    onClick={() => {
                     const val = parseFloat(transactionForm.exchangeRateTo) || 1;
                     setTransactionForm((c) => ({ ...c, exchangeRateTo: (1 / val).toFixed(6).replace(/\.?0+$/, '') }));
                     setTxToRateReversed((r) => !r);
                    }}
                    className="ml-1 inline-flex items-center gap-0.5 rounded p-0.5 text-fg-faint hover:text-fg-muted"
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
                    <span className="text-xs font-semibold" aria-hidden>
                     {txToRateReversed ? '÷' : '×'}
                    </span>
                   </button>
                  )}
                 </div>
                 <input
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  value={transactionForm.exchangeRateTo}
                  onChange={(event) => setTransactionForm((current) => ({ ...current, exchangeRateTo: normalizePlainDecimalInput(event.target.value) }))}
                  className="mt-1 w-full rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                  placeholder="1"
                 />
                </div>
               )}
               <div>
                <label className="block text-xs font-medium text-fg-faint">{t('transaction_commission_to')} (%)</label>
                <input
                 type="text"
                 inputMode="decimal"
                 dir="ltr"
                 value={transactionForm.commissionTo}
                 onChange={(event) => setTransactionForm((current) => ({ ...current, commissionTo: normalizePlainDecimalInput(event.target.value) }))}
                 className="mt-1 w-full rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                 placeholder="0"
                />
               </div>
              </div>
             </div>
            ) : null}

            {isExchangeTransaction
             ? (() => {
                const amountNum = parseFloat(normalizeDecimalInput(transactionForm.amount));
                const rateRaw = parseFloat(transactionForm.exchangeRateTo);
                const effRateTo =
                 showExchangeRateTo && transactionAccountToCurrencyCode
                  ? Number.isFinite(rateRaw) && rateRaw > 0
                    ? txToRateReversed
                      ? 1 / rateRaw
                      : rateRaw
                    : null
                  : 1;
                const computed = Number.isFinite(amountNum) && effRateTo != null ? amountNum * effRateTo : null;
                const actualRaw = transactionForm.exchangeActualAmount.trim();
                const actualNum = parseFloat(normalizeDecimalInput(actualRaw));
                const hasActual = actualRaw !== '' && Number.isFinite(actualNum);
                const diff = computed != null && hasActual ? computed - actualNum : null;
                const outOfTolerance = diff != null && Math.abs(diff) > exchangeTolerance;
                const toCode = transactionAccountToCurrencyCode ?? '';
                return (
                 <div className="mt-4 rounded border border-border bg-surface-2 p-4">
                  <h3 className="text-sm font-semibold text-fg-muted">{t('exchange_actual_label')}</h3>
                  {computed != null ? (
                   <p className="mt-1 text-xs text-fg-faint">
                    {t('exchange_actual_computed_hint', { value: ltrIsolate(`${formatAmountInput(String(computed.toFixed(2)))} ${toCode}`.trim()) })}
                   </p>
                  ) : null}
                  <input
                   type="text"
                   inputMode="decimal"
                   dir="ltr"
                   value={formatAmountInput(transactionForm.exchangeActualAmount)}
                   onChange={(event) => setTransactionForm((current) => ({ ...current, exchangeActualAmount: normalizeDecimalInput(event.target.value) }))}
                   className={`mt-2 w-full rounded border bg-surface px-3 py-2 outline-none ring-blue-300 focus:ring ${outOfTolerance ? 'border-red-400' : 'border-border-strong'}`}
                   placeholder={computed != null ? computed.toFixed(2) : '0.00'}
                  />
                  {diff != null && Math.abs(diff) > 1e-9 ? (
                   <p className={`mt-1 text-xs ${outOfTolerance ? 'text-bad-text' : 'text-fg-faint'}`}>
                    {outOfTolerance
                     ? t('exchange_actual_out_of_tolerance', { max: String(exchangeTolerance) })
                     : t('exchange_actual_difference', { value: ltrIsolate(`${diff > 0 ? '+' : ''}${diff.toFixed(2)} ${toCode}`.trim()) })}
                   </p>
                  ) : null}
                 </div>
                );
               })()
             : null}

            {!isAdjustmentTransaction && !isExchangeTransaction ? (
             <div className="mt-4">
              <button
               type="button"
               onClick={() => setIsNewTransactionExpensesOpen((prev) => !prev)}
               className="flex items-center gap-1 text-sm font-medium text-accent hover:underline"
              >
               <span>{isNewTransactionExpensesOpen ? '?' : '?'}</span>
               {t('extra_expenses')}
              </button>
              {isNewTransactionExpensesOpen && (
               <div className="mt-3 rounded border border-border bg-surface-2 p-4">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                 <input
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  value={formatAmountInput(transactionForm.charges)}
                  onChange={(event) => setTransactionForm((current) => ({ ...current, charges: normalizeDecimalInput(event.target.value) }))}
                  className="rounded border border-border-strong bg-surface px-3 py-2 outline-none ring-blue-300 focus:ring"
                  placeholder="0"
                 />
                 <select
                  value={transactionForm.chargesCurrencyId ?? ''}
                  onChange={(event) => setTransactionForm((current) => ({ ...current, chargesCurrencyId: event.target.value ? Number(event.target.value) : null }))}
                  className="rounded border border-border-strong bg-surface px-2 py-2 text-sm outline-none ring-blue-300 focus:ring"
                 >
                  <option value="">{t('currency')}</option>
                  {enabledCurrencies.map((cur) => (
                   <option
                    key={cur.id}
                    value={cur.id}
                   >
                    {cur.code}
                   </option>
                  ))}
                 </select>
                 <ChargesPayerSelects
                  value={transactionForm.chargesPayer}
                  onChange={(chargesPayer) => setTransactionForm((current) => ({ ...current, chargesPayer }))}
                  fromLabel={transactionForm.accountFromId ? (clientAccountMap.get(transactionForm.accountFromId)?.clientName ?? t('transaction_account_from')) : t('transaction_account_from')}
                  toLabel={transactionForm.accountToId ? (clientAccountMap.get(transactionForm.accountToId)?.clientName ?? t('transaction_account_to')) : t('transaction_account_to')}
                  meLabel={t('charges_payer_me')}
                  paidByPlaceholder={t('charges_payer_placeholder')}
                  paidToPlaceholder={t('charges_payer_to_placeholder')}
                  className="rounded border border-border-strong bg-surface px-2 py-2 text-sm outline-none ring-blue-300 focus:ring"
                 />
                </div>
                {showChargesExchangeRate && (
                 <div className="mt-2">
                  <label className="block text-xs font-medium text-fg-faint">
                   {t('charges_exchange_rate')} <span dir="ltr">({chargesCurrencyCode} → {chargesPayerAccountCurrencyCode})</span>
                  </label>
                  <input
                   type="text"
                   inputMode="decimal"
                   dir="ltr"
                   value={transactionForm.chargesExchangeRate}
                   onChange={(event) => setTransactionForm((current) => ({ ...current, chargesExchangeRate: normalizePlainDecimalInput(event.target.value) }))}
                   className="mt-1 w-full rounded border border-border-strong bg-surface px-3 py-2 outline-none ring-blue-300 focus:ring"
                   placeholder="1"
                  />
                 </div>
                )}
                <div className="mt-2">
                 <label className="block text-xs font-medium text-fg-faint">{t('charges_description')}</label>
                 <input
                  type="text"
                  value={transactionForm.chargesDescription}
                  onChange={(event) => setTransactionForm((current) => ({ ...current, chargesDescription: event.target.value }))}
                  className="mt-1 w-full rounded border border-border-strong bg-surface px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                  placeholder={t('charges_description_placeholder')}
                 />
                </div>
               </div>
              )}
             </div>
            ) : null}

            <label className="mt-4 block text-sm font-medium">{t('transaction_description')}</label>
            <div className="relative mt-2">
             <textarea
              value={transactionForm.description}
              onChange={(event) => {
               setTransactionForm((current) => ({ ...current, description: event.target.value }));
               setDescriptionSuggestOpen(true);
              }}
              onFocus={() => setDescriptionSuggestOpen(true)}
              onBlur={() => setTimeout(() => setDescriptionSuggestOpen(false), 150)}
              className="min-h-20 w-full rounded border border-border-strong px-3 py-2 outline-none ring-blue-300 focus:ring"
              placeholder={t('transaction_description_placeholder')}
              autoComplete="off"
             />
             {descriptionSuggestOpen &&
              (() => {
               const q = transactionForm.description.trim().toLowerCase();
               const accountIds = new Set<number>([transactionForm.accountFromId, transactionForm.accountToId].filter((id): id is number => id != null));
               const seen = new Set<string>();
               const suggestions: string[] = [];
               // Prioritize descriptions used on the currently selected accounts, then fall back to all past descriptions.
               const passes = accountIds.size > 0 ? (['scoped', 'all'] as const) : (['all'] as const);
               for (const pass of passes) {
                for (let i = transactions.length - 1; i >= 0; i--) {
                 const tx = transactions[i];
                 const desc = tx.description?.trim();
                 if (!desc) continue;
                 if (pass === 'scoped' && !(tx.accountFromId != null && accountIds.has(tx.accountFromId)) && !(tx.accountToId != null && accountIds.has(tx.accountToId))) continue;
                 if (q && desc.toLowerCase() === q) continue;
                 if (q && !desc.toLowerCase().includes(q)) continue;
                 const key = desc.toLowerCase();
                 if (seen.has(key) || excludedDescriptionSuggestions.has(key)) continue;
                 seen.add(key);
                 suggestions.push(desc);
                 if (suggestions.length >= 8) break;
                }
                if (suggestions.length >= 8) break;
               }
               if (suggestions.length === 0) return null;
               return (
                <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded border border-border bg-surface shadow-lg">
                 {suggestions.map((desc) => (
                  <li
                   key={desc}
                   onMouseDown={() => {
                    setTransactionForm((current) => ({ ...current, description: desc }));
                    setDescriptionSuggestOpen(false);
                   }}
                   className="group flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-fg-muted hover:bg-accent-weak"
                   title={desc}
                  >
                   <span className="flex-1 truncate">{desc}</span>
                   <button
                    type="button"
                    onMouseDown={(event) => {
                     event.preventDefault();
                     event.stopPropagation();
                     excludeDescriptionSuggestion(desc);
                    }}
                    title={t('transaction_description_suggestion_remove')}
                    aria-label={t('transaction_description_suggestion_remove')}
                    className="shrink-0 rounded p-0.5 text-fg-faint opacity-0 transition hover:bg-surface-hover hover:text-fg-muted group-hover:opacity-100"
                   >
                    <svg
                     width="12"
                     height="12"
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
                  </li>
                 ))}
                </ul>
               );
              })()}
            </div>

            {!isAdjustmentTransaction ? (
             <div className="mt-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-muted">
               <input
                type="checkbox"
                checked={txSplitDescription}
                onChange={(event) => setTxSplitDescription(event.target.checked)}
                className="h-4 w-4 rounded border-border-strong text-accent focus:ring-blue-300"
               />
               {t('transaction_description_split')}
              </label>

              {txSplitDescription ? (
               <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                 <label className="block text-xs font-medium text-fg-faint">
                  {clientAccountMap.get(transactionForm.accountFromId ?? -1)?.clientName ?? t('transaction_account_from')}
                 </label>
                 <textarea
                  value={transactionForm.descriptionFrom}
                  onChange={(event) => setTransactionForm((current) => ({ ...current, descriptionFrom: event.target.value }))}
                  className="mt-1 min-h-16 w-full rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                  placeholder={transactionForm.description || t('transaction_description_placeholder')}
                 />
                </div>
                <div>
                 <label className="block text-xs font-medium text-fg-faint">
                  {clientAccountMap.get(transactionForm.accountToId ?? -1)?.clientName ?? t('transaction_account_to')}
                 </label>
                 <textarea
                  value={transactionForm.descriptionTo}
                  onChange={(event) => setTransactionForm((current) => ({ ...current, descriptionTo: event.target.value }))}
                  className="mt-1 min-h-16 w-full rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                  placeholder={transactionForm.description || t('transaction_description_placeholder')}
                 />
                </div>
               </div>
              ) : null}
             </div>
            ) : null}

            <button
             type="submit"
             disabled={isSubmittingTransaction}
             className="mt-6 w-full rounded bg-blue-700 px-4 py-2 font-medium text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
             {isAdjustmentTransaction ? t('adjustment_add') : t('save_transaction')}
            </button>
           </form>
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
             onClick={() => transactionsImportInputRef.current?.click()}
             disabled={isImportingTransactions}
             title={isImportingTransactions ? t('import_sheet_loading') : t('import_sheet')}
             aria-label={isImportingTransactions ? t('import_sheet_loading') : t('import_sheet')}
             className="cursor-pointer rounded border border-border-strong p-2 text-fg-muted transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
             {isImportingTransactions ? (
              <svg
               width="16"
               height="16"
               viewBox="0 0 24 24"
               fill="none"
               stroke="currentColor"
               strokeWidth="1.8"
               strokeLinecap="round"
               strokeLinejoin="round"
               className="animate-spin"
               aria-hidden
              >
               <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
             ) : (
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
               <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
               <polyline points="17 8 12 3 7 8" />
               <line
                x1="12"
                y1="3"
                x2="12"
                y2="15"
               />
              </svg>
             )}
            </button>
            <button
             type="button"
             onClick={openTransactionExportModal}
             title={t('transactions_export_title')}
             aria-label={t('transactions_export_title')}
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
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line
               x1="12"
               y1="15"
               x2="12"
               y2="3"
              />
             </svg>
            </button>
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
            <button
             type="button"
             onClick={openTransactionTableSettingsModal}
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
            {(section === 'transactions' || section === 'archive') && !isNewTransactionSectionOpen ? (
             <button
              type="button"
              onClick={() => setIsNewTransactionSectionOpen(true)}
              aria-expanded={isNewTransactionSectionOpen}
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
            onClick={() => setTxFilterOpen((o) => !o)}
            aria-expanded={txFilterOpen}
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
            {(txFilterSearch || txFilterClient || txFilterDateFrom || txFilterDateTo || txFilterHideExpenses) && (
             <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-xs font-semibold text-white leading-none">
              {[txFilterSearch, txFilterClient, txFilterDateFrom, txFilterDateTo, txFilterHideExpenses].filter(Boolean).length}
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
             className={`ml-auto transition-transform ${txFilterOpen ? 'rotate-180' : ''}`}
            >
             <path d="M6 9l6 6 6-6" />
            </svg>
           </button>
           {txFilterOpen && (
            <div className="flex flex-wrap items-end gap-2 border-t border-border px-3 py-3">
             <div className="flex min-w-36 flex-1 flex-col gap-1">
              <label className="text-xs font-medium text-fg-faint">{t('tx_filter_search')}</label>
              <div className="relative">
               <input
                type="text"
                value={txFilterSearch}
                onChange={(e) => setTxFilterSearch(e.target.value)}
                placeholder={t('tx_filter_search_placeholder')}
                className={`w-full rounded border border-border-strong bg-surface px-2 py-1.5 text-sm outline-none ring-blue-300 focus:ring ${isRTL ? 'pl-14' : 'pr-14'}`}
               />
               <div className={`absolute inset-y-0 flex items-center gap-0.5 ${isRTL ? 'left-1' : 'right-1'}`}>
                <button
                 type="button"
                 onClick={() => setTxFilterWholeWord((w) => !w)}
                 title={t('tx_filter_whole_word')}
                 aria-label={t('tx_filter_whole_word')}
                 aria-pressed={txFilterWholeWord}
                 className={`flex h-5 w-6 items-center justify-center rounded text-[11px] font-semibold transition ${
                  txFilterWholeWord ? 'bg-accent-weak text-accent ring-1 ring-inset ring-blue-400' : 'text-fg-faint hover:bg-surface-hover hover:text-fg-muted'
                 }`}
                >
                 <span className="border-b border-current leading-none">ab</span>
                </button>
                {txFilterSearch ? (
                 <button
                  type="button"
                  onClick={() => setTxFilterSearch('')}
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
               value={txFilterClient}
               onChange={(e) => setTxFilterClient(e.target.value)}
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
               value={txFilterDateFrom}
               onChange={(e) => setTxFilterDateFrom(e.target.value)}
               className="rounded border border-border-strong bg-surface px-2 py-1.5 text-sm outline-none ring-blue-300 focus:ring"
              />
             </div>
             <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-fg-faint">{t('tx_filter_date_to')}</label>
              <input
               type="date"
               value={txFilterDateTo}
               onChange={(e) => setTxFilterDateTo(e.target.value)}
               className="rounded border border-border-strong bg-surface px-2 py-1.5 text-sm outline-none ring-blue-300 focus:ring"
              />
             </div>
             <label className="flex cursor-pointer select-none items-center gap-2 self-end rounded border border-border-strong bg-surface px-3 py-1.5 text-sm text-fg-muted transition hover:bg-surface-hover">
              <input
               type="checkbox"
               checked={txFilterHideExpenses}
               onChange={(e) => setTxFilterHideExpenses(e.target.checked)}
               className="h-4 w-4 cursor-pointer rounded border-border-strong text-accent focus:ring-blue-300"
              />
              {t('tx_filter_hide_expenses')}
             </label>
             {(txFilterSearch || txFilterClient || txFilterDateFrom || txFilterDateTo || txFilterHideExpenses) && (
              <button
               type="button"
               onClick={() => {
                setTxFilterSearch('');
                setTxFilterWholeWord(false);
                setTxFilterClient('');
                setTxFilterDateFrom('');
                setTxFilterDateTo('');
                setTxFilterHideExpenses(false);
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
             {transactionTableSettings.columns.accountFrom ? <col style={{ width: colWidthPercent(17) }} /> : null}
             {transactionTableSettings.columns.accountTo ? <col style={{ width: colWidthPercent(17) }} /> : null}
             {transactionTableSettings.columns.amount ? <col style={{ width: colWidthPercent(13) }} /> : null}
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
              {transactionTableSettings.columns.accountFrom ? (
               <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_account_from')}</th>
              ) : null}
              {transactionTableSettings.columns.accountTo ? (
               <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_account_to')}</th>
              ) : null}
              {transactionTableSettings.columns.amount ? <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_amount')}</th> : null}
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
               onKeyDown={(e) => {
                focusAdjacentRowField(e, isRTL);
                // Enter saves the row being edited (ignore Enter inside multi-line fields).
                if (e.key !== 'Enter') return;
                if (!editingRowIds.has(txn.id)) return;
                if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
                e.preventDefault();
                void onSaveTransactionTableRow(txn.id);
               }}
               className={`border-t border-border align-top transition-colors hover:bg-surface-hover ${!txn.isArchived && !txn.isAdjustment && (!txn.accountFromId || !txn.accountToId) ? 'bg-warn-bg' : index % 2 === 1 ? 'bg-surface-2' : 'bg-surface'} ${
                dragRowId !== null && selectedTransactionIds.has(dragRowId) && selectedTransactionIds.has(txn.id) ? 'opacity-40' : dragRowId === txn.id ? 'opacity-40' : ''
               } ${dragOverRowId === txn.id && dragOverHalf === 'top' ? 'border-t-2 border-t-blue-500' : ''} ${
                dragOverRowId === txn.id && dragOverHalf === 'bottom' ? 'border-b-2 border-b-blue-500' : ''
               } ${contextMenuRowId === txn.id ? 'ring-2 ring-inset ring-indigo-400' : ''}`}
               style={(() => {
                const color = highlightedTxRows.get(txn.id);
                const isEditingRow = editingRowIds.has(txn.id);
                return {
                 ...(color ? { backgroundColor: resolveHighlightBg(color, isDark) } : {}),
                 ...(isEditingRow || txSumMode || !txRowClickActive ? {} : txRowClickHighlight ? { cursor: HIGHLIGHT_PEN_CURSOR } : { cursor: 'copy' }),
                };
               })()}
               onClick={(e) => {
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
                     {!txn.isAdjustment && draft && (
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
                      onChange={(event) => updateTransactionTableDraft(txn.id, { createdDate: event.target.value })}
                      className="w-full rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
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
                     <input
                      type="text"
                      value={draft.description}
                      onChange={(event) => updateTransactionTableDraft(txn.id, { description: event.target.value })}
                      className="field-sizing-content min-w-28 rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                      placeholder={t('transaction_description_placeholder')}
                     />
                    ) : (
                     txn.description || <span className="text-fg-faint">-</span>
                    )}
                   </td>
                  ) : null}
                  {transactionTableSettings.columns.accountFrom ? (
                   <td className={`px-4 py-3 font-medium text-fg whitespace-nowrap${isEditingRow ? ' min-w-52' : ''}`}>
                    {isEditingRow && draft ? (
                     <div className="space-y-2">
                      <AccountSearchSelect
                       accounts={clientAccounts}
                       value={draft.accountFromId}
                       onChange={(id) => updateTransactionTableDraft(txn.id, { accountFromId: id })}
                       placeholder={t('transaction_account_placeholder')}
                       clearLabel={t('clear_selection')}
                       isRTL={isRTL}
                      />
                      {transactionTableSettings.showExchangeRate && txn.currencyCode && txn.accountFromCurrencyCode && txn.currencyCode !== txn.accountFromCurrencyCode && (
                       <div className="flex items-center justify-between">
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
                         <span className="text-xs font-semibold" aria-hidden>
                          {tableRateFromReversed[txn.id] ? '÷' : '×'}
                         </span>
                        </button>
                       </div>
                      )}
                      {transactionTableSettings.showExchangeRate ? (
                       <input
                        type="text"
                        inputMode="decimal"
                        dir="ltr"
                        value={draft.exchangeRateFrom}
                        onChange={(event) => updateTransactionTableDraft(txn.id, { exchangeRateFrom: normalizePlainDecimalInput(event.target.value) })}
                        className="field-sizing-content min-w-16 rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                        placeholder={t('transaction_exchange_rate')}
                       />
                      ) : null}
                     </div>
                    ) : txn.isAdjustment ? (
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
                       ) : (
                        <div>
                         {txn.clientFromName} <span className="text-xs font-normal text-fg-faint">{txn.accountFromCurrencySymbol || txn.accountFromCurrencyCode}</span>
                        </div>
                       );
                      })()}
                      {transactionTableSettings.showExchangeRate && txn.exchangeRateFrom !== 1 && txn.currencyCode !== txn.accountFromCurrencyCode ? (
                       <div className="text-xs text-fg-faint">
                        {t('transaction_exchange_rate')}:{' '}
                        {txn.exchangeRateFromReversed
                         ? ltrIsolate(`1 ${txn.accountFromCurrencyCode} = ${formatRateValue(1 / txn.exchangeRateFrom)} ${txn.currencyCode}`)
                         : ltrIsolate(`1 ${txn.currencyCode} = ${formatRateValue(txn.exchangeRateFrom)} ${txn.accountFromCurrencyCode}`)}
                       </div>
                      ) : null}
                     </>
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
                       ) : (
                        <span className="italic text-fg-faint">{t('archive_no_sender')}</span>
                       );
                      })()}
                      {transactionTableSettings.showExchangeRate && txn.exchangeRateFrom !== 1 ? (
                       <div className="text-xs text-fg-faint">
                        {t('transaction_exchange_rate')}:{' '}
                        {txn.exchangeRateFromReversed
                         ? ltrIsolate(`1 ${txn.accountFromCurrencyCode} = ${formatRateValue(1 / txn.exchangeRateFrom)} ${txn.currencyCode}`)
                         : ltrIsolate(`1 ${txn.currencyCode} = ${formatRateValue(txn.exchangeRateFrom)} ${txn.accountFromCurrencyCode}`)}
                       </div>
                      ) : null}
                     </>
                    )}
                   </td>
                  ) : null}
                  {transactionTableSettings.columns.accountTo ? (
                   <td className={`px-4 py-3 font-medium text-fg whitespace-nowrap${isEditingRow ? ' min-w-52' : ''}`}>
                    {isEditingRow && draft && txn.isAdjustment ? (
                     <div className="grid grid-cols-2 gap-2">
                      <button
                       type="button"
                       onClick={() => updateTransactionTableDraft(txn.id, { adjustmentDirection: 'debit' })}
                       className={`rounded border px-3 py-2 text-sm font-semibold transition ${
                        draft.adjustmentDirection === 'debit' ? 'border-red-500 bg-bad-bg text-bad-text' : 'border-border-strong bg-surface text-fg-muted hover:bg-surface-hover'
                       }`}
                      >
                       {t('adjustment_direction_debit_short')}
                      </button>
                      <button
                       type="button"
                       onClick={() => updateTransactionTableDraft(txn.id, { adjustmentDirection: 'credit' })}
                       className={`rounded border px-3 py-2 text-sm font-semibold transition ${
                        draft.adjustmentDirection === 'credit' ? 'border-emerald-500 bg-good-bg text-good-text' : 'border-border-strong bg-surface text-fg-muted hover:bg-surface-hover'
                       }`}
                      >
                       {t('adjustment_direction_credit_short')}
                      </button>
                     </div>
                    ) : isEditingRow && draft ? (
                     <div className="space-y-2">
                      <AccountSearchSelect
                       accounts={clientAccounts}
                       value={draft.accountToId}
                       onChange={(id) => updateTransactionTableDraft(txn.id, { accountToId: id })}
                       placeholder={t('transaction_account_placeholder')}
                       clearLabel={t('clear_selection')}
                       isRTL={isRTL}
                      />
                      {transactionTableSettings.showExchangeRate && txn.currencyCode && txn.accountToCurrencyCode && txn.currencyCode !== txn.accountToCurrencyCode && (
                       <div className="flex items-center justify-between">
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
                         <span className="text-xs font-semibold" aria-hidden>
                          {tableRateToReversed[txn.id] ? '÷' : '×'}
                         </span>
                        </button>
                       </div>
                      )}
                      {transactionTableSettings.showExchangeRate ? (
                       <input
                        type="text"
                        inputMode="decimal"
                        dir="ltr"
                        value={draft.exchangeRateTo}
                        onChange={(event) => updateTransactionTableDraft(txn.id, { exchangeRateTo: normalizePlainDecimalInput(event.target.value) })}
                        className="field-sizing-content min-w-16 rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                        placeholder={t('transaction_exchange_rate')}
                       />
                      ) : null}
                     </div>
                    ) : txn.isAdjustment ? (
                     <div>{t(txn.adjustmentDirection === 'credit' ? 'adjustment_direction_credit_short' : 'adjustment_direction_debit_short')}</div>
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
                       ) : (
                        <span className="italic text-fg-faint">{t('archive_no_receiver')}</span>
                       );
                      })()}
                      {transactionTableSettings.showExchangeRate && txn.exchangeRateTo !== 1 ? (
                       <div className="text-xs text-fg-faint">
                        {t('transaction_exchange_rate')}:{' '}
                        {txn.exchangeRateToReversed
                         ? ltrIsolate(`1 ${txn.accountToCurrencyCode} = ${formatRateValue(1 / txn.exchangeRateTo)} ${txn.currencyCode}`)
                         : ltrIsolate(`1 ${txn.currencyCode} = ${formatRateValue(txn.exchangeRateTo)} ${txn.accountToCurrencyCode}`)}
                       </div>
                      ) : null}
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
                       className="field-sizing-content min-w-16 rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                      />
                      <select
                       value={draft.currencyId ?? ''}
                       onChange={(event) => updateTransactionTableDraft(txn.id, { currencyId: event.target.value ? Number(event.target.value) : null })}
                       className="w-20 rounded border border-border-strong px-2 py-2 text-sm outline-none ring-blue-300 focus:ring"
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
                  {transactionTableSettings.columns.charges ? (
                   <td className="px-4 py-3 text-fg-muted">
                    {txn.isAdjustment ? (
                     <span className="text-fg-faint">-</span>
                    ) : isEditingRow && draft ? (
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
                       <div className="space-y-1">
                        <input
                         type="text"
                         inputMode="decimal"
                         dir="ltr"
                         value={formatAmountInput(draft.charges)}
                         onChange={(event) => updateTransactionTableDraft(txn.id, { charges: normalizeDecimalInput(event.target.value) })}
                         className="field-sizing-content min-w-16 rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                         placeholder="0"
                        />
                        <select
                         value={draft.chargesCurrencyId ?? ''}
                         onChange={(event) => updateTransactionTableDraft(txn.id, { chargesCurrencyId: event.target.value ? Number(event.target.value) : null })}
                         className="w-full rounded border border-border-strong px-2 py-1 text-sm outline-none ring-blue-300 focus:ring"
                        >
                         <option value="">{t('currency')}</option>
                         {enabledCurrencies.map((cur) => (
                          <option
                           key={cur.id}
                           value={cur.id}
                          >
                           {cur.code}
                          </option>
                         ))}
                        </select>
                        <ChargesPayerSelects
                         value={draft.chargesPayer}
                         onChange={(chargesPayer) => updateTransactionTableDraft(txn.id, { chargesPayer })}
                         fromLabel={txn.clientFromName}
                         toLabel={txn.clientToName}
                         meLabel={t('charges_payer_me')}
                         paidByPlaceholder={t('charges_payer_placeholder')}
                         paidToPlaceholder={t('charges_payer_to_placeholder')}
                         className="w-full rounded border border-border-strong px-2 py-1 text-sm outline-none ring-blue-300 focus:ring"
                        />
                        {(() => {
                         const draftChargesCurrencyCode = draft.chargesCurrencyId ? currencyMap.get(draft.chargesCurrencyId)?.code : undefined;
                         const draftPayerAccountCurrencyCode =
                          draft.chargesPayer === 'from' ? txn.accountFromCurrencyCode : draft.chargesPayer === 'to' ? txn.accountToCurrencyCode : undefined;
                         if (!draftChargesCurrencyCode || !draftPayerAccountCurrencyCode || draftChargesCurrencyCode === draftPayerAccountCurrencyCode) return null;
                         return (
                          <div>
                           <span dir="ltr" className="text-xs text-fg-faint">
                            {draftChargesCurrencyCode} → {draftPayerAccountCurrencyCode}
                           </span>
                           <input
                            type="text"
                            inputMode="decimal"
                            dir="ltr"
                            value={draft.chargesExchangeRate}
                            onChange={(event) => updateTransactionTableDraft(txn.id, { chargesExchangeRate: normalizePlainDecimalInput(event.target.value) })}
                            className="mt-1 field-sizing-content min-w-16 rounded border border-border-strong px-2 py-1 text-sm outline-none ring-blue-300 focus:ring"
                            placeholder="1"
                           />
                          </div>
                         );
                        })()}
                        <div className="mt-1">
                         <input
                          type="text"
                          value={draft.chargesDescription}
                          onChange={(event) => updateTransactionTableDraft(txn.id, { chargesDescription: event.target.value })}
                          className="field-sizing-content min-w-28 rounded border border-border-strong px-2 py-1 text-sm outline-none ring-blue-300 focus:ring"
                          placeholder={t('charges_description_placeholder')}
                         />
                        </div>
                       </div>
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
                    {txn.isAdjustment ? (
                     <span className="text-fg-faint">—</span>
                    ) : isEditingRow && draft ? (
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
                          className="field-sizing-content min-w-12 rounded border border-border-strong px-2 py-1 text-sm outline-none ring-blue-300 focus:ring"
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
                          className="field-sizing-content min-w-12 rounded border border-border-strong px-2 py-1 text-sm outline-none ring-blue-300 focus:ring"
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
                      className="w-full rounded border border-border-strong px-2 py-1 text-sm outline-none ring-blue-300 focus:ring"
                     />
                    ) : txn.archiveNote ? (
                     <span className="min-w-0 flex-1 truncate" title={txn.archiveNote}>{txn.archiveNote}</span>
                    ) : (
                     <span className="flex-1 text-fg-faint">-</span>
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
