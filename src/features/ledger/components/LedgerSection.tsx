'use client';

import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Dispatch, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode, SetStateAction } from 'react';
import { usePointerDrag } from '@/shared/hooks/usePointerDrag';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTheme } from '@/contexts/ThemeContext';
import { resolveHighlightBg } from '@/shared/utils/highlightColor';
import { useTranslation } from '@/hooks/useTranslation';
import { accountingApi } from '@/lib/accountingApi';
import { panelClassName, tableWrapClassName } from '@/shared/styles';
import { SkBar, SkTablePanel, SK_LEDGER } from '@/shared/components/skeletons/Skeletons';
import { TableZoomControl } from '@/shared/components/TableZoomControl';
import { getStoredPdfCols, getStoredPdfDateRange, getStoredTableZoom, saveTableZoom } from '@/shared/lib/localStorage';
import { formatAmountInput, normalizeDecimalInput, normalizePlainDecimalInput } from '@/shared/utils/decimal';
import { formatRateValue, ledgerFieldWidth, ledgerSelectWidth, HIGHLIGHT_PEN_CURSOR } from '@/shared/utils/format';
import { formatDateValue } from '@/shared/utils/date';
import { getCommissionAmount } from '@/shared/utils/commission';
import { SMALL_BALANCE_THRESHOLD } from '@/shared/utils/accountBalances';
import { ContextMenu, useContextMenu } from '@/shared/components/ContextMenu';
import ChargesPayerSelects from '@/shared/components/ChargesPayerSelects';
import { getLedgerTransactionDraftKey, ledgerEntryMatchesSearch } from '@/features/ledger/utils/ledgerEntries';
import { useAppStatusStore } from '@/shared/store/appStatusStore';
import type { DraftHistory } from '@/shared/hooks/useDraftHistory';
import { useLedgerStore } from '@/features/ledger/store/ledgerStore';
import type {
 Client,
 ClientAccount,
 ClientAccountLedger,
 ClientAdjustment,
 ClientLedgerEntry,
 Currency,
 LedgerColumnKey,
 LedgerTransactionDraft,
 Organization,
 Section,
} from '@/shared/types';

type LedgerSectionProps = {
 isLoading: boolean;
 clients: Client[];
 clientAccounts: ClientAccount[];
 currencyMap: Map<number, Currency>;
 enabledCurrencies: Currency[];
 organizations: Organization[];
 selectedClientForLedger: Client | null;
 selectedLedgerAccountId: number | null;
 setSelectedLedgerAccountId: (id: number | null) => void;
 selectedOrganizationForClients: Organization | null;
 selectedClientLedgers: ClientAccountLedger[];
 orderedLedgerColumnOptions: Array<{ key: LedgerColumnKey; label: string }>;
 ledgerHistory: DraftHistory;
 getClientLedgerDraft: (transactionId: number, ledgerAccountId: number) => LedgerTransactionDraft | null;
 updateLedgerTransactionDraft: (transactionId: number, ledgerAccountId: number, nextValues: Partial<LedgerTransactionDraft>) => void;
 renderLedgerCurrencySuffix: (currencySymbol: string, currencyCode: string) => ReactNode;
 setSection: Dispatch<SetStateAction<Section>>;
 setClientAccounts: Dispatch<SetStateAction<ClientAccount[]>>;
 setLedgerRowClickMode: (mode: 'highlight' | 'copy' | 'none') => void;
 toggleLedgerRowHighlight: (rowKey: string) => void;
 onCancelAllLedger: (ledger: ClientAccountLedger) => void;
 onDeleteLedgerEntry: (entry: ClientLedgerEntry, ledgerAccountId: number) => void;
 onDeleteSelectedLedgerEntries: () => void;
 onEditSelectedLedgerEntries: () => void;
 onReconcileLedgerEntry: (entry: ClientLedgerEntry, ledgerAccountId: number) => void;
 onRemoveReconciliation: (entry: ClientLedgerEntry, ledgerAccountId: number) => void;
 onWriteOffLedgerRow: (entry: ClientLedgerEntry, ledgerAccountId: number) => void;
 onEditAllLedger: (ledger: ClientAccountLedger) => void;
 onLedgerColumnDrop: (targetColumn: LedgerColumnKey) => void;
 onLedgerEditFieldArrowKey: (event: ReactKeyboardEvent<HTMLInputElement>, field: 'amount' | 'exchangeRate' | 'commission', entry: ClientLedgerEntry, ledgerAccountId: number, pagedEntries: ClientLedgerEntry[], entryIdx: number) => void;
 onLedgerRowDrop: (draggedKeys: string[], targetKey: string, dropHalf: 'top' | 'bottom', accountId: number) => void;
 onSaveAllLedger: (ledger: ClientAccountLedger) => void;
 onSaveLedgerRow: (transactionId: number, ledgerAccountId: number) => void;
 onSaveAllEditingLedgerRows: () => void;
 onCancelAllEditingLedgerRows: () => void;
 onToggleLedgerEntrySelection: (key: string) => void;
 openAdjustmentModal: (accountId: number, existing?: ClientAdjustment) => void;
 openClientLedger: (client: Client, origin?: 'clients' | 'organization-clients', accountId?: number | null) => void;
 openLedgerRowForEdit: (entry: ClientLedgerEntry, ledgerAccountId: number) => void;
 openOrganizationClientsPage: (organization: Organization) => void;
 navigateToSection: (section: Section) => void;
 loadData: () => Promise<void> | void;
};

export default function LedgerSection(props: LedgerSectionProps) {
 const {
  isLoading, clients, clientAccounts, currencyMap, enabledCurrencies, organizations, selectedClientForLedger,
  selectedLedgerAccountId, setSelectedLedgerAccountId, selectedOrganizationForClients, selectedClientLedgers,
  orderedLedgerColumnOptions, ledgerHistory, getClientLedgerDraft, updateLedgerTransactionDraft, renderLedgerCurrencySuffix,
  onCancelAllLedger, onDeleteLedgerEntry, onDeleteSelectedLedgerEntries, onEditSelectedLedgerEntries, onReconcileLedgerEntry, onRemoveReconciliation, onWriteOffLedgerRow, onEditAllLedger,
  onLedgerColumnDrop, onLedgerEditFieldArrowKey, onLedgerRowDrop, onSaveAllLedger, onSaveLedgerRow, onSaveAllEditingLedgerRows, onCancelAllEditingLedgerRows, onToggleLedgerEntrySelection,
  openAdjustmentModal, openClientLedger, openLedgerRowForEdit, openOrganizationClientsPage, navigateToSection, loadData,
  setSection, setClientAccounts, setLedgerRowClickMode, toggleLedgerRowHighlight,
 } = props;
 const router = useRouter();
 const { language, isRTL } = useLanguage();
 const isDark = useTheme().resolvedTheme === 'dark';
 const { t } = useTranslation(language);
 // French uses 'en-US' grouping (comma thousands, period decimal) instead of the
 // official fr-FR narrow-no-break-space separator, which renders as near-invisible.
 const numLocale = language === 'fr' ? 'en-US' : language;
 const showToast = useAppStatusStore((s) => s.showToast);
 const setError = useAppStatusStore((s) => s.setError);
 const { clientLedgerBackSection, editingLedgerRowKeys, setEditingLedgerRowKeys, editAllLedgerAccountIds, selectedLedgerEntryKeys, setSelectedLedgerEntryKeys, ledgerSumMode, setLedgerSumMode, ledgerSumSelection, setLedgerSumSelection, setShowLedgerSettingsModal, ledgerFilterOpen, setLedgerFilterOpen, ledgerFilterSearch, setLedgerFilterSearch, ledgerFilterWholeWord, setLedgerFilterWholeWord, ledgerFilterCounterparty, setLedgerFilterCounterparty, ledgerFilterDateFrom, setLedgerFilterDateFrom, ledgerFilterDateTo, setLedgerFilterDateTo, ledgerDecimals, ledgerDateFormat, ledgerHighlightNetChange, ledgerNetChangeHighlightColor, ledgerRowClickHighlight, ledgerRowClickActive, highlightedLedgerRows, ledgerStartingBalanceDrafts, setLedgerStartingBalanceDrafts, editingStartingBalanceIds, setEditingStartingBalanceIds, ledgerPageState, setLedgerPageState, ledgerPageSize, setLedgerPageSize, ledgerExpensesExpandedKeys, setLedgerExpensesExpandedKeys, draggedLedgerColumn, setDraggedLedgerColumn, dragLedgerRowKey, setDragLedgerRowKey, dragOverLedgerRowKey, setDragOverLedgerRowKey, dragOverLedgerHalf, setDragOverLedgerHalf, ledgerColumnVisibility, ledgerTransactionDrafts, setLedgerTransactionDrafts, setPdfExportModal, ledgerCounterpartyOpen, setLedgerCounterpartyOpen, ledgerCounterpartyQuery, setLedgerCounterpartyQuery, ledgerCounterpartyExpandedClient, setLedgerCounterpartyExpandedClient, ledgerRateReversed, setLedgerRateReversed, ledgerDisplayRateReversed, setLedgerDisplayRateReversed } = useLedgerStore();

 // Entries are ordered oldest-first (see ledgerBalances.ts), so the most recent ones
 // sit at the bottom of the scrollable table. Jump there on open (and whenever the
 // selected client or currency account changes) so the latest activity is visible
 // without the user having to scroll down manually.
 const ledgerTableScrollRef = useRef<HTMLDivElement | null>(null);
 useLayoutEffect(() => {
  const el = ledgerTableScrollRef.current;
  if (el) el.scrollTop = el.scrollHeight;
 }, [selectedClientForLedger?.id, selectedLedgerAccountId]);

 // Right-click row actions (Edit/Reconcile/Write off/Delete) — replaces a cluster of
 // per-row icon buttons with a single context menu, decluttering the actions column.
 // contextMenuRowKey drives a border on whichever row the open menu belongs to; closeRowMenu
 // clears it alongside the menu itself.
 const rowContextMenu = useContextMenu();
 const [contextMenuRowKey, setContextMenuRowKey] = useState<string | null>(null);
 const closeRowMenu = () => {
  rowContextMenu.close();
  setContextMenuRowKey(null);
 };

 // Selection mode: the per-row select checkboxes stay hidden until the user opts in via
 // the toolbar "Select" toggle. Turning it off also clears any current selection so a
 // stale set doesn't linger (and keep the bulk-delete button showing) after exiting.
 const [selectionMode, setSelectionMode] = useState(false);
 const toggleSelectionMode = () => {
  setSelectionMode((on) => {
   if (on) setSelectedLedgerEntryKeys(new Set());
   return !on;
  });
 };

 // Row drag-to-reorder via pointer events (not native HTML5 drag-and-drop, which never fires
 // from a touch gesture — the reason this was unusable on mobile). See usePointerDrag for why.
 // One instance handles every account's ledger table on the page — the row key already encodes
 // its account id (`${transactionId}:${accountId}`), so drops are scoped per-account from that.
 // Short "what am I dragging" label for the floating ghost badge (see usePointerDrag) — looked
 // up live from the same ledger data the row itself renders from.
 const ledgerRowGhostLabel = (key: string): string => {
  const accountId = Number(key.slice(key.lastIndexOf(':') + 1));
  const transactionId = Number(key.slice(0, key.lastIndexOf(':')));
  const ledgerForRow = selectedClientLedgers.find((l) => l.accountId === accountId);
  const entryForRow = ledgerForRow?.entries.find((e) => e.transactionId === transactionId);
  if (!ledgerForRow || !entryForRow) return '…';
  const amount = entryForRow.amount.toLocaleString(numLocale, { maximumFractionDigits: ledgerDecimals });
  const who = entryForRow.counterpartyName || entryForRow.description;
  return who ? `${who} · ${amount} ${ledgerForRow.currencyCode}` : `${amount} ${ledgerForRow.currencyCode}`;
 };

 // The drag handle sits inside the row, so a drag gesture ends with a browser-synthesized
 // `click` that bubbles to the row's onClick and would toggle highlight/copy. This flag, set
 // while a drag is in flight, lets that onClick swallow the stray post-drag click so
 // reordering a row never also highlights it.
 const justDraggedLedgerRowRef = useRef(false);
 const ledgerRowDrag = usePointerDrag<string>({
  parseKey: (raw) => raw,
  onDragStart: (key) => {
   justDraggedLedgerRowRef.current = true;
   setDragLedgerRowKey(key);
  },
  onHoverChange: (overKey, half) => {
   setDragOverLedgerRowKey(overKey);
   if (half) setDragOverLedgerHalf(half);
  },
  onDrop: (draggedKey, overKey, half) => {
   if (overKey !== null && draggedKey !== overKey && half) {
    const accountId = Number(draggedKey.slice(draggedKey.lastIndexOf(':') + 1));
    const keysToMove =
     selectedLedgerEntryKeys.has(draggedKey) && selectedLedgerEntryKeys.size > 1
      ? [...selectedLedgerEntryKeys].filter((k) => k.endsWith(`:${accountId}`))
      : [draggedKey];
    void onLedgerRowDrop(keysToMove, overKey, half, accountId);
   }
   setDragLedgerRowKey(null);
   setDragOverLedgerRowKey(null);
   // Clear after the synthetic click has had its chance to fire (and be swallowed); if the
   // drop landed on a different row the click never reaches a row's onClick, so this resets it.
   setTimeout(() => {
    justDraggedLedgerRowRef.current = false;
   }, 0);
  },
  renderGhost: ledgerRowGhostLabel,
 });

 // Column drag-to-reorder (header cells) — same pointer-events approach, no half needed since
 // dropping just inserts the dragged column at the target's index.
 const ledgerColumnDrag = usePointerDrag<LedgerColumnKey>({
  parseKey: (raw) => raw as LedgerColumnKey,
  axis: 'none',
  onDragStart: (key) => setDraggedLedgerColumn(key),
  onHoverChange: () => {
   /* no hover styling for column drag, matching the previous native-drag behavior */
  },
  onDrop: (_draggedKey, overKey) => {
   if (overKey !== null) onLedgerColumnDrop(overKey);
   setDraggedLedgerColumn(null);
  },
  renderGhost: (key) => orderedLedgerColumnOptions.find((o) => o.key === key)?.label ?? key,
 });

 // Tracks which account's "entries awaiting an exchange rate" note has been expanded to list
 // the specific pending entries. Ephemeral UI state — no need to persist across sessions.
 const [pendingEntriesOpenAccountIds, setPendingEntriesOpenAccountIds] = useState<Set<number>>(new Set());
 // Spreadsheet-style zoom for the (often very wide) ledger table, so it fits on narrow screens.
 const [tableZoom, setTableZoom] = useState(() => getStoredTableZoom('ledger'));
 const changeTableZoom = (z: number) => {
  setTableZoom(z);
  saveTableZoom('ledger', z);
 };
 const togglePendingEntriesOpen = (accountId: number) => {
  setPendingEntriesOpenAccountIds((prev) => {
   const next = new Set(prev);
   if (next.has(accountId)) next.delete(accountId);
   else next.add(accountId);
   return next;
  });
 };

 // Sum mode: toggling it off clears whatever was accumulated so the next session starts fresh.
 const toggleLedgerSumMode = () => {
  setLedgerSumMode((on) => {
   if (on) setLedgerSumSelection(new Set());
   return !on;
  });
 };
 // Toggle a row's amount/netChange into (or out of) the running total.
 const toggleLedgerSumEntry = (key: string) => {
  setLedgerSumSelection((prev) => {
   const next = new Set(prev);
   if (next.has(key)) next.delete(key);
   else next.add(key);
   return next;
  });
 };
 // Grouped by currency so mixing e.g. USD and EUR clicks shows one total box per currency
 // instead of adding incompatible currencies together. Looks up each selected key's CURRENT
 // value from the live ledger data on every render (rather than a snapshot captured at click
 // time), so editing a summed row's amount afterward is reflected instead of going stale.
 const ledgerSumByCurrency = new Map<string, { total: number; count: number }>();
 for (const sumKey of ledgerSumSelection) {
  const [transactionIdRaw, accountIdRaw, field] = sumKey.split(':');
  const transactionId = Number(transactionIdRaw);
  const accountId = Number(accountIdRaw);
  const sumLedger = selectedClientLedgers.find((l) => l.accountId === accountId);
  const sumEntry = sumLedger?.entries.find((e) => e.transactionId === transactionId);
  if (!sumLedger || !sumEntry) continue;
  const { value, code } =
   field === 'netChange'
    ? { value: sumEntry.netChange, code: sumLedger.currencyCode }
    : field === 'runningBalance'
     ? { value: sumEntry.runningBalance, code: sumLedger.currencyCode }
     : { value: sumEntry.amount, code: sumEntry.currencyCode };
  const bucket = ledgerSumByCurrency.get(code || '') ?? { total: 0, count: 0 };
  bucket.total += value;
  bucket.count += 1;
  ledgerSumByCurrency.set(code || '', bucket);
 }

 if (isLoading) {
  return (
        <section className="flex flex-col gap-6">
         <div className={panelClassName}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
           <div className="flex flex-col gap-2">
            <SkBar
             w="w-20"
             h="h-3"
            />
            <SkBar
             w="w-44"
             h="h-7"
            />
            <SkBar
             w="w-64"
             h="h-3.5"
            />
           </div>
           <SkBar
            w="w-28"
            h="h-9"
           />
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
           {Array.from({ length: 2 }, (_, i) => (
            <div
             key={i}
             className="rounded border border-border bg-surface-2 px-4 py-3 flex flex-col gap-2"
            >
             <SkBar
              w="w-24"
              h="h-3"
             />
             <SkBar
              w="w-28"
              h="h-7"
             />
            </div>
           ))}
          </div>
         </div>
         <SkTablePanel
          panelClassName={panelClassName}
          tableWrapClassName={tableWrapClassName}
          cols={SK_LEDGER}
          titleWidth="w-36"
          rows={8}
         />
        </section>
  );
 }

 return (
  <>
        {ledgerRowDrag.dragGhost}
        {ledgerColumnDrag.dragGhost}
        <section className="flex flex-col gap-6">
         <div className={panelClassName}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
           <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-accent">{t('client_page_title')}</p>
            <h2 className="mt-2 text-2xl font-semibold text-fg">{selectedClientForLedger?.name ?? t('clients_title')}</h2>
            {selectedClientForLedger?.organizationId != null &&
             (() => {
              const org = organizations.find((o) => o.id === selectedClientForLedger.organizationId);
              return org ? (
               <a
                href={`/organizations/${org.id}`}
                onClick={(e) => {
                 if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
                 e.preventDefault();
                 openOrganizationClientsPage(org);
                }}
                className="mt-1 cursor-pointer text-sm text-fg-faint transition hover:text-accent hover:underline"
               >
                {org.name}
               </a>
              ) : null;
             })()}
            <p className="mt-2 text-sm text-fg-muted">{selectedClientForLedger ? t('client_page_description') : t('client_page_no_client')}</p>
           </div>

           <button
            type="button"
            onClick={() => {
             if (clientLedgerBackSection === 'organization-clients' && selectedOrganizationForClients) {
              setSection('organization-clients');
              router.replace(`/organizations/${selectedOrganizationForClients.id}`);
             } else {
              navigateToSection('clients');
             }
            }}
            className="cursor-pointer rounded border border-border-strong px-4 py-2 text-sm font-semibold text-fg-muted hover:bg-surface-hover"
           >
            {clientLedgerBackSection === 'organization-clients' ? t('organization_page_back') : t('client_page_back')}
           </button>
          </div>

          {selectedClientForLedger && selectedClientLedgers.length > 1 ? (
           <div className="mt-5 flex flex-wrap items-center gap-2">
            {selectedClientLedgers.map((ledger) => (
             <button
              key={ledger.accountId}
              type="button"
              onClick={() => setSelectedLedgerAccountId(ledger.accountId)}
              className={`cursor-pointer rounded border px-4 py-2 text-sm font-semibold transition ${
               selectedLedgerAccountId === ledger.accountId ? 'border-fg bg-fg text-canvas' : 'border-border-strong bg-surface text-fg-muted hover:bg-surface-hover'
              }`}
             >
              {ledger.currencyName}
             </button>
            ))}
           </div>
          ) : null}
          {selectedClientForLedger && (
           <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <>
             <button
              type="button"
              onClick={() => {
               const targetLedger =
                selectedClientLedgers.length === 1
                 ? selectedClientLedgers[0]
                 : (selectedClientLedgers.find((l) => l.accountId === selectedLedgerAccountId) ?? selectedClientLedgers[0]);
               if (!targetLedger) return;
               const today = new Date().toISOString().slice(0, 10);
               const firstEntry = targetLedger.entries[0]?.createdAt.slice(0, 10) ?? today;
               // Reuse the last date range chosen for this account, if any.
               const storedRange = getStoredPdfDateRange(targetLedger.accountId);
               setPdfExportModal({
                accountId: targetLedger.accountId,
                fromDate: storedRange?.fromDate ?? firstEntry,
                toDate: storedRange?.toDate ?? today,
                fromEntryKey: null,
                toEntryKey: null,
                cols: getStoredPdfCols(targetLedger.accountId),
               });
              }}
              title={t('export_ledger_action')}
              aria-label={t('export_ledger_action')}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-border-strong px-3 py-2 text-sm text-fg-muted transition hover:bg-surface-hover"
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
              {t('download')}
             </button>
             <button
              type="button"
              onClick={() => {
               const targetLedger =
                selectedClientLedgers.length === 1
                 ? selectedClientLedgers[0]
                 : (selectedClientLedgers.find((l) => l.accountId === selectedLedgerAccountId) ?? selectedClientLedgers[0]);
               if (!targetLedger) return;
               openAdjustmentModal(targetLedger.accountId);
              }}
              className="cursor-pointer rounded border border-purple-500 bg-violet-bg px-4 py-2 text-sm font-semibold text-violet-text transition hover:bg-violet-bg"
             >
              {t('adjustment_add')}
             </button>
             {Object.keys(ledgerTransactionDrafts).length > 0 ? (
              <>
               <button
                type="button"
                title={t('undo')}
                onClick={ledgerHistory.undo}
                disabled={!ledgerHistory.canUndo}
                className="cursor-pointer rounded border border-border-strong px-2 py-2 text-sm font-semibold text-fg-muted transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
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
                onClick={ledgerHistory.redo}
                disabled={!ledgerHistory.canRedo}
                className="cursor-pointer rounded border border-border-strong px-2 py-2 text-sm font-semibold text-fg-muted transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
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
             <button
              type="button"
              title={t('nav_settings')}
              onClick={() => setShowLedgerSettingsModal(true)}
              className="cursor-pointer rounded border border-border-strong px-2 py-2 text-sm font-semibold text-fg-muted transition hover:bg-surface-hover"
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
               <circle
                cx="12"
                cy="12"
                r="3"
               />
               <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
             </button>
            </>
           </div>
          )}
         </div>

         {!selectedClientForLedger ? (
          <div className={`${panelClassName} text-sm text-fg-muted`}>{t('client_page_no_client')}</div>
         ) : selectedClientLedgers.length === 0 ? (
          <div className={`${panelClassName} text-sm text-fg-muted`}>{t('no_client_accounts')}</div>
         ) : (
          selectedClientLedgers
           .filter((ledger) => selectedClientLedgers.length === 1 || ledger.accountId === selectedLedgerAccountId)
           .map((ledger) => (
            <div
             key={ledger.accountId}
             className={panelClassName}
            >
             <div className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
               <p className="text-sm font-medium text-fg-faint">{selectedClientForLedger?.name}</p>
               <h3 className="text-xl font-semibold text-fg">{ledger.currencyName}</h3>
               <p className="mt-1 text-sm text-fg-muted">{t('client_page_account_summary')}</p>
               <div className="mt-2 flex items-center gap-1.5">
                <span className="text-xs text-fg-faint">{t('starting_balance')}:</span>
                {editingStartingBalanceIds.has(ledger.accountId) ? (
                 <input
                  type="text"
                  inputMode="decimal"
                  autoFocus
                  value={ledgerStartingBalanceDrafts[ledger.accountId] ?? formatAmountInput(String(ledger.startingBalance))}
                  onChange={(event) => setLedgerStartingBalanceDrafts((prev) => ({ ...prev, [ledger.accountId]: formatAmountInput(event.target.value) }))}
                  onBlur={async (event) => {
                   const value = parseFloat(normalizeDecimalInput(event.target.value));
                   if (!isNaN(value) && accountingApi) {
                    try {
                     await accountingApi.updateClientAccountStartingBalance({ accountId: ledger.accountId, startingBalance: value });
                     setClientAccounts((prev) => prev.map((account) => (account.id === ledger.accountId ? { ...account, startingBalance: value } : account)));
                     void loadData();
                    } catch (e) {
                     setError(e instanceof Error ? e.message : t('error_failed_update'));
                    }
                   }
                   setEditingStartingBalanceIds((prev) => {
                    const next = new Set(prev);
                    next.delete(ledger.accountId);
                    return next;
                   });
                  }}
                  onKeyDown={(e) => {
                   if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                   if (e.key === 'Escape') {
                    setLedgerStartingBalanceDrafts((prev) => {
                     const next = { ...prev };
                     delete next[ledger.accountId];
                     return next;
                    });
                    setEditingStartingBalanceIds((prev) => {
                     const next = new Set(prev);
                     next.delete(ledger.accountId);
                     return next;
                    });
                   }
                  }}
                  className="w-32 rounded border border-border-strong px-2 py-0.5 text-xs outline-none ring-blue-300 focus:ring"
                 />
                ) : (
                 <>
                  <span className="text-xs font-medium text-fg-muted">
                   {(ledgerStartingBalanceDrafts[ledger.accountId] !== undefined
                    ? parseFloat(normalizeDecimalInput(ledgerStartingBalanceDrafts[ledger.accountId])) || 0
                    : ledger.startingBalance
                   ).toLocaleString(numLocale, { maximumFractionDigits: ledgerDecimals })}
                  </span>
                  <button
                   type="button"
                   onClick={() => setEditingStartingBalanceIds((prev) => new Set([...prev, ledger.accountId]))}
                   title={t('edit')}
                   className="text-fg-faint transition hover:text-fg-muted"
                  >
                   <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                   >
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                   </svg>
                  </button>
                 </>
                )}
               </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
               <div className="rounded border border-border bg-surface-2 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-fg-faint">{t('client_page_current_balance')}</p>
                <p className={`mt-2 text-xl font-bold ${ledger.currentBalance >= 0 ? 'text-good-text' : 'text-bad-text'}`}>
                 {ledger.currentBalance.toLocaleString(numLocale, { maximumFractionDigits: ledgerDecimals })}
                </p>
                {(() => {
                 const pendingEntries = ledger.entries.filter((e) => e.pendingRate);
                 const pendingCount = pendingEntries.length;
                 if (pendingCount === 0) return null;
                 const isOpen = pendingEntriesOpenAccountIds.has(ledger.accountId);
                 return (
                  <>
                   <button
                    type="button"
                    onClick={() => togglePendingEntriesOpen(ledger.accountId)}
                    aria-expanded={isOpen}
                    className="mt-1.5 flex cursor-pointer items-center gap-1 text-xs font-medium text-warn-text hover:underline"
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
                     <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                     <path d="M12 9v4M12 17h.01" />
                    </svg>
                    {t(pendingCount === 1 ? 'ledger_pending_balance_note' : 'ledger_pending_balance_note_plural', { count: pendingCount })}
                    <svg
                     width="10"
                     height="10"
                     viewBox="0 0 24 24"
                     fill="none"
                     stroke="currentColor"
                     strokeWidth="2.5"
                     strokeLinecap="round"
                     strokeLinejoin="round"
                     className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}
                     aria-hidden
                    >
                     <path d="m6 9 6 6 6-6" />
                    </svg>
                   </button>
                   {isOpen && (
                    <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto rounded border border-amber-200 bg-warn-bg p-2 text-xs text-fg-muted">
                     {pendingEntries.map((entry) => (
                      <li
                       key={`${entry.transactionId}-${entry.direction}`}
                       className="flex items-center gap-2 whitespace-nowrap"
                      >
                       <span className="shrink-0 text-fg-faint">{formatDateValue(entry.createdAt, ledgerDateFormat)}</span>
                       <span className="shrink-0 font-medium">{entry.counterpartyName}</span>
                       <span className="min-w-0 flex-1 truncate italic text-fg-faint" title={entry.description}>
                        {entry.description}
                       </span>
                       <span className="shrink-0">
                        {entry.amount.toLocaleString(numLocale, { maximumFractionDigits: ledgerDecimals })} {entry.currencySymbol || entry.currencyCode}
                       </span>
                      </li>
                     ))}
                    </ul>
                   )}
                  </>
                 );
                })()}
               </div>
               <div className="rounded border border-border bg-surface-2 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-fg-faint">{t('client_page_transaction_count')}</p>
                <p className="mt-2 text-xl font-bold text-fg">{ledger.transactionCount}</p>
               </div>
              </div>
             </div>

             {ledger.entries.length === 0 ? (
              <p className="mt-5 text-sm text-fg-faint">{t('client_page_no_transactions')}</p>
             ) : (
              <>
               {/* Filter bar */}
               {(() => {
                const counterpartyOptions = [...new Set(ledger.entries.map((e) => e.counterpartyName).filter(Boolean))].sort((a, b) => a.localeCompare(b, language));
                const hasFilter = !!(ledgerFilterSearch || ledgerFilterCounterparty || ledgerFilterDateFrom || ledgerFilterDateTo);
                const activeCount = [ledgerFilterSearch, ledgerFilterCounterparty, ledgerFilterDateFrom, ledgerFilterDateTo].filter(Boolean).length;
                return (
                 <div className="mt-4 rounded border border-border bg-surface-2">
                  <button
                   type="button"
                   onClick={() => setLedgerFilterOpen((o) => !o)}
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
                   {hasFilter && <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-xs font-semibold text-white leading-none">{activeCount}</span>}
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
                    className={`ml-auto transition-transform ${ledgerFilterOpen ? 'rotate-180' : ''}`}
                   >
                    <path d="M6 9l6 6 6-6" />
                   </svg>
                  </button>
                  {ledgerFilterOpen && (
                   <div className="flex flex-wrap items-end gap-2 border-t border-border px-3 py-3">
                    <div className="flex min-w-36 flex-1 flex-col gap-1">
                     <label className="text-xs font-medium text-fg-faint">{t('tx_filter_search')}</label>
                     <div className="relative">
                      <input
                       type="text"
                       value={ledgerFilterSearch}
                       onChange={(e) => setLedgerFilterSearch(e.target.value)}
                       placeholder={t('tx_filter_search_placeholder')}
                       className={`w-full rounded border border-border-strong bg-surface px-2 py-1.5 text-sm outline-none ring-blue-300 focus:ring ${isRTL ? 'pl-14' : 'pr-14'}`}
                      />
                      <div className={`absolute inset-y-0 flex items-center gap-0.5 ${isRTL ? 'left-1' : 'right-1'}`}>
                       <button
                        type="button"
                        onClick={() => setLedgerFilterWholeWord((w) => !w)}
                        title={t('tx_filter_whole_word')}
                        aria-label={t('tx_filter_whole_word')}
                        aria-pressed={ledgerFilterWholeWord}
                        className={`flex h-5 w-6 items-center justify-center rounded text-[11px] font-semibold transition ${
                         ledgerFilterWholeWord ? 'bg-accent-weak text-accent ring-1 ring-inset ring-blue-400' : 'text-fg-faint hover:bg-surface-hover hover:text-fg-muted'
                        }`}
                       >
                        <span className="border-b border-current leading-none">ab</span>
                       </button>
                       {ledgerFilterSearch ? (
                        <button
                         type="button"
                         onClick={() => setLedgerFilterSearch('')}
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
                    {counterpartyOptions.length > 0 && (
                     <div className="flex min-w-36 flex-1 flex-col gap-1">
                      <label className="text-xs font-medium text-fg-faint">{t('counterparty')}</label>
                      <select
                       value={ledgerFilterCounterparty}
                       onChange={(e) => setLedgerFilterCounterparty(e.target.value)}
                       className="rounded border border-border-strong bg-surface px-2 py-1.5 text-sm outline-none ring-blue-300 focus:ring"
                      >
                       <option value="">{t('tx_filter_client_all')}</option>
                       {counterpartyOptions.map((name) => (
                        <option
                         key={name}
                         value={name}
                        >
                         {name}
                        </option>
                       ))}
                      </select>
                     </div>
                    )}
                    <div className="flex flex-col gap-1">
                     <label className="text-xs font-medium text-fg-faint">{t('tx_filter_date_from')}</label>
                     <input
                      type="date"
                      value={ledgerFilterDateFrom}
                      onChange={(e) => setLedgerFilterDateFrom(e.target.value)}
                      className="rounded border border-border-strong bg-surface px-2 py-1.5 text-sm outline-none ring-blue-300 focus:ring"
                     />
                    </div>
                    <div className="flex flex-col gap-1">
                     <label className="text-xs font-medium text-fg-faint">{t('tx_filter_date_to')}</label>
                     <input
                      type="date"
                      value={ledgerFilterDateTo}
                      onChange={(e) => setLedgerFilterDateTo(e.target.value)}
                      className="rounded border border-border-strong bg-surface px-2 py-1.5 text-sm outline-none ring-blue-300 focus:ring"
                     />
                    </div>
                    {hasFilter && (
                     <button
                      type="button"
                      onClick={() => {
                       setLedgerFilterSearch('');
                       setLedgerFilterWholeWord(false);
                       setLedgerFilterCounterparty('');
                       setLedgerFilterDateFrom('');
                       setLedgerFilterDateTo('');
                      }}
                      className="self-end rounded border border-border-strong bg-surface px-3 py-1.5 text-sm text-fg-muted transition hover:bg-surface-hover"
                     >
                      {t('tx_filter_clear')}
                     </button>
                    )}
                   </div>
                  )}
                 </div>
                );
               })()}

               {(() => {
                const ordered = ledger.entries;
                const visibleCount = ordered.filter((e) => {
                 if (ledgerFilterDateFrom && e.createdAt.slice(0, 10) < ledgerFilterDateFrom) return false;
                 if (ledgerFilterDateTo && e.createdAt.slice(0, 10) > ledgerFilterDateTo) return false;
                 if (ledgerFilterCounterparty && e.counterpartyName !== ledgerFilterCounterparty) return false;
                 if (!ledgerEntryMatchesSearch(e, ledgerFilterSearch.trim(), ledgerFilterWholeWord)) return false;
                 return true;
                }).length;
                const totalLedgerPages = Math.max(1, Math.ceil(visibleCount / ledgerPageSize));
                const currentLedgerPage = Math.max(1, Math.min(ledgerPageState[ledger.accountId] ?? 99999, totalLedgerPages));
                const showPager = visibleCount > 0 && totalLedgerPages > 1;
                return (
                 <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-fg-muted">
                   {showPager
                    ? `${(currentLedgerPage - 1) * ledgerPageSize + 1}–${Math.min(currentLedgerPage * ledgerPageSize, visibleCount)} ${t('pagination_of')} ${visibleCount}`
                    : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                   {showPager && (
                    <div className="flex flex-wrap items-center gap-1.5">
                     <button
                      type="button"
                      onClick={() => setLedgerPageState((prev) => ({ ...prev, [ledger.accountId]: Math.max(1, currentLedgerPage - 1) }))}
                      disabled={currentLedgerPage <= 1}
                      className="rounded border border-border-strong px-2 py-1 text-xs font-semibold text-fg-muted transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                     >
                      {t('pagination_prev')}
                     </button>
                     <input
                      key={currentLedgerPage}
                      type="number"
                      min={1}
                      max={totalLedgerPages}
                      defaultValue={currentLedgerPage}
                      onBlur={(event) => {
                       const n = parseInt(event.target.value, 10);
                       if (n >= 1 && n <= totalLedgerPages) setLedgerPageState((prev) => ({ ...prev, [ledger.accountId]: n }));
                       else event.target.value = String(currentLedgerPage);
                      }}
                      onKeyDown={(event) => {
                       if (event.key === 'Enter') event.currentTarget.blur();
                      }}
                      className="w-14 rounded border border-border-strong px-1.5 py-1 text-center text-xs outline-none ring-blue-300 focus:ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                     />
                     <span className="text-xs text-fg-faint">/ {totalLedgerPages}</span>
                     <button
                      type="button"
                      onClick={() => setLedgerPageState((prev) => ({ ...prev, [ledger.accountId]: Math.min(totalLedgerPages, currentLedgerPage + 1) }))}
                      disabled={currentLedgerPage >= totalLedgerPages}
                      className="rounded border border-border-strong px-2 py-1 text-xs font-semibold text-fg-muted transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                     >
                      {t('pagination_next')}
                     </button>
                    </div>
                   )}
                   <TableZoomControl
                    zoom={tableZoom}
                    onZoomChange={changeTableZoom}
                    className=""
                   />
                  </div>
                 </div>
                );
               })()}
               <div
                ref={ledgerTableScrollRef}
                className={`${tableWrapClassName} max-h-[70vh] overflow-y-auto`}
                onKeyDown={(event) => {
                 if (event.key === 'Enter' && editAllLedgerAccountIds.has(ledger.accountId)) {
                  const tag = (event.target as HTMLElement).tagName;
                  if (tag === 'SELECT' || tag === 'TEXTAREA') return;
                  event.preventDefault();
                  void onSaveAllLedger(ledger);
                 }
                }}
               >
                <table
                 className="w-full text-sm"
                 style={{ zoom: String(tableZoom) }}
                >
                 <thead className="sticky top-0 z-20 bg-surface-hover text-fg-muted">
                  <tr>
                   <th className="w-10 px-2 py-3">
                    {editAllLedgerAccountIds.has(ledger.accountId) ? (
                     <div className="flex flex-col items-center gap-1">
                      <button
                       type="button"
                       title={t('save_changes')}
                       onClick={() => void onSaveAllLedger(ledger)}
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
                       onClick={() => onCancelAllLedger(ledger)}
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
                      onClick={() => onEditAllLedger(ledger)}
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
                    <th className="w-8 px-2 py-3">
                     <input
                      type="checkbox"
                      checked={
                       ledger.entries.length > 0 && ledger.entries.every((e) => selectedLedgerEntryKeys.has(getLedgerTransactionDraftKey(e.transactionId, ledger.accountId)))
                      }
                      onChange={() => {
                       const allKeys = ledger.entries.map((e) => getLedgerTransactionDraftKey(e.transactionId, ledger.accountId));
                       const allSelected = allKeys.every((k) => selectedLedgerEntryKeys.has(k));
                       setSelectedLedgerEntryKeys(allSelected ? new Set() : new Set(allKeys));
                      }}
                      className="cursor-pointer"
                     />
                    </th>
                   ) : null}
                   {orderedLedgerColumnOptions.map((column) => {
                    if (!ledgerColumnVisibility[column.key]) {
                     return null;
                    }

                    const headerClassName = `px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'} cursor-move select-none`;

                    const headerContent = (
                     <span className="inline-flex items-center gap-1.5">
                      <svg
                       width="10"
                       height="10"
                       viewBox="0 0 24 24"
                       fill="currentColor"
                       aria-hidden
                       className={`shrink-0 text-fg-faint ${draggedLedgerColumn === column.key ? 'opacity-50' : 'opacity-70'}`}
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
                      <span>{column.label}</span>
                     </span>
                    );

                    switch (column.key) {
                     case 'created':
                      return (
                       <th
                        key={column.key}
                        data-drag-key={column.key}
                        {...ledgerColumnDrag.dragHandleProps(column.key)}
                        className={headerClassName}
                       >
                        {headerContent}
                       </th>
                      );
                     case 'counterparty':
                      return (
                       <th
                        key={column.key}
                        data-drag-key={column.key}
                        {...ledgerColumnDrag.dragHandleProps(column.key)}
                        className={headerClassName}
                       >
                        {headerContent}
                       </th>
                      );
                     case 'direction':
                      return (
                       <th
                        key={column.key}
                        data-drag-key={column.key}
                        {...ledgerColumnDrag.dragHandleProps(column.key)}
                        className={headerClassName}
                       >
                        {headerContent}
                       </th>
                      );
                     case 'type':
                      return (
                       <th
                        key={column.key}
                        data-drag-key={column.key}
                        {...ledgerColumnDrag.dragHandleProps(column.key)}
                        className={headerClassName}
                       >
                        {headerContent}
                       </th>
                      );
                     case 'amount':
                      return (
                       <th
                        key={column.key}
                        data-drag-key={column.key}
                        {...ledgerColumnDrag.dragHandleProps(column.key)}
                        className={headerClassName}
                       >
                        {headerContent}
                       </th>
                      );
                     case 'exchangeRate':
                      return (
                       <th
                        key={column.key}
                        data-drag-key={column.key}
                        {...ledgerColumnDrag.dragHandleProps(column.key)}
                        className={headerClassName}
                       >
                        {headerContent}
                       </th>
                      );
                     case 'commission':
                      return (
                       <th
                        key={column.key}
                        data-drag-key={column.key}
                        {...ledgerColumnDrag.dragHandleProps(column.key)}
                        className={headerClassName}
                       >
                        {headerContent}
                       </th>
                      );
                     case 'netChange':
                      return (
                       <th
                        key={column.key}
                        data-drag-key={column.key}
                        {...ledgerColumnDrag.dragHandleProps(column.key)}
                        className={headerClassName}
                       >
                        {headerContent}
                       </th>
                      );
                     case 'runningBalance':
                      return (
                       <th
                        key={column.key}
                        data-drag-key={column.key}
                        {...ledgerColumnDrag.dragHandleProps(column.key)}
                        className={headerClassName}
                       >
                        {headerContent}
                       </th>
                      );
                     case 'currency':
                      return (
                       <th
                        key={column.key}
                        data-drag-key={column.key}
                        {...ledgerColumnDrag.dragHandleProps(column.key)}
                        className={headerClassName}
                       >
                        {headerContent}
                       </th>
                      );
                     case 'description':
                      return (
                       <th
                        key={column.key}
                        data-drag-key={column.key}
                        {...ledgerColumnDrag.dragHandleProps(column.key)}
                        className={headerClassName}
                       >
                        {headerContent}
                       </th>
                      );
                    }
                   })}
                  </tr>
                 </thead>
                 <tbody>
                  {(() => {
                   // ledger.entries is already in the user's manual order (applied in the memo).
                   const ordered = ledger.entries;
                   const visible = ordered.filter((e) => {
                    if (ledgerFilterDateFrom && e.createdAt.slice(0, 10) < ledgerFilterDateFrom) return false;
                    if (ledgerFilterDateTo && e.createdAt.slice(0, 10) > ledgerFilterDateTo) return false;
                    if (ledgerFilterCounterparty && e.counterpartyName !== ledgerFilterCounterparty) return false;
                    if (!ledgerEntryMatchesSearch(e, ledgerFilterSearch.trim(), ledgerFilterWholeWord)) return false;
                    return true;
                   });
                   // Pagination: entries sorted oldest→newest; page N = newest (last chunk).
                   const totalLedgerPages = Math.max(1, Math.ceil(visible.length / ledgerPageSize));
                   const currentLedgerPage = Math.max(1, Math.min(ledgerPageState[ledger.accountId] ?? 99999, totalLedgerPages));
                   const ledgerStart = (currentLedgerPage - 1) * ledgerPageSize;
                   const pagedEntries = visible.slice(ledgerStart, ledgerStart + ledgerPageSize);
                   return pagedEntries.map((entry, entryIdx) => {
                    // Shared by the row's onContextMenu (desktop right-click) and its visible
                    // "⋮" button (touch devices have no right-click event to hook into).
                    const openRowMenu = (event: ReactMouseEvent) => {
                     const rowKeyForMenu = getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId);
                     if (editingLedgerRowKeys.has(rowKeyForMenu)) return;
                     setContextMenuRowKey(rowKeyForMenu);
                     // Right-clicking a row that's part of a multi-selection offers bulk actions
                     // (edit / delete) that apply to every selected entry at once; otherwise the
                     // menu targets just this row.
                     if (selectedLedgerEntryKeys.size > 1 && selectedLedgerEntryKeys.has(rowKeyForMenu)) {
                      rowContextMenu.open(event, [
                       { key: 'edit-selected', label: `${t('edit')} (${selectedLedgerEntryKeys.size})`, onSelect: () => onEditSelectedLedgerEntries() },
                       { key: 'delete-selected', label: `${t('delete')} (${selectedLedgerEntryKeys.size})`, onSelect: () => void onDeleteSelectedLedgerEntries(), tone: 'danger' as const },
                      ]);
                      return;
                     }
                     rowContextMenu.open(event, [
                      { key: 'edit', label: t('edit'), onSelect: () => openLedgerRowForEdit(entry, ledger.accountId) },
                      entry.reconciledMark
                       ? { key: 'unreconcile', label: t('reconcile_remove_action'), onSelect: () => onRemoveReconciliation(entry, ledger.accountId), tone: 'success' as const }
                       : { key: 'reconcile', label: t('reconcile_action'), onSelect: () => onReconcileLedgerEntry(entry, ledger.accountId) },
                      ...(entry.runningBalance !== 0 && Math.abs(entry.runningBalance) <= SMALL_BALANCE_THRESHOLD
                       ? [{ key: 'writeoff', label: t('write_off_row_action'), onSelect: () => onWriteOffLedgerRow(entry, ledger.accountId) }]
                       : []),
                      { key: 'delete', label: t('delete'), onSelect: () => void onDeleteLedgerEntry(entry, ledger.accountId), tone: 'danger' as const },
                     ]);
                    };
                    return (
                    <Fragment key={`${ledger.accountId}-${entry.transactionId}-${entry.direction}`}>
                     <tr
                      data-drag-key={getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId)}
                      onClick={(e) => {
                       const rowKey = getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId);
                       if (editingLedgerRowKeys.has(rowKey)) return;
                       // Swallow the click synthesized at the end of a drag so reordering a row
                       // doesn't also highlight/copy it.
                       if (justDraggedLedgerRowRef.current) {
                        justDraggedLedgerRowRef.current = false;
                        return;
                       }
                       if ((e.target as HTMLElement).closest('button, a, input, select, textarea, label')) return;
                       // Neutral pointer: no click mode engaged, so a row click does nothing.
                       if (!ledgerRowClickActive) return;
                       if (ledgerRowClickHighlight) {
                        toggleLedgerRowHighlight(rowKey);
                        return;
                       }
                       // Copy mode: copy the clicked cell's value (strip trailing currency code/symbol).
                       const td = (e.target as HTMLElement).closest('td');
                       // Skip the leading non-data columns (actions, plus the checkbox column
                       // when selection mode is on) so only real cell text is copied.
                       if (!td || (td as HTMLTableCellElement).cellIndex < (selectionMode ? 2 : 1)) return;
                       const raw = (td as HTMLElement).innerText.trim();
                       const text = raw.replace(/\s+([A-Z]{2,5}|[$€£¥₹₩₪₺₽฿₫])$/, '').trim() || raw;
                       if (text) navigator.clipboard.writeText(text).then(() => showToast(t('toast_copied'), e));
                      }}
                      onContextMenu={openRowMenu}
                      onKeyDown={(e) => {
                       // Enter saves the row being edited (ignore Enter inside multi-line fields).
                       if (e.key !== 'Enter') return;
                       const rowKey = getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId);
                       if (!editingLedgerRowKeys.has(rowKey)) return;
                       if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
                       e.preventDefault();
                       void onSaveLedgerRow(entry.transactionId, ledger.accountId);
                      }}
                      style={(() => {
                       const rowKey = getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId);
                       const color = highlightedLedgerRows.get(rowKey);
                       const isEditing = editingLedgerRowKeys.has(rowKey);
                       return {
                        ...(color ? { backgroundColor: resolveHighlightBg(color, isDark) } : {}),
                        ...(isEditing || !ledgerRowClickActive ? {} : ledgerRowClickHighlight ? { cursor: HIGHLIGHT_PEN_CURSOR } : { cursor: 'copy' }),
                       };
                      })()}
                      className={`border-t border-border align-top transition-colors ${entryIdx % 2 === 1 ? 'bg-surface-2' : 'bg-surface'} hover:bg-surface-hover ${entry.isLocked ? 'border-l-2 border-l-emerald-400' : ''} ${entry.reconciledMark ? 'border-b-2 border-b-emerald-500' : ''} ${dragLedgerRowKey !== null && ((selectedLedgerEntryKeys.has(dragLedgerRowKey) && selectedLedgerEntryKeys.has(getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId))) || dragLedgerRowKey === getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId)) ? 'opacity-40' : ''} ${dragOverLedgerRowKey === getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId) && dragOverLedgerHalf === 'top' ? 'border-t-2 border-t-blue-500' : ''} ${dragOverLedgerRowKey === getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId) && dragOverLedgerHalf === 'bottom' ? 'border-b-2 border-b-blue-500' : ''} ${contextMenuRowKey === getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId) ? 'ring-2 ring-inset ring-indigo-400' : ''}`}
                     >
                      {(() => {
                       const rowKey = getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId);
                       const isEditingRow = editingLedgerRowKeys.has(rowKey);
                       const isRowHighlighted = highlightedLedgerRows.has(rowKey);
                       const draft = isEditingRow ? getClientLedgerDraft(entry.transactionId, ledger.accountId) : null;

                       return (
                        <>
                         {/* actions */}
                         <td className="px-2 py-3 align-top w-10">
                          {isEditingRow ? (
                           <div className="flex items-center gap-1">
                            <button
                             type="button"
                             title={t('save_changes')}
                             onClick={() => void onSaveLedgerRow(entry.transactionId, ledger.accountId)}
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
                             onClick={() => {
                              setEditingLedgerRowKeys((prev) => {
                               const n = new Set(prev);
                               n.delete(rowKey);
                               return n;
                              });
                              setLedgerTransactionDrafts((prev) => {
                               const n = { ...prev };
                               delete n[rowKey];
                               return n;
                              });
                             }}
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
                           </div>
                          ) : (
                           // Row actions (edit/reconcile/write off/delete) live in the right-click
                           // context menu (desktop, see onContextMenu on the <tr> above) plus the
                           // visible "⋮" button beside the drag handle — the only way to reach them
                           // on touch devices, which have no right-click event to hook into.
                           <div className="flex items-center justify-center gap-1">
                            <span
                             {...ledgerRowDrag.dragHandleProps(getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId))}
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
                             onClick={openRowMenu}
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
                         {/* checkbox */}
                         {selectionMode ? (
                          <td className="px-2 py-3 align-middle w-8">
                           <input
                            type="checkbox"
                            checked={selectedLedgerEntryKeys.has(rowKey)}
                            onChange={() => onToggleLedgerEntrySelection(rowKey)}
                            className="cursor-pointer"
                           />
                          </td>
                         ) : null}
                         {orderedLedgerColumnOptions.map((column) => {
                          if (!ledgerColumnVisibility[column.key]) {
                           return null;
                          }

                          switch (column.key) {
                           case 'created':
                            return (
                             <td
                              key={column.key}
                              className="px-4 py-3 text-fg-faint"
                             >
                              {draft ? (
                               <input
                                type="date"
                                value={draft.createdDate}
                                onChange={(event) => updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { createdDate: event.target.value })}
                                style={{ width: '8.5rem' }}
                                className="rounded border border-border-strong px-2 py-1.5 text-xs outline-none ring-blue-300 focus:ring"
                               />
                              ) : (
                               formatDateValue(entry.createdAt, ledgerDateFormat)
                              )}
                             </td>
                            );
                           case 'counterparty':
                            return (
                             <td
                              key={column.key}
                              className="px-4 py-3 font-medium text-fg whitespace-nowrap"
                             >
                              {entry.isAdjustment && draft ? (
                               // Mirrors the 'direction' column's edit toggle (kept there too for when that
                               // optional column is shown) — repeated here because 'direction' defaults to
                               // hidden, and this is the only always-visible cell for an adjustment row.
                               <div className="grid grid-cols-2 gap-1">
                                <button
                                 type="button"
                                 onClick={() => updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { adjustmentDirection: 'debit' })}
                                 className={`rounded border px-2 py-1 text-xs font-semibold transition ${
                                  draft.adjustmentDirection === 'debit' ? 'border-red-500 bg-bad-bg text-bad-text' : 'border-border-strong bg-surface text-fg-muted hover:bg-surface-hover'
                                 }`}
                                >
                                 {t('adjustment_direction_debit_short')}
                                </button>
                                <button
                                 type="button"
                                 onClick={() => updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { adjustmentDirection: 'credit' })}
                                 className={`rounded border px-2 py-1 text-xs font-semibold transition ${
                                  draft.adjustmentDirection === 'credit'
                                   ? 'border-emerald-500 bg-good-bg text-good-text'
                                   : 'border-border-strong bg-surface text-fg-muted hover:bg-surface-hover'
                                 }`}
                                >
                                 {t('adjustment_direction_credit_short')}
                                </button>
                               </div>
                              ) : entry.isAdjustment ? (
                               <span className="text-fg-faint">-</span>
                              ) : draft ? (
                               (() => {
                                const rowKey = getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId);
                                const selectedAccount = clientAccounts.find((account) => account.id === draft.counterpartyAccountId);
                                return (
                                 <div className="flex items-center gap-1">
                                  <div className="relative">
                                   <input
                                    type="text"
                                    value={
                                     ledgerCounterpartyOpen === rowKey
                                      ? ledgerCounterpartyQuery
                                      : selectedAccount
                                        ? `${selectedAccount.clientName} · ${selectedAccount.currencyCode}`
                                        : ''
                                    }
                                    onChange={(e) => {
                                     setLedgerCounterpartyQuery(e.target.value);
                                     setLedgerCounterpartyOpen(rowKey);
                                    }}
                                    onFocus={() => {
                                     setLedgerCounterpartyQuery('');
                                     setLedgerCounterpartyOpen(rowKey);
                                    }}
                                    onBlur={() => {
                                     const capturedKey = rowKey;
                                     setTimeout(() => setLedgerCounterpartyOpen((current) => (current === capturedKey ? null : current)), 150);
                                    }}
                                    placeholder={t('transaction_account_placeholder')}
                                    style={{ width: '12rem' }}
                                    className="rounded border border-border-strong py-1.5 pe-6 ps-2 text-xs outline-none ring-blue-300 focus:ring"
                                    autoComplete="off"
                                   />
                                   {draft.counterpartyAccountId && ledgerCounterpartyOpen !== rowKey ? (
                                    <button
                                     type="button"
                                     onMouseDown={(e) => {
                                      e.preventDefault();
                                      updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { counterpartyAccountId: null });
                                      setLedgerCounterpartyQuery('');
                                      setLedgerCounterpartyOpen(null);
                                     }}
                                     title={t('clear_selection')}
                                     className="absolute inset-y-0 end-1 my-auto flex h-4 w-4 items-center justify-center rounded text-fg-faint hover:bg-surface-hover hover:text-fg-muted"
                                    >
                                     <svg
                                      width="10"
                                      height="10"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2.5"
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
                                   {ledgerCounterpartyOpen === rowKey && (
                                    <ul className="absolute z-30 mt-1 max-h-48 w-52 overflow-y-auto rounded border border-border bg-surface text-xs shadow-lg">
                                     {(() => {
                                      const q = ledgerCounterpartyQuery.trim().toLowerCase();
                                      const byClient = new Map<number, ClientAccount[]>();
                                      for (const a of clientAccounts) {
                                       if (a.id === ledger.accountId) continue;
                                       if (q && !`${a.clientName} ${a.currencyCode}`.toLowerCase().includes(q)) continue;
                                       const arr = byClient.get(a.clientId) ?? [];
                                       arr.push(a);
                                       byClient.set(a.clientId, arr);
                                      }
                                      const groups = [...byClient.values()];
                                      if (groups.length === 0) {
                                       return <li className="px-3 py-2 text-fg-faint">{t('transaction_account_placeholder')}</li>;
                                      }
                                      const selectAccount = (id: number) => {
                                       updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { counterpartyAccountId: id });
                                       setLedgerCounterpartyQuery('');
                                       setLedgerCounterpartyOpen(null);
                                       setLedgerCounterpartyExpandedClient(null);
                                      };
                                      return groups.map((accts) => {
                                       const clientId = accts[0].clientId;
                                       if (accts.length === 1) {
                                        const account = accts[0];
                                        return (
                                         <li
                                          key={`g${clientId}`}
                                          onMouseDown={() => selectAccount(account.id)}
                                          className={`cursor-pointer px-3 py-1.5 hover:bg-accent-weak ${draft.counterpartyAccountId === account.id ? 'bg-accent-weak font-medium text-accent' : 'text-fg'}`}
                                         >
                                          {account.clientName} · {account.currencyCode}
                                         </li>
                                        );
                                       }
                                       const expanded = !!q || ledgerCounterpartyExpandedClient === clientId;
                                       const hasSelected = accts.some((a) => a.id === draft.counterpartyAccountId);
                                       return (
                                        <Fragment key={`g${clientId}`}>
                                         <li
                                          onMouseDown={(e) => {
                                           e.preventDefault();
                                           setLedgerCounterpartyExpandedClient(expanded && !q ? null : clientId);
                                          }}
                                          className={`flex cursor-pointer items-center justify-between px-3 py-1.5 hover:bg-accent-weak ${hasSelected ? 'font-medium text-accent' : 'text-fg'}`}
                                         >
                                          <span>{accts[0].clientName}</span>
                                          <span className="flex items-center gap-1 text-fg-faint">
                                           {accts.length}
                                           <svg
                                            width="10"
                                            height="10"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
                                            aria-hidden
                                           >
                                            <path d="m6 9 6 6 6-6" />
                                           </svg>
                                          </span>
                                         </li>
                                         {expanded &&
                                          accts.map((account) => (
                                           <li
                                            key={account.id}
                                            onMouseDown={() => selectAccount(account.id)}
                                            className={`cursor-pointer py-1.5 ps-7 pe-3 hover:bg-accent-weak ${draft.counterpartyAccountId === account.id ? 'bg-accent-weak font-medium text-accent' : 'text-fg-muted'}`}
                                           >
                                            {account.currencyCode}
                                           </li>
                                          ))}
                                        </Fragment>
                                       );
                                      });
                                     })()}
                                    </ul>
                                   )}
                                  </div>
                                  <button
                                   type="button"
                                   title={t('ledger_swap_parties')}
                                   onClick={() =>
                                    updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { direction: draft.direction === 'outgoing' ? 'incoming' : 'outgoing' })
                                   }
                                   className="shrink-0 rounded p-1 text-fg-faint transition hover:bg-surface-hover hover:text-accent"
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
                                 </div>
                                );
                               })()
                              ) : entry.counterpartyClientId ? (
                               <a
                                href={`/clients/${entry.counterpartyClientId}`}
                                onClick={(e) => {
                                 if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
                                 e.preventDefault();
                                 const client = clients.find((c) => c.id === entry.counterpartyClientId);
                                 if (client) openClientLedger(client, clientLedgerBackSection);
                                }}
                                className="cursor-pointer font-medium text-accent underline decoration-blue-300 underline-offset-2 transition hover:text-accent"
                               >
                                {entry.counterpartyName}
                                {(entry.counterpartyCurrencySymbol || entry.counterpartyCurrencyCode) && (
                                 <span className="font-normal text-accent"> ({entry.counterpartyCurrencySymbol || entry.counterpartyCurrencyCode})</span>
                                )}
                               </a>
                              ) : (
                               <>
                                {entry.counterpartyName}
                                {(entry.counterpartyCurrencySymbol || entry.counterpartyCurrencyCode) && (
                                 <span className="font-normal text-fg-faint"> ({entry.counterpartyCurrencySymbol || entry.counterpartyCurrencyCode})</span>
                                )}
                               </>
                              )}
                             </td>
                            );
                           case 'direction':
                            return (
                             <td
                              key={column.key}
                              className="px-4 py-3"
                             >
                              {entry.isAdjustment && draft ? (
                               <div className="grid grid-cols-2 gap-1">
                                <button
                                 type="button"
                                 onClick={() => updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { adjustmentDirection: 'debit' })}
                                 className={`rounded border px-2 py-1 text-xs font-semibold transition ${
                                  draft.adjustmentDirection === 'debit' ? 'border-red-500 bg-bad-bg text-bad-text' : 'border-border-strong bg-surface text-fg-muted hover:bg-surface-hover'
                                 }`}
                                >
                                 {t('adjustment_direction_debit_short')}
                                </button>
                                <button
                                 type="button"
                                 onClick={() => updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { adjustmentDirection: 'credit' })}
                                 className={`rounded border px-2 py-1 text-xs font-semibold transition ${
                                  draft.adjustmentDirection === 'credit'
                                   ? 'border-emerald-500 bg-good-bg text-good-text'
                                   : 'border-border-strong bg-surface text-fg-muted hover:bg-surface-hover'
                                 }`}
                                >
                                 {t('adjustment_direction_credit_short')}
                                </button>
                               </div>
                              ) : entry.isAdjustment ? (
                               <span
                                className={`inline-flex rounded px-2.5 py-1 text-xs font-semibold ${entry.direction === 'outgoing' ? 'bg-good-bg text-good-text' : 'bg-bad-bg text-bad-text'}`}
                               >
                                {entry.direction === 'outgoing' ? t('adjustment_direction_credit') : t('adjustment_direction_debit')}
                               </span>
                              ) : draft ? (
                               <select
                                value={draft.direction}
                                onChange={(event) =>
                                 updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { direction: event.target.value as 'incoming' | 'outgoing' })
                                }
                                style={{ width: ledgerSelectWidth(draft.direction === 'outgoing' ? t('outgoing') : t('incoming'), 6, 2) }}
                                className="rounded border border-border-strong px-2 py-1.5 text-xs outline-none ring-blue-300 focus:ring"
                               >
                                <option value="incoming">{t('incoming')}</option>
                                <option value="outgoing">{t('outgoing')}</option>
                               </select>
                              ) : (
                               <span
                                className={`inline-flex rounded px-2.5 py-1 text-xs font-semibold ${entry.direction === 'incoming' ? 'bg-bad-bg text-bad-text' : 'bg-good-bg text-good-text'}`}
                               >
                                {entry.direction === 'incoming' ? t('incoming') : t('outgoing')}
                               </span>
                              )}
                             </td>
                            );
                           case 'type':
                            return (
                             <td
                              key={column.key}
                              className="px-4 py-3 text-fg-muted"
                             >
                              {entry.isAdjustment ? (
                               <span className="inline-flex rounded bg-violet-bg px-2.5 py-1 text-xs font-semibold text-violet-text">{t('adjustment_label')}</span>
                              ) : draft ? (
                               <select
                                value={draft.type}
                                onChange={(event) => updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { type: event.target.value })}
                                style={{ width: ledgerSelectWidth(draft.type === 'transfer' ? t('transaction_type_transfer') : t('transaction_type_exchange'), 7, 2) }}
                                className="rounded border border-border-strong px-2 py-1.5 text-xs outline-none ring-blue-300 focus:ring"
                               >
                                <option value="exchange">{t('transaction_type_exchange')}</option>
                                <option value="transfer">{t('transaction_type_transfer')}</option>
                               </select>
                              ) : (
                               t(entry.type === 'transfer' ? 'transaction_type_transfer' : 'transaction_type_exchange')
                              )}
                             </td>
                            );
                           case 'amount':
                            // A charge in the same currency as the amount is shown here, subtracted directly
                            // from the amount (they're comparable) — otherwise it stays under net change,
                            // where the account's own currency makes a cross-currency charge meaningful.
                            const showChargesUnderAmount = !draft && !entry.isAdjustment && entry.charges > 0 && entry.chargeAffectsThisAccount && entry.chargesCurrencyCode === entry.currencyCode;
                            return (
                             <td
                              key={column.key}
                              className={`whitespace-nowrap px-4 py-3 font-semibold ${(draft?.direction ?? entry.direction) === 'outgoing' ? 'text-good-text' : 'text-bad-text'}`}
                             >
                              {draft ? (
                               <div className="flex items-center gap-1">
                                <input
                                 type="text"
                                 inputMode="decimal"
                                 dir="ltr"
                                 value={formatAmountInput(draft.amount)}
                                 data-ledger-field="amount"
                                 data-ledger-key={getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId)}
                                 onChange={(event) => updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { amount: normalizeDecimalInput(event.target.value) })}
                                 onKeyDown={(event) => onLedgerEditFieldArrowKey(event, 'amount', entry, ledger.accountId, pagedEntries, entryIdx)}
                                 style={{ width: ledgerFieldWidth(formatAmountInput(draft.amount), 5, 2) }}
                                 className="rounded border border-border-strong px-2 py-1.5 text-xs outline-none ring-blue-300 focus:ring"
                                />
                                {/* Expenses (adjustments) can be in any currency, but the dedicated
                                    "currency" column defaults to hidden — show a fallback selector
                                    here so an expense's currency is always editable, not just when
                                    that column happens to be toggled on. */}
                                {entry.isAdjustment && !ledgerColumnVisibility.currency && (
                                 <select
                                  value={draft.currencyId ?? ''}
                                  onChange={(event) =>
                                   updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { currencyId: event.target.value ? Number(event.target.value) : null })
                                  }
                                  style={{ width: ledgerSelectWidth(enabledCurrencies.find((cur) => cur.id === draft.currencyId)?.code ?? '', 5, 2) }}
                                  className="rounded border border-border-strong px-2 py-1.5 text-xs outline-none ring-blue-300 focus:ring"
                                 >
                                  {enabledCurrencies.map((cur) => (
                                   <option
                                    key={cur.id}
                                    value={cur.id}
                                   >
                                    {cur.code}
                                   </option>
                                  ))}
                                 </select>
                                )}
                               </div>
                              ) : ledgerSumMode ? (
                               (() => {
                                const sumKey = `${rowKey}:amount`;
                                const inSum = ledgerSumSelection.has(sumKey);
                                return (
                                 <button
                                  type="button"
                                  onClick={() => toggleLedgerSumEntry(sumKey)}
                                  className={`cursor-pointer rounded px-1.5 py-0.5 transition ${inSum ? 'bg-violet-bg ring-1 ring-purple-400' : 'hover:bg-violet-bg'}`}
                                 >
                                  {entry.amount.toLocaleString(numLocale, { maximumFractionDigits: ledgerDecimals })}
                                  {renderLedgerCurrencySuffix(entry.currencySymbol, entry.currencyCode)}
                                 </button>
                                );
                               })()
                              ) : (
                               <>
                                {entry.amount.toLocaleString(numLocale, { maximumFractionDigits: ledgerDecimals })}
                                {renderLedgerCurrencySuffix(entry.currencySymbol, entry.currencyCode)}
                               </>
                              )}
                              {showChargesUnderAmount && (
                               <div className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-bad-text">
                                <span>
                                 −{entry.charges.toLocaleString(numLocale, { maximumFractionDigits: ledgerDecimals })}
                                 {renderLedgerCurrencySuffix(entry.currencySymbol, entry.currencyCode)}
                                </span>
                                {entry.chargesDescription && <span className="font-normal italic text-fg-faint">{entry.chargesDescription}</span>}
                               </div>
                              )}
                             </td>
                            );
                           case 'exchangeRate':
                            return (
                             <td
                              key={column.key}
                              className="px-4 py-3 text-fg-muted"
                             >
                              {draft
                               ? (() => {
                                  const ledgerRateKey = `${entry.transactionId}:${ledger.accountId}`;
                                  const isLedgerRateReversed = ledgerRateReversed[ledgerRateKey] ?? false;
                                  // For adjustments, the draft's own (just-picked) currency decides whether a
                                  // rate is needed — not the entry's last-saved currency — so changing an
                                  // expense's currency mid-edit immediately reveals/hides the rate field
                                  // instead of lagging a save behind.
                                  const txCurr = entry.isAdjustment ? (enabledCurrencies.find((cur) => cur.id === draft.currencyId)?.code ?? entry.currencyCode) : entry.currencyCode;
                                  const accCurr = ledger.currencyCode;
                                  // Adjustment with same currency as account: no rate needed
                                  if (entry.isAdjustment && txCurr === accCurr) {
                                   return <span className="text-fg-faint">-</span>;
                                  }
                                  return (
                                   <div className="flex items-center gap-1">
                                    <input
                                     type="text"
                                     inputMode="decimal"
                                     dir="ltr"
                                     value={draft.exchangeRate}
                                     data-ledger-rate-idx={entryIdx}
                                     data-ledger-account-id={ledger.accountId}
                                     data-ledger-field="exchangeRate"
                                     data-ledger-key={ledgerRateKey}
                                     onChange={(event) =>
                                      updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { exchangeRate: normalizePlainDecimalInput(event.target.value) })
                                     }
                                     onPaste={(event) => {
                                      const text = event.clipboardData.getData('text');
                                      const values = text
                                       .split(/[\r\n]+/)
                                       .map((v) => v.trim())
                                       .filter((v) => v.length > 0);
                                      // Single value: let the browser paste normally into this one input.
                                      if (values.length <= 1) return;
                                      event.preventDefault();

                                      // Rebuild the same filtered visible list the table renders, so we
                                      // can map row positions to transaction drafts. ledger.entries is
                                      // already in the user's manual order (applied in the memo).
                                      const ordered = ledger.entries;
                                      const visible = ordered.filter((e) => {
                                       if (ledgerFilterDateFrom && e.createdAt.slice(0, 10) < ledgerFilterDateFrom) return false;
                                       if (ledgerFilterDateTo && e.createdAt.slice(0, 10) > ledgerFilterDateTo) return false;
                                       if (ledgerFilterCounterparty && e.counterpartyName !== ledgerFilterCounterparty) return false;
                                       if (!ledgerEntryMatchesSearch(e, ledgerFilterSearch.trim(), ledgerFilterWholeWord)) return false;
                                       return true;
                                      });

                                      // Spread each pasted value down consecutive editable rate inputs,
                                      // starting at the row that received the paste. Adjustment rows and
                                      // rows not in edit mode have no rate input, so they are skipped.
                                      // Locate the start row by key in the full (unpaginated) visible list —
                                      // entryIdx is page-relative, so it can't be used to index `visible`.
                                      const startKey = getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId);
                                      const startIdx = Math.max(
                                       0,
                                       visible.findIndex((e) => getLedgerTransactionDraftKey(e.transactionId, ledger.accountId) === startKey),
                                      );
                                      const patches: Record<string, string> = {};
                                      let valueIdx = 0;
                                      for (let i = startIdx; i < visible.length && valueIdx < values.length; i += 1) {
                                       const target = visible[i];
                                       if (target.isAdjustment) continue;
                                       const key = getLedgerTransactionDraftKey(target.transactionId, ledger.accountId);
                                       if (!editingLedgerRowKeys.has(key)) continue;
                                       patches[key] = normalizeDecimalInput(values[valueIdx]);
                                       valueIdx += 1;
                                      }
                                      if (Object.keys(patches).length === 0) return;
                                      ledgerHistory.record();
                                      setLedgerTransactionDrafts((prev) => {
                                       const next = { ...prev };
                                       for (const [key, rate] of Object.entries(patches)) {
                                        if (next[key]) next[key] = { ...next[key], exchangeRate: rate };
                                       }
                                       return next;
                                      });
                                     }}
                                     onKeyDown={(event) => onLedgerEditFieldArrowKey(event, 'exchangeRate', entry, ledger.accountId, pagedEntries, entryIdx)}
                                     style={{ width: ledgerFieldWidth(draft.exchangeRate, 5, 2) }}
                                     className="rounded border border-border-strong px-2 py-1.5 text-xs outline-none ring-blue-300 focus:ring"
                                    />
                                    {txCurr && accCurr && txCurr !== accCurr && (
                                     <button
                                      type="button"
                                      title="Reverse rate direction"
                                      onClick={() => {
                                       const val = parseFloat(draft.exchangeRate) || 1;
                                       updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { exchangeRate: (1 / val).toFixed(6).replace(/\.?0+$/, '') });
                                       setLedgerRateReversed((prev) => ({ ...prev, [ledgerRateKey]: !isLedgerRateReversed }));
                                      }}
                                      className="inline-flex shrink-0 items-center gap-0.5 rounded p-0.5 text-fg-faint hover:text-fg-muted"
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
                                       {isLedgerRateReversed ? '÷' : '×'}
                                      </span>
                                     </button>
                                    )}
                                   </div>
                                  );
                                 })()
                               : (() => {
                                  const displayRateKey = `${entry.transactionId}:${ledger.accountId}`;
                                  const txCurr = entry.currencyCode;
                                  const accCurr = ledger.currencyCode;
                                  const defaultReversed = entry.exchangeRateReversed;
                                  const isReversed = ledgerDisplayRateReversed[displayRateKey] ?? defaultReversed;
                                  // Different currency but no rate entered yet: show a dash. This entry is
                                  // excluded from the balance until the user sets a rate.
                                  if (entry.pendingRate) {
                                   return (
                                    <span
                                     className="text-warn-text"
                                     title={t('ledger_rate_pending')}
                                    >
                                     -
                                    </span>
                                   );
                                  }
                                  if (!txCurr || !accCurr || txCurr === accCurr || entry.exchangeRate === 1) {
                                   return formatRateValue(entry.exchangeRate);
                                  }
                                  const rateNumber = isReversed ? formatRateValue(1 / entry.exchangeRate) : formatRateValue(entry.exchangeRate);
                                  const rateLabel = `\u202A${isReversed ? `1 ${accCurr} = ${rateNumber} ${txCurr}` : `1 ${txCurr} = ${rateNumber} ${accCurr}`}\u202C`;
                                  return (
                                   <div className="flex items-center gap-1">
                                    <span title={rateLabel}>{rateNumber}</span>
                                    <button
                                     type="button"
                                     title="Reverse rate direction"
                                     onClick={() => setLedgerDisplayRateReversed((prev) => ({ ...prev, [displayRateKey]: !isReversed }))}
                                     className="inline-flex items-center gap-0.5 rounded p-0.5 text-fg-faint hover:text-fg-muted"
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
                                      {isReversed ? '÷' : '×'}
                                     </span>
                                    </button>
                                   </div>
                                  );
                                 })()}
                             </td>
                            );
                           case 'commission':
                            return (
                             <td
                              key={column.key}
                              className="px-4 py-3 text-fg-muted"
                             >
                              {draft && entry.isAdjustment ? (
                               <span className="text-fg-faint">-</span>
                              ) : draft ? (
                               (() => {
                                const commVal = parseFloat(draft.commission) || 0;
                                return (
                                 <div className="flex items-center gap-1">
                                  <input
                                   type="text"
                                   inputMode="decimal"
                                   dir="ltr"
                                   value={draft.commission}
                                   data-ledger-commission-idx={entryIdx}
                                   data-ledger-account-id={ledger.accountId}
                                   data-ledger-field="commission"
                                   data-ledger-key={getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId)}
                                   onChange={(event) =>
                                    updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { commission: normalizePlainDecimalInput(event.target.value) })
                                   }
                                   onPaste={(event) => {
                                    const text = event.clipboardData.getData('text');
                                    const values = text
                                     .split(/[\r\n]+/)
                                     .map((v) => v.trim())
                                     .filter((v) => v.length > 0);
                                    // Single value: let the browser paste normally into this one input.
                                    if (values.length <= 1) return;
                                    event.preventDefault();

                                    // Rebuild the same filtered visible list the table renders so pasted
                                    // values map to the right rows, then spread them down consecutive
                                    // editable commission inputs starting at the row that received the paste.
                                    const ordered = ledger.entries;
                                    const visible = ordered.filter((e) => {
                                     if (ledgerFilterDateFrom && e.createdAt.slice(0, 10) < ledgerFilterDateFrom) return false;
                                     if (ledgerFilterDateTo && e.createdAt.slice(0, 10) > ledgerFilterDateTo) return false;
                                     if (ledgerFilterCounterparty && e.counterpartyName !== ledgerFilterCounterparty) return false;
                                     if (!ledgerEntryMatchesSearch(e, ledgerFilterSearch.trim(), ledgerFilterWholeWord)) return false;
                                     return true;
                                    });
                                    const startKey = getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId);
                                    const startIdx = Math.max(
                                     0,
                                     visible.findIndex((e) => getLedgerTransactionDraftKey(e.transactionId, ledger.accountId) === startKey),
                                    );
                                    const patches: Record<string, string> = {};
                                    let valueIdx = 0;
                                    for (let i = startIdx; i < visible.length && valueIdx < values.length; i += 1) {
                                     const target = visible[i];
                                     if (target.isAdjustment) continue;
                                     const key = getLedgerTransactionDraftKey(target.transactionId, ledger.accountId);
                                     if (!editingLedgerRowKeys.has(key)) continue;
                                     patches[key] = normalizeDecimalInput(values[valueIdx]);
                                     valueIdx += 1;
                                    }
                                    if (Object.keys(patches).length === 0) return;
                                    ledgerHistory.record();
                                    setLedgerTransactionDrafts((prev) => {
                                     const next = { ...prev };
                                     for (const [key, commission] of Object.entries(patches)) {
                                      if (next[key]) next[key] = { ...next[key], commission };
                                     }
                                     return next;
                                    });
                                   }}
                                   onKeyDown={(event) => onLedgerEditFieldArrowKey(event, 'commission', entry, ledger.accountId, pagedEntries, entryIdx)}
                                   style={{ width: ledgerFieldWidth(draft.commission, 4, 2) }}
                                   className={`rounded border border-border-strong px-2 py-1.5 text-xs outline-none ring-blue-300 focus:ring ${commVal > 0 ? 'text-good-text font-semibold' : commVal < 0 ? 'text-bad-text font-semibold' : ''}`}
                                   placeholder="0"
                                  />
                                  <button
                                   type="button"
                                   title={commVal < 0 ? t('commission_from_him') : t('commission_for_him')}
                                   onClick={() => {
                                    const v = parseFloat(draft.commission) || 0;
                                    if (v !== 0) updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { commission: String(-v) });
                                   }}
                                   className="shrink-0 rounded p-0.5 text-fg-faint transition hover:bg-surface-hover hover:text-fg-muted"
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
                                 </div>
                                );
                               })()
                              ) : entry.commission ? (
                               <span className={entry.commission < 0 ? 'font-semibold text-bad-text' : 'font-semibold text-good-text'}>
                                {entry.commission.toLocaleString(numLocale, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}%
                               </span>
                              ) : (
                               <span className="text-fg-faint">-</span>
                              )}
                             </td>
                            );
                           case 'netChange':
                            return (() => {
                             // A cross-currency row with no rate set yet is "pending": show a dash and
                             // leave it out of the balance. While editing, recompute live from the draft.
                             const draftRate = draft ? parseFloat(draft.exchangeRate) : NaN;
                             const draftPending = !!draft && entry.currencyCode !== ledger.currencyCode && !(Number.isFinite(draftRate) && draftRate > 0);
                             const isPending = draft ? draftPending : entry.pendingRate;
                             const liveNetChange =
                              draft && !draftPending
                               ? (() => {
                                  const amt = parseFloat(draft.amount) || 0;
                                  const effectiveRate = ledgerRateReversed[rowKey] ? 1 / (draftRate || 1) : draftRate || 1;
                                  const base = amt * effectiveRate;
                                  const commissionAmount = getCommissionAmount(base, parseFloat(draft.commission) || 0);
                                  return draft.direction === 'outgoing' ? base + commissionAmount : -(base - commissionAmount);
                                 })()
                               : entry.netChange;
                             const highlightNet = ledgerHighlightNetChange && !isRowHighlighted;
                             // Same-currency charges are shown under the amount column instead (see the
                             // 'amount' case above), since they're directly comparable there — unless that
                             // column is hidden, in which case they fall back to showing here so the charge
                             // is never silently dropped from view.
                             const showCharges = !draft && !entry.isAdjustment && entry.charges > 0 && entry.chargeAffectsThisAccount && (entry.chargesCurrencyCode !== entry.currencyCode || !ledgerColumnVisibility.amount);
                             return (
                              <td
                               key={column.key}
                               style={highlightNet ? { backgroundColor: resolveHighlightBg(ledgerNetChangeHighlightColor, isDark) } : undefined}
                               className={`px-4 py-3 font-semibold ${isPending ? 'text-warn-text' : liveNetChange >= 0 ? 'text-good-text' : 'text-bad-text'}`}
                              >
                               {isPending ? (
                                <span title={t('ledger_rate_pending')}>-</span>
                               ) : ledgerSumMode && !draft ? (
                                (() => {
                                 const sumKey = `${rowKey}:netChange`;
                                 const inSum = ledgerSumSelection.has(sumKey);
                                 return (
                                  <>
                                   <button
                                    type="button"
                                    onClick={() => toggleLedgerSumEntry(sumKey)}
                                    className={`cursor-pointer whitespace-nowrap rounded px-1.5 py-0.5 transition ${inSum ? 'bg-violet-bg ring-1 ring-purple-400' : 'hover:bg-violet-bg'}`}
                                   >
                                    {liveNetChange.toLocaleString(numLocale, { maximumFractionDigits: ledgerDecimals })}
                                    {renderLedgerCurrencySuffix(ledger.currencySymbol, ledger.currencyCode)}
                                   </button>
                                   {showCharges && (
                                    <div className={`mt-0.5 flex items-center gap-1 text-xs font-semibold ${entry.isChargesPayerThisAccount ? 'text-bad-text' : 'text-good-text'}`}>
                                     <span>
                                      {entry.isChargesPayerThisAccount ? '−' : '+'}
                                      {entry.charges.toLocaleString(numLocale, { maximumFractionDigits: ledgerDecimals })}
                                     </span>
                                     {entry.chargesDescription && <span className="font-normal italic text-fg-faint">{entry.chargesDescription}</span>}
                                    </div>
                                   )}
                                  </>
                                 );
                                })()
                               ) : (
                                <>
                                 <div className="whitespace-nowrap">
                                  {liveNetChange.toLocaleString(numLocale, { maximumFractionDigits: ledgerDecimals })}
                                  {renderLedgerCurrencySuffix(ledger.currencySymbol, ledger.currencyCode)}
                                 </div>
                                 {showCharges && (
                                  <div className={`mt-0.5 flex items-center gap-1 text-xs font-semibold ${entry.isChargesPayerThisAccount ? 'text-bad-text' : 'text-good-text'}`}>
                                   <span>
                                    {entry.isChargesPayerThisAccount ? '−' : '+'}
                                    {entry.charges.toLocaleString(numLocale, { maximumFractionDigits: ledgerDecimals })}
                                   </span>
                                   {entry.chargesDescription && <span className="font-normal italic text-fg-faint">{entry.chargesDescription}</span>}
                                  </div>
                                 )}
                                </>
                               )}
                              </td>
                             );
                            })();
                           case 'runningBalance':
                            return (
                             <td
                              key={column.key}
                              className={`whitespace-nowrap px-4 py-3 font-semibold ${entry.runningBalance >= 0 ? 'text-good-text' : 'text-bad-text'}`}
                             >
                              {ledgerSumMode && !draft ? (
                               (() => {
                                const sumKey = `${rowKey}:runningBalance`;
                                const inSum = ledgerSumSelection.has(sumKey);
                                return (
                                 <button
                                  type="button"
                                  onClick={() => toggleLedgerSumEntry(sumKey)}
                                  className={`cursor-pointer rounded px-1.5 py-0.5 transition ${inSum ? 'bg-violet-bg ring-1 ring-purple-400' : 'hover:bg-violet-bg'}`}
                                 >
                                  {entry.runningBalance.toLocaleString(numLocale, { maximumFractionDigits: ledgerDecimals })}
                                  {renderLedgerCurrencySuffix(ledger.currencySymbol, ledger.currencyCode)}
                                 </button>
                                );
                               })()
                              ) : (
                               <>
                                {entry.runningBalance.toLocaleString(numLocale, { maximumFractionDigits: ledgerDecimals })}
                                {renderLedgerCurrencySuffix(ledger.currencySymbol, ledger.currencyCode)}
                               </>
                              )}
                              {entry.reconciledMark ? (
                               <span
                                title={entry.reconciledMark.note || undefined}
                                className="ms-2 inline-flex items-center gap-1 rounded-full bg-good-bg px-2 py-0.5 text-[10px] font-semibold text-good-text align-middle"
                               >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                 <path d="M20 6L9 17l-5-5" />
                                </svg>
                                {t('reconcile_badge')}
                               </span>
                              ) : null}
                             </td>
                            );
                           case 'currency':
                            return (
                             <td
                              key={column.key}
                              className="px-4 py-3 text-fg-faint whitespace-nowrap"
                             >
                              {draft ? (
                               <select
                                value={draft.currencyId ?? ''}
                                onChange={(event) =>
                                 updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { currencyId: event.target.value ? Number(event.target.value) : null })
                                }
                                style={{ width: ledgerSelectWidth(enabledCurrencies.find((cur) => cur.id === draft.currencyId)?.code ?? '', 5, 2) }}
                                className="rounded border border-border-strong px-2 py-1.5 text-xs outline-none ring-blue-300 focus:ring"
                               >
                                {enabledCurrencies.map((cur) => (
                                 <option
                                  key={cur.id}
                                  value={cur.id}
                                 >
                                  {cur.code}
                                 </option>
                                ))}
                               </select>
                              ) : (
                               <span title={entry.currencyCode}>{entry.currencySymbol || entry.currencyCode || '-'}</span>
                              )}
                             </td>
                            );
                           case 'description':
                            return (
                             <td
                              key={column.key}
                              className="px-4 py-3 text-fg-faint whitespace-nowrap"
                             >
                              {draft ? (
                               <input
                                type="text"
                                value={draft.description}
                                onChange={(event) => updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { description: event.target.value })}
                                style={{ width: ledgerFieldWidth(draft.description, 6, 3) }}
                                className="rounded border border-border-strong px-2 py-1.5 text-xs outline-none ring-blue-300 focus:ring"
                               />
                              ) : (
                               entry.description || '-'
                              )}
                             </td>
                            );
                          }
                         })}
                        </>
                       );
                      })()}
                     </tr>
                     {(() => {
                      const chargesRowKey = getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId);
                      const isEditingThisRow = editingLedgerRowKeys.has(chargesRowKey);
                      const chargesDraft = isEditingThisRow ? getClientLedgerDraft(entry.transactionId, ledger.accountId) : null;
                      const colSpanCount = orderedLedgerColumnOptions.filter((c) => ledgerColumnVisibility[c.key]).length + (selectionMode ? 2 : 1);
                      // An org-settled charge only affects the one named client, so it is editable
                      // from that client's ledger but not the other side's. Everything else is
                      // editable here — including a charge still being added (charges <= 0) with no
                      // payer picked yet. Gate on the saved effect, not the live draft, so the section
                      // doesn't vanish mid-edit while the user is changing the dropdown.
                      const chargesBelongHere = entry.charges <= 0 || entry.chargeAffectsThisAccount;

                      if (isEditingThisRow && chargesDraft && !entry.isAdjustment && chargesBelongHere) {
                       const isZero = parseFloat(chargesDraft.charges) === 0;
                       const expanded = ledgerExpensesExpandedKeys.has(chargesRowKey);
                       if (isZero && !expanded) {
                        return (
                         <tr
                          key={`${ledger.accountId}-${entry.transactionId}-charges-edit`}
                          className="border-t border-dashed border-border bg-surface-2"
                         >
                          <td
                           colSpan={colSpanCount}
                           className="px-4 py-2"
                          >
                           <button
                            type="button"
                            onClick={() => setLedgerExpensesExpandedKeys((prev) => new Set([...prev, chargesRowKey]))}
                            className="text-sm text-accent hover:underline"
                           >
                            + {t('add_expenses')}
                           </button>
                          </td>
                         </tr>
                        );
                       }
                       const ledgerAccountName = clientAccounts.find((a) => a.id === ledger.accountId)?.clientName ?? ledger.currencyCode;
                       // The payer values 'from'/'to' refer to the transaction's accountFrom/accountTo,
                       // which side this ledger account sits on depends on the entry direction: on an
                       // outgoing entry this account is the "from" side, on an incoming entry the "to" side.
                       const fromSideName = entry.direction === 'outgoing' ? ledgerAccountName : entry.counterpartyName;
                       const toSideName = entry.direction === 'outgoing' ? entry.counterpartyName : ledgerAccountName;
                       const draftChargesCurrencyCode = chargesDraft.chargesCurrencyId ? currencyMap.get(chargesDraft.chargesCurrencyId)?.code : undefined;
                       const showRate = !!(draftChargesCurrencyCode && draftChargesCurrencyCode !== ledger.currencyCode);
                       return (
                        <tr
                         key={`${ledger.accountId}-${entry.transactionId}-charges-edit`}
                         className="border-t border-dashed border-border bg-warn-bg"
                        >
                         <td
                          colSpan={colSpanCount}
                          className="px-4 py-2"
                         >
                          <div className="flex flex-wrap items-start gap-2">
                           <span className="mt-2 text-xs font-medium text-warn-text">{t('charges')}</span>
                           <input
                            type="text"
                            inputMode="decimal"
                            dir="ltr"
                            value={formatAmountInput(chargesDraft.charges)}
                            onChange={(event) => updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { charges: normalizeDecimalInput(event.target.value) })}
                            className="field-sizing-content min-w-16 rounded border border-border-strong px-2 py-1.5 text-xs outline-none ring-blue-300 focus:ring"
                            placeholder="0"
                           />
                           <select
                            value={chargesDraft.chargesCurrencyId ?? ''}
                            onChange={(event) =>
                             updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { chargesCurrencyId: event.target.value ? Number(event.target.value) : null })
                            }
                            className="rounded border border-border-strong px-2 py-1.5 text-xs outline-none ring-blue-300 focus:ring"
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
                            value={chargesDraft.chargesPayer}
                            onChange={(chargesPayer) => updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { chargesPayer })}
                            fromLabel={fromSideName}
                            toLabel={toSideName}
                            meLabel={t('charges_payer_me')}
                            paidByPlaceholder={t('charges_payer_placeholder')}
                            paidToPlaceholder={t('charges_payer_to_placeholder')}
                            className="rounded border border-border-strong px-2 py-1.5 text-xs outline-none ring-blue-300 focus:ring"
                           />
                           {showRate && (
                            <div className="flex items-center gap-1">
                             <span dir="ltr" className="text-xs text-fg-faint">
                              {draftChargesCurrencyCode} → {ledger.currencyCode}
                             </span>
                             <input
                              type="text"
                              inputMode="decimal"
                              dir="ltr"
                              value={chargesDraft.chargesExchangeRate}
                              onChange={(event) =>
                               updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { chargesExchangeRate: normalizePlainDecimalInput(event.target.value) })
                              }
                              className="field-sizing-content min-w-16 rounded border border-border-strong px-2 py-1.5 text-xs outline-none ring-blue-300 focus:ring"
                              placeholder="1"
                             />
                            </div>
                           )}
                           <input
                            type="text"
                            value={chargesDraft.chargesDescription}
                            onChange={(event) => updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { chargesDescription: event.target.value })}
                            className="field-sizing-content min-w-28 rounded border border-border-strong px-2 py-1.5 text-xs outline-none ring-blue-300 focus:ring"
                            placeholder={t('charges_description_placeholder')}
                           />
                          </div>
                         </td>
                        </tr>
                       );
                      }

                      return null;
                     })()}
                    </Fragment>
                    );
                   });
                  })()}
                  {(ledgerFilterSearch || ledgerFilterCounterparty || ledgerFilterDateFrom || ledgerFilterDateTo) &&
                   ledger.entries.length > 0 &&
                   (() => {
                    const visibleCount = ledger.entries.filter((e) => {
                     if (ledgerFilterDateFrom && e.createdAt.slice(0, 10) < ledgerFilterDateFrom) return false;
                     if (ledgerFilterDateTo && e.createdAt.slice(0, 10) > ledgerFilterDateTo) return false;
                     if (ledgerFilterCounterparty && e.counterpartyName !== ledgerFilterCounterparty) return false;
                     if (!ledgerEntryMatchesSearch(e, ledgerFilterSearch.trim(), ledgerFilterWholeWord)) return false;
                     return true;
                    }).length;
                    if (visibleCount > 0) return null;
                    return (
                     <tr>
                      <td
                       colSpan={orderedLedgerColumnOptions.filter((c) => ledgerColumnVisibility[c.key]).length + (selectionMode ? 2 : 1)}
                       className="px-4 py-6 text-sm text-fg-faint"
                      >
                       {t('no_search_results')}
                      </td>
                     </tr>
                    );
                   })()}
                 </tbody>
                </table>
               </div>
               {(() => {
                const ordered = ledger.entries;
                const visibleCount = ordered.filter((e) => {
                 if (ledgerFilterDateFrom && e.createdAt.slice(0, 10) < ledgerFilterDateFrom) return false;
                 if (ledgerFilterDateTo && e.createdAt.slice(0, 10) > ledgerFilterDateTo) return false;
                 if (ledgerFilterCounterparty && e.counterpartyName !== ledgerFilterCounterparty) return false;
                 if (!ledgerEntryMatchesSearch(e, ledgerFilterSearch.trim(), ledgerFilterWholeWord)) return false;
                 return true;
                }).length;
                if (visibleCount === 0) return null;
                const totalLedgerPages = Math.max(1, Math.ceil(visibleCount / ledgerPageSize));
                const currentLedgerPage = Math.max(1, Math.min(ledgerPageState[ledger.accountId] ?? 99999, totalLedgerPages));
                return (
                 <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  {/* Row-click mode (highlight / copy / sum) + live sum totals, at the foot opposite the pager. */}
                  <div className="flex flex-wrap items-center gap-1.5">
                   <button
                    type="button"
                    title={t('ledger_click_highlight_mode')}
                    onClick={() => setLedgerRowClickMode(ledgerRowClickActive && ledgerRowClickHighlight ? 'none' : 'highlight')}
                    aria-pressed={ledgerRowClickActive && ledgerRowClickHighlight}
                    className={`cursor-pointer rounded border px-2 py-1.5 text-sm font-semibold transition ${
                     ledgerRowClickActive && ledgerRowClickHighlight ? 'border-amber-400 bg-warn-bg text-warn-text hover:bg-warn-bg' : 'border-border-strong text-fg-faint hover:bg-surface-hover'
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
                    onClick={() => setLedgerRowClickMode(ledgerRowClickActive && !ledgerRowClickHighlight ? 'none' : 'copy')}
                    aria-pressed={ledgerRowClickActive && !ledgerRowClickHighlight}
                    className={`cursor-pointer rounded border px-2 py-1.5 text-sm font-semibold transition ${
                     ledgerRowClickActive && !ledgerRowClickHighlight ? 'border-blue-400 bg-accent-weak text-accent hover:bg-accent-weak' : 'border-border-strong text-fg-faint hover:bg-surface-hover'
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
                    title={t('ledger_sum_mode_hint')}
                    onClick={toggleLedgerSumMode}
                    aria-pressed={ledgerSumMode}
                    className={`cursor-pointer rounded border px-2 py-1.5 text-sm font-semibold transition ${
                     ledgerSumMode ? 'border-purple-400 bg-violet-bg text-violet-text hover:bg-violet-bg' : 'border-border-strong text-fg-faint hover:bg-surface-hover'
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
                   {/* Select mode: reveals a checkbox per row so several entries can be picked
                       for a bulk drag or a right-click bulk action (edit / delete). */}
                   <button
                    type="button"
                    title={t('bulk_select')}
                    onClick={toggleSelectionMode}
                    aria-pressed={selectionMode}
                    className={`cursor-pointer rounded border px-2 py-1.5 text-sm font-semibold transition ${
                     selectionMode ? 'border-blue-500 bg-accent-weak text-accent hover:bg-accent-weak' : 'border-border-strong text-fg-faint hover:bg-surface-hover'
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
                     <path d="M9 11l3 3L22 4" />
                     <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                    </svg>
                   </button>
                   {selectionMode && selectedLedgerEntryKeys.size > 0 ? (
                    <button
                     type="button"
                     onClick={() => void onDeleteSelectedLedgerEntries()}
                     className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-red-500 bg-bad-bg px-3 py-1.5 text-sm font-semibold text-bad-text transition hover:bg-bad-bg"
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
                     {selectedLedgerEntryKeys.size}
                    </button>
                   ) : null}
                   {[...ledgerSumByCurrency.entries()].map(([code, bucket]) => (
                    <span
                     key={code || 'none'}
                     className="inline-flex items-center gap-1.5 rounded border border-purple-300 bg-violet-bg px-3 py-1.5 text-sm text-fg-muted"
                    >
                     <span className="font-medium text-fg-faint">
                      {code || t('amount')} ({bucket.count})
                     </span>
                     <span className="font-semibold text-fg">{bucket.total.toLocaleString(numLocale, { maximumFractionDigits: ledgerDecimals })}</span>
                    </span>
                   ))}
                   <span className="text-xs text-fg-muted">
                    {(currentLedgerPage - 1) * ledgerPageSize + 1}–{Math.min(currentLedgerPage * ledgerPageSize, visibleCount)} {t('pagination_of')} {visibleCount}
                   </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                   <span className="text-xs text-fg-faint">{t('pagination_per_page')}</span>
                   <select
                    value={ledgerPageSize}
                    onChange={(event) => {
                     const nextSize = Number(event.target.value);
                     setLedgerPageSize(nextSize);
                     if (typeof window !== 'undefined') window.localStorage.setItem('arkam:ledger-page-size', String(nextSize));
                     setLedgerPageState((prev) => ({ ...prev, [ledger.accountId]: 99999 }));
                    }}
                    className="rounded border border-border-strong px-1.5 py-1 text-xs outline-none ring-blue-300 focus:ring"
                   >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                   </select>
                   {totalLedgerPages > 1 && (
                    <>
                     <button
                      type="button"
                      onClick={() => setLedgerPageState((prev) => ({ ...prev, [ledger.accountId]: Math.max(1, currentLedgerPage - 1) }))}
                      disabled={currentLedgerPage <= 1}
                      className="rounded border border-border-strong px-2 py-1 text-xs font-semibold text-fg-muted transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                     >
                      {t('pagination_prev')}
                     </button>
                     <input
                      key={`bot-${currentLedgerPage}`}
                      type="number"
                      min={1}
                      max={totalLedgerPages}
                      defaultValue={currentLedgerPage}
                      onBlur={(event) => {
                       const n = parseInt(event.target.value, 10);
                       if (n >= 1 && n <= totalLedgerPages) setLedgerPageState((prev) => ({ ...prev, [ledger.accountId]: n }));
                       else event.target.value = String(currentLedgerPage);
                      }}
                      onKeyDown={(event) => {
                       if (event.key === 'Enter') event.currentTarget.blur();
                      }}
                      className="w-14 rounded border border-border-strong px-1.5 py-1 text-center text-xs outline-none ring-blue-300 focus:ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                     />
                     <span className="text-xs text-fg-faint">/ {totalLedgerPages}</span>
                     <button
                      type="button"
                      onClick={() => setLedgerPageState((prev) => ({ ...prev, [ledger.accountId]: Math.min(totalLedgerPages, currentLedgerPage + 1) }))}
                      disabled={currentLedgerPage >= totalLedgerPages}
                      className="rounded border border-border-strong px-2 py-1 text-xs font-semibold text-fg-muted transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                     >
                      {t('pagination_next')}
                     </button>
                    </>
                   )}
                  </div>
                 </div>
                );
               })()}
              </>
             )}
            </div>
           ))
         )}
        </section>
   <ContextMenu menu={rowContextMenu.menu} onClose={closeRowMenu} zoom={tableZoom} />
   {editingLedgerRowKeys.size > 0 && typeof document !== 'undefined' ? createPortal(
    <div className={`fixed bottom-6 z-30 flex flex-col gap-3 sm:hidden ${isRTL ? 'left-6' : 'right-6'}`}>
     <button
      type="button"
      title={t('save_changes')}
      onClick={() => void onSaveAllEditingLedgerRows()}
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
      onClick={() => onCancelAllEditingLedgerRows()}
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
  </>
 );
}
