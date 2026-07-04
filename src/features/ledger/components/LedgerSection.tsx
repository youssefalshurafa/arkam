'use client';

import { Fragment, useRef, useState } from 'react';
import type { Dispatch, DragEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode, SetStateAction } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { accountingApi } from '@/lib/accountingApi';
import { panelClassName, tableWrapClassName } from '@/shared/styles';
import { SkBar, SkTablePanel, SK_LEDGER } from '@/shared/components/skeletons/Skeletons';
import { getStoredPdfCols, getStoredPdfDateRange } from '@/shared/lib/localStorage';
import { formatAmountInput, normalizeDecimalInput } from '@/shared/utils/decimal';
import { formatRateValue, ledgerFieldWidth, ledgerSelectWidth, HIGHLIGHT_PEN_CURSOR } from '@/shared/utils/format';
import { formatDateValue } from '@/shared/utils/date';
import { getCommissionAmount } from '@/shared/utils/commission';
import { getLedgerTransactionDraftKey } from '@/features/ledger/utils/ledgerEntries';
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

type LedgerSelectionSummary = {
 count: number;
 amountSum: number;
 netChangeSum: number;
 amountCurrencyCode: string;
 netCurrencyCode: string;
};

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
 selectedLedgerSummary: LedgerSelectionSummary | null;
 orderedLedgerColumnOptions: Array<{ key: LedgerColumnKey; label: string }>;
 ledgerHistory: DraftHistory;
 getClientLedgerDraft: (transactionId: number, ledgerAccountId: number) => LedgerTransactionDraft | null;
 updateLedgerTransactionDraft: (transactionId: number, ledgerAccountId: number, nextValues: Partial<LedgerTransactionDraft>) => void;
 renderLedgerCurrencySuffix: (currencySymbol: string, currencyCode: string) => ReactNode;
 setSection: Dispatch<SetStateAction<Section>>;
 setClientAccounts: Dispatch<SetStateAction<ClientAccount[]>>;
 setLedgerRowClickMode: (highlight: boolean) => void;
 toggleLedgerRowHighlight: (rowKey: string) => void;
 onCancelAllLedger: (ledger: ClientAccountLedger) => void;
 onDeleteLedgerEntry: (entry: ClientLedgerEntry, ledgerAccountId: number) => void;
 onDeleteSelectedLedgerEntries: () => void;
 onEditAllLedger: (ledger: ClientAccountLedger) => void;
 onLedgerColumnDragStart: (event: DragEvent<HTMLElement>, column: LedgerColumnKey) => void;
 onLedgerColumnDrop: (targetColumn: LedgerColumnKey) => void;
 onLedgerEditFieldArrowKey: (event: ReactKeyboardEvent<HTMLInputElement>, field: 'amount' | 'exchangeRate' | 'commission', entry: ClientLedgerEntry, ledgerAccountId: number, pagedEntries: ClientLedgerEntry[], entryIdx: number) => void;
 onLedgerRowDrop: (draggedKeys: string[], targetKey: string, dropHalf: 'top' | 'bottom', accountId: number) => void;
 onSaveAllLedger: (ledger: ClientAccountLedger) => void;
 onSaveLedgerRow: (transactionId: number, ledgerAccountId: number) => void;
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
  selectedLedgerAccountId, setSelectedLedgerAccountId, selectedOrganizationForClients, selectedClientLedgers, selectedLedgerSummary,
  orderedLedgerColumnOptions, ledgerHistory, getClientLedgerDraft, updateLedgerTransactionDraft, renderLedgerCurrencySuffix,
  onCancelAllLedger, onDeleteLedgerEntry, onDeleteSelectedLedgerEntries, onEditAllLedger, onLedgerColumnDragStart,
  onLedgerColumnDrop, onLedgerEditFieldArrowKey, onLedgerRowDrop, onSaveAllLedger, onSaveLedgerRow, onToggleLedgerEntrySelection,
  openAdjustmentModal, openClientLedger, openLedgerRowForEdit, openOrganizationClientsPage, navigateToSection, loadData,
  setSection, setClientAccounts, setLedgerRowClickMode, toggleLedgerRowHighlight,
 } = props;
 const router = useRouter();
 const { language, isRTL } = useLanguage();
 const { t } = useTranslation(language);
 const numLocale = language === 'fr' ? 'fr-FR' : language;
 const showToast = useAppStatusStore((s) => s.showToast);
 const setError = useAppStatusStore((s) => s.setError);
 const dragLedgerFromHandle = useRef(false);
 const { clientLedgerBackSection, editingLedgerRowKeys, setEditingLedgerRowKeys, editAllLedgerAccountIds, selectedLedgerEntryKeys, setSelectedLedgerEntryKeys, ledgerSumMode, setLedgerSumMode, ledgerSumSelection, setLedgerSumSelection, setShowLedgerSettingsModal, ledgerFilterOpen, setLedgerFilterOpen, ledgerFilterSearch, setLedgerFilterSearch, ledgerFilterCounterparty, setLedgerFilterCounterparty, ledgerFilterDateFrom, setLedgerFilterDateFrom, ledgerFilterDateTo, setLedgerFilterDateTo, ledgerDecimals, ledgerDateFormat, ledgerHighlightNetChange, ledgerNetChangeHighlightColor, ledgerRowClickHighlight, highlightedLedgerRows, ledgerStartingBalanceDrafts, setLedgerStartingBalanceDrafts, editingStartingBalanceIds, setEditingStartingBalanceIds, ledgerPageState, setLedgerPageState, ledgerPageSize, setLedgerPageSize, ledgerExpensesExpandedKeys, setLedgerExpensesExpandedKeys, draggedLedgerColumn, setDraggedLedgerColumn, dragLedgerRowKey, setDragLedgerRowKey, dragOverLedgerRowKey, setDragOverLedgerRowKey, dragOverLedgerHalf, setDragOverLedgerHalf, ledgerColumnVisibility, ledgerTransactionDrafts, setLedgerTransactionDrafts, setPdfExportModal, ledgerCounterpartyOpen, setLedgerCounterpartyOpen, ledgerCounterpartyQuery, setLedgerCounterpartyQuery, ledgerCounterpartyExpandedClient, setLedgerCounterpartyExpandedClient, ledgerRateReversed, setLedgerRateReversed, ledgerDisplayRateReversed, setLedgerDisplayRateReversed } = useLedgerStore();

 // Tracks which account's "entries awaiting an exchange rate" note has been expanded to list
 // the specific pending entries. Ephemeral UI state — no need to persist across sessions.
 const [pendingEntriesOpenAccountIds, setPendingEntriesOpenAccountIds] = useState<Set<number>>(new Set());
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
   if (on) setLedgerSumSelection(new Map());
   return !on;
  });
 };
 // Add the clicked amount to the running total, or remove it if it was already added.
 const toggleLedgerSumEntry = (key: string, amount: number, currencyCode: string) => {
  setLedgerSumSelection((prev) => {
   const next = new Map(prev);
   if (next.has(key)) next.delete(key);
   else next.set(key, { amount, currencyCode });
   return next;
  });
 };
 // Grouped by currency so mixing e.g. USD and EUR clicks shows one total box per currency
 // instead of adding incompatible currencies together.
 const ledgerSumByCurrency = new Map<string, { total: number; count: number }>();
 for (const entry of ledgerSumSelection.values()) {
  const code = entry.currencyCode || '';
  const bucket = ledgerSumByCurrency.get(code) ?? { total: 0, count: 0 };
  bucket.total += entry.amount;
  bucket.count += 1;
  ledgerSumByCurrency.set(code, bucket);
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
             className="rounded border border-slate-200 bg-slate-50 px-4 py-3 flex flex-col gap-2"
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
        <section className="flex flex-col gap-6">
         <div className={panelClassName}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
           <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">{t('client_page_title')}</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">{selectedClientForLedger?.name ?? t('clients_title')}</h2>
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
                className="mt-1 cursor-pointer text-sm text-slate-500 transition hover:text-blue-600 hover:underline"
               >
                {org.name}
               </a>
              ) : null;
             })()}
            <p className="mt-2 text-sm text-slate-600">{selectedClientForLedger ? t('client_page_description') : t('client_page_no_client')}</p>
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
            className="cursor-pointer rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
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
               selectedLedgerAccountId === ledger.accountId ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
             >
              {ledger.currencyName}
             </button>
            ))}
           </div>
          ) : null}
          {selectedClientForLedger && (
           <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4">
            <>
             {selectedLedgerEntryKeys.size > 0 ? (
              <button
               type="button"
               onClick={() => void onDeleteSelectedLedgerEntries()}
               className="cursor-pointer rounded border border-red-500 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100"
              >
               {t('delete')} ({selectedLedgerEntryKeys.size})
              </button>
             ) : null}
             {selectedLedgerSummary ? (
              <>
               <span className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                <span className="font-medium text-slate-500">{t('amount')}</span>
                <span className="font-semibold text-slate-800">
                 {selectedLedgerSummary.amountSum.toLocaleString(numLocale, { maximumFractionDigits: ledgerDecimals })}
                 {selectedLedgerSummary.amountCurrencyCode ? ` ${selectedLedgerSummary.amountCurrencyCode}` : ''}
                </span>
               </span>
               <span className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                <span className="font-medium text-slate-500">{t('net_change')}</span>
                <span className={`font-semibold ${selectedLedgerSummary.netChangeSum >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                 {selectedLedgerSummary.netChangeSum.toLocaleString(numLocale, { maximumFractionDigits: ledgerDecimals })}
                 {selectedLedgerSummary.netCurrencyCode ? ` ${selectedLedgerSummary.netCurrencyCode}` : ''}
                </span>
               </span>
              </>
             ) : null}
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
              className="cursor-pointer rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
             >
              {t('export_pdf')}
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
              className="cursor-pointer rounded border border-purple-500 bg-purple-50 px-4 py-2 text-sm font-semibold text-purple-700 transition hover:bg-purple-100"
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
                className="cursor-pointer rounded border border-slate-300 px-2 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
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
                className="cursor-pointer rounded border border-slate-300 px-2 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
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
              className="cursor-pointer rounded border border-slate-300 px-2 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
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
          <div className={`${panelClassName} text-sm text-slate-600`}>{t('client_page_no_client')}</div>
         ) : selectedClientLedgers.length === 0 ? (
          <div className={`${panelClassName} text-sm text-slate-600`}>{t('no_client_accounts')}</div>
         ) : (
          selectedClientLedgers
           .filter((ledger) => selectedClientLedgers.length === 1 || ledger.accountId === selectedLedgerAccountId)
           .map((ledger) => (
            <div
             key={ledger.accountId}
             className={panelClassName}
            >
             <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
               <p className="text-sm font-medium text-slate-500">{selectedClientForLedger?.name}</p>
               <h3 className="text-xl font-semibold text-slate-900">{ledger.currencyName}</h3>
               <p className="mt-1 text-sm text-slate-600">{t('client_page_account_summary')}</p>
               <div className="mt-2 flex items-center gap-1.5">
                <span className="text-xs text-slate-400">{t('starting_balance')}:</span>
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
                  className="w-32 rounded border border-slate-300 px-2 py-0.5 text-xs outline-none ring-blue-300 focus:ring"
                 />
                ) : (
                 <>
                  <span className="text-xs font-medium text-slate-600">
                   {(ledgerStartingBalanceDrafts[ledger.accountId] !== undefined
                    ? parseFloat(normalizeDecimalInput(ledgerStartingBalanceDrafts[ledger.accountId])) || 0
                    : ledger.startingBalance
                   ).toLocaleString(numLocale, { maximumFractionDigits: ledgerDecimals })}
                  </span>
                  <button
                   type="button"
                   onClick={() => setEditingStartingBalanceIds((prev) => new Set([...prev, ledger.accountId]))}
                   title={t('edit')}
                   className="text-slate-400 transition hover:text-slate-700"
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
               <div className="rounded border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('client_page_current_balance')}</p>
                <p className={`mt-2 text-xl font-bold ${ledger.currentBalance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
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
                    className="mt-1.5 flex cursor-pointer items-center gap-1 text-xs font-medium text-amber-600 hover:underline"
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
                    <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto rounded border border-amber-200 bg-amber-50 p-2 text-xs text-slate-700">
                     {pendingEntries.map((entry) => (
                      <li
                       key={`${entry.transactionId}-${entry.direction}`}
                       className="flex items-center justify-between gap-2 whitespace-nowrap"
                      >
                       <span className="text-slate-500">{formatDateValue(entry.createdAt, ledgerDateFormat)}</span>
                       <span className="truncate font-medium">{entry.counterpartyName}</span>
                       <span>
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
               <div className="rounded border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('client_page_transaction_count')}</p>
                <p className="mt-2 text-xl font-bold text-slate-900">{ledger.transactionCount}</p>
               </div>
              </div>
             </div>

             {ledger.entries.length === 0 ? (
              <p className="mt-5 text-sm text-slate-500">{t('client_page_no_transactions')}</p>
             ) : (
              <>
               {/* Filter bar */}
               {(() => {
                const counterpartyOptions = [...new Set(ledger.entries.map((e) => e.counterpartyName).filter(Boolean))].sort((a, b) => a.localeCompare(b, language));
                const hasFilter = !!(ledgerFilterSearch || ledgerFilterCounterparty || ledgerFilterDateFrom || ledgerFilterDateTo);
                const activeCount = [ledgerFilterSearch, ledgerFilterCounterparty, ledgerFilterDateFrom, ledgerFilterDateTo].filter(Boolean).length;
                return (
                 <div className="mt-4 rounded border border-slate-200 bg-slate-50">
                  <button
                   type="button"
                   onClick={() => setLedgerFilterOpen((o) => !o)}
                   className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
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
                   <div className="flex flex-wrap items-end gap-2 border-t border-slate-200 px-3 py-3">
                    <div className="flex min-w-36 flex-1 flex-col gap-1">
                     <label className="text-xs font-medium text-slate-500">{t('tx_filter_search')}</label>
                     <div className="relative">
                      <input
                       type="text"
                       value={ledgerFilterSearch}
                       onChange={(e) => setLedgerFilterSearch(e.target.value)}
                       placeholder={t('tx_filter_search_placeholder')}
                       className={`w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none ring-blue-300 focus:ring ${isRTL ? 'pl-7' : 'pr-7'}`}
                      />
                      {ledgerFilterSearch ? (
                       <button
                        type="button"
                        onClick={() => setLedgerFilterSearch('')}
                        title={t('clear_selection')}
                        aria-label={t('clear_selection')}
                        className={`absolute inset-y-0 my-auto flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 ${isRTL ? 'left-1.5' : 'right-1.5'}`}
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
                    {counterpartyOptions.length > 0 && (
                     <div className="flex min-w-36 flex-1 flex-col gap-1">
                      <label className="text-xs font-medium text-slate-500">{t('counterparty')}</label>
                      <select
                       value={ledgerFilterCounterparty}
                       onChange={(e) => setLedgerFilterCounterparty(e.target.value)}
                       className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none ring-blue-300 focus:ring"
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
                     <label className="text-xs font-medium text-slate-500">{t('tx_filter_date_from')}</label>
                     <input
                      type="date"
                      value={ledgerFilterDateFrom}
                      onChange={(e) => setLedgerFilterDateFrom(e.target.value)}
                      className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none ring-blue-300 focus:ring"
                     />
                    </div>
                    <div className="flex flex-col gap-1">
                     <label className="text-xs font-medium text-slate-500">{t('tx_filter_date_to')}</label>
                     <input
                      type="date"
                      value={ledgerFilterDateTo}
                      onChange={(e) => setLedgerFilterDateTo(e.target.value)}
                      className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none ring-blue-300 focus:ring"
                     />
                    </div>
                    {hasFilter && (
                     <button
                      type="button"
                      onClick={() => {
                       setLedgerFilterSearch('');
                       setLedgerFilterCounterparty('');
                       setLedgerFilterDateFrom('');
                       setLedgerFilterDateTo('');
                      }}
                      className="self-end rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100"
                     >
                      {t('tx_filter_clear')}
                     </button>
                    )}
                   </div>
                  )}
                 </div>
                );
               })()}

               {/* Row-click mode: highlight rows, click cells to copy their value, or sum clicked amounts. */}
               <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <button
                 type="button"
                 title={t('ledger_click_highlight_mode')}
                 onClick={() => setLedgerRowClickMode(true)}
                 aria-pressed={ledgerRowClickHighlight}
                 className={`cursor-pointer rounded border px-2 py-1.5 text-sm font-semibold transition ${
                  ledgerRowClickHighlight ? 'border-amber-400 bg-amber-50 text-amber-600 hover:bg-amber-100' : 'border-slate-300 text-slate-500 hover:bg-slate-50'
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
                 onClick={() => setLedgerRowClickMode(false)}
                 aria-pressed={!ledgerRowClickHighlight}
                 className={`cursor-pointer rounded border px-2 py-1.5 text-sm font-semibold transition ${
                  !ledgerRowClickHighlight ? 'border-blue-400 bg-blue-50 text-blue-600 hover:bg-blue-100' : 'border-slate-300 text-slate-500 hover:bg-slate-50'
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
                  ledgerSumMode ? 'border-purple-400 bg-purple-50 text-purple-600 hover:bg-purple-100' : 'border-slate-300 text-slate-500 hover:bg-slate-50'
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
                {[...ledgerSumByCurrency.entries()].map(([code, bucket]) => (
                 <span
                  key={code || 'none'}
                  className="inline-flex items-center gap-1.5 rounded border border-purple-300 bg-purple-50 px-3 py-1.5 text-sm text-slate-600"
                 >
                  <span className="font-medium text-slate-500">
                   {code || t('amount')} ({bucket.count})
                  </span>
                  <span className="font-semibold text-slate-800">{bucket.total.toLocaleString(numLocale, { maximumFractionDigits: ledgerDecimals })}</span>
                 </span>
                ))}
               </div>

               {(() => {
                const ordered = ledger.entries;
                const q = ledgerFilterSearch.trim().toLowerCase();
                const visibleCount = ordered.filter((e) => {
                 if (ledgerFilterDateFrom && e.createdAt.slice(0, 10) < ledgerFilterDateFrom) return false;
                 if (ledgerFilterDateTo && e.createdAt.slice(0, 10) > ledgerFilterDateTo) return false;
                 if (ledgerFilterCounterparty && e.counterpartyName !== ledgerFilterCounterparty) return false;
                 if (q && !e.counterpartyName.toLowerCase().includes(q) && !(e.description ?? '').toLowerCase().includes(q) && !String(e.amount).includes(q)) return false;
                 return true;
                }).length;
                if (visibleCount === 0) return null;
                const totalLedgerPages = Math.max(1, Math.ceil(visibleCount / ledgerPageSize));
                const currentLedgerPage = Math.max(1, Math.min(ledgerPageState[ledger.accountId] ?? 99999, totalLedgerPages));
                if (totalLedgerPages <= 1) return null;
                return (
                 <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-slate-600">
                   {(currentLedgerPage - 1) * ledgerPageSize + 1}–{Math.min(currentLedgerPage * ledgerPageSize, visibleCount)} {t('pagination_of')} {visibleCount}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                   <button
                    type="button"
                    onClick={() => setLedgerPageState((prev) => ({ ...prev, [ledger.accountId]: Math.max(1, currentLedgerPage - 1) }))}
                    disabled={currentLedgerPage <= 1}
                    className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
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
                    className="w-14 rounded border border-slate-300 px-1.5 py-1 text-center text-xs outline-none ring-blue-300 focus:ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                   />
                   <span className="text-xs text-slate-500">/ {totalLedgerPages}</span>
                   <button
                    type="button"
                    onClick={() => setLedgerPageState((prev) => ({ ...prev, [ledger.accountId]: Math.min(totalLedgerPages, currentLedgerPage + 1) }))}
                    disabled={currentLedgerPage >= totalLedgerPages}
                    className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                   >
                    {t('pagination_next')}
                   </button>
                  </div>
                 </div>
                );
               })()}
               <div
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
                <table className="w-full text-sm">
                 <thead className="sticky top-0 z-20 bg-slate-100 text-slate-700">
                  <tr>
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
                   <th className="w-10 px-2 py-3">
                    {editAllLedgerAccountIds.has(ledger.accountId) ? (
                     <div className="flex flex-col items-center gap-1">
                      <button
                       type="button"
                       title={t('save_changes')}
                       onClick={() => void onSaveAllLedger(ledger)}
                       className="rounded p-1 text-emerald-600 hover:bg-emerald-50"
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
                       className="rounded p-1 text-slate-400 hover:bg-slate-100"
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
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-blue-600"
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
                       className={`shrink-0 text-slate-400 ${draggedLedgerColumn === column.key ? 'opacity-50' : 'opacity-70'}`}
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
                        draggable
                        onDragStart={(event) => onLedgerColumnDragStart(event, column.key)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => onLedgerColumnDrop(column.key)}
                        onDragEnd={() => setDraggedLedgerColumn(null)}
                        className={headerClassName}
                       >
                        {headerContent}
                       </th>
                      );
                     case 'counterparty':
                      return (
                       <th
                        key={column.key}
                        draggable
                        onDragStart={(event) => onLedgerColumnDragStart(event, column.key)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => onLedgerColumnDrop(column.key)}
                        onDragEnd={() => setDraggedLedgerColumn(null)}
                        className={headerClassName}
                       >
                        {headerContent}
                       </th>
                      );
                     case 'direction':
                      return (
                       <th
                        key={column.key}
                        draggable
                        onDragStart={(event) => onLedgerColumnDragStart(event, column.key)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => onLedgerColumnDrop(column.key)}
                        onDragEnd={() => setDraggedLedgerColumn(null)}
                        className={headerClassName}
                       >
                        {headerContent}
                       </th>
                      );
                     case 'type':
                      return (
                       <th
                        key={column.key}
                        draggable
                        onDragStart={(event) => onLedgerColumnDragStart(event, column.key)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => onLedgerColumnDrop(column.key)}
                        onDragEnd={() => setDraggedLedgerColumn(null)}
                        className={headerClassName}
                       >
                        {headerContent}
                       </th>
                      );
                     case 'amount':
                      return (
                       <th
                        key={column.key}
                        draggable
                        onDragStart={(event) => onLedgerColumnDragStart(event, column.key)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => onLedgerColumnDrop(column.key)}
                        onDragEnd={() => setDraggedLedgerColumn(null)}
                        className={headerClassName}
                       >
                        {headerContent}
                       </th>
                      );
                     case 'exchangeRate':
                      return (
                       <th
                        key={column.key}
                        draggable
                        onDragStart={(event) => onLedgerColumnDragStart(event, column.key)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => onLedgerColumnDrop(column.key)}
                        onDragEnd={() => setDraggedLedgerColumn(null)}
                        className={headerClassName}
                       >
                        {headerContent}
                       </th>
                      );
                     case 'commission':
                      return (
                       <th
                        key={column.key}
                        draggable
                        onDragStart={(event) => onLedgerColumnDragStart(event, column.key)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => onLedgerColumnDrop(column.key)}
                        onDragEnd={() => setDraggedLedgerColumn(null)}
                        className={headerClassName}
                       >
                        {headerContent}
                       </th>
                      );
                     case 'netChange':
                      return (
                       <th
                        key={column.key}
                        draggable
                        onDragStart={(event) => onLedgerColumnDragStart(event, column.key)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => onLedgerColumnDrop(column.key)}
                        onDragEnd={() => setDraggedLedgerColumn(null)}
                        className={headerClassName}
                       >
                        {headerContent}
                       </th>
                      );
                     case 'runningBalance':
                      return (
                       <th
                        key={column.key}
                        draggable
                        onDragStart={(event) => onLedgerColumnDragStart(event, column.key)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => onLedgerColumnDrop(column.key)}
                        onDragEnd={() => setDraggedLedgerColumn(null)}
                        className={headerClassName}
                       >
                        {headerContent}
                       </th>
                      );
                     case 'currency':
                      return (
                       <th
                        key={column.key}
                        draggable
                        onDragStart={(event) => onLedgerColumnDragStart(event, column.key)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => onLedgerColumnDrop(column.key)}
                        onDragEnd={() => setDraggedLedgerColumn(null)}
                        className={headerClassName}
                       >
                        {headerContent}
                       </th>
                      );
                     case 'description':
                      return (
                       <th
                        key={column.key}
                        draggable
                        onDragStart={(event) => onLedgerColumnDragStart(event, column.key)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => onLedgerColumnDrop(column.key)}
                        onDragEnd={() => setDraggedLedgerColumn(null)}
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
                   const q = ledgerFilterSearch.trim().toLowerCase();
                   const visible = ordered.filter((e) => {
                    if (ledgerFilterDateFrom && e.createdAt.slice(0, 10) < ledgerFilterDateFrom) return false;
                    if (ledgerFilterDateTo && e.createdAt.slice(0, 10) > ledgerFilterDateTo) return false;
                    if (ledgerFilterCounterparty && e.counterpartyName !== ledgerFilterCounterparty) return false;
                    if (q) {
                     const inCounterparty = e.counterpartyName.toLowerCase().includes(q);
                     const inDescription = (e.description ?? '').toLowerCase().includes(q);
                     const inAmount = String(e.amount).includes(q);
                     if (!inCounterparty && !inDescription && !inAmount) return false;
                    }
                    return true;
                   });
                   // Pagination: entries sorted oldest→newest; page N = newest (last chunk).
                   const totalLedgerPages = Math.max(1, Math.ceil(visible.length / ledgerPageSize));
                   const currentLedgerPage = Math.max(1, Math.min(ledgerPageState[ledger.accountId] ?? 99999, totalLedgerPages));
                   const ledgerStart = (currentLedgerPage - 1) * ledgerPageSize;
                   const pagedEntries = visible.slice(ledgerStart, ledgerStart + ledgerPageSize);
                   return pagedEntries.map((entry, entryIdx) => (
                    <Fragment key={`${ledger.accountId}-${entry.transactionId}-${entry.direction}`}>
                     <tr
                      draggable={!editingLedgerRowKeys.has(getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId))}
                      onClick={(e) => {
                       const rowKey = getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId);
                       if (editingLedgerRowKeys.has(rowKey)) return;
                       if ((e.target as HTMLElement).closest('button, a, input, select, textarea, label')) return;
                       if (ledgerRowClickHighlight) {
                        toggleLedgerRowHighlight(rowKey);
                        return;
                       }
                       // Copy mode: copy the clicked cell's value (strip trailing currency code/symbol).
                       const td = (e.target as HTMLElement).closest('td');
                       if (!td || (td as HTMLTableCellElement).cellIndex < 2) return;
                       const raw = (td as HTMLElement).innerText.trim();
                       const text = raw.replace(/\s+([A-Z]{2,5}|[$€£¥₹₩₪₺₽฿₫])$/, '').trim() || raw;
                       if (text) navigator.clipboard.writeText(text).then(() => showToast(t('toast_copied'), e));
                      }}
                      onDragStart={(e) => {
                       if (!dragLedgerFromHandle.current) {
                        e.preventDefault();
                        return;
                       }
                       setDragLedgerRowKey(getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId));
                      }}
                      onDragEnd={() => {
                       dragLedgerFromHandle.current = false;
                       const rowKey = getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId);
                       if (dragLedgerRowKey !== null && dragOverLedgerRowKey !== null && dragLedgerRowKey !== dragOverLedgerRowKey) {
                        const keysToMove =
                         selectedLedgerEntryKeys.has(dragLedgerRowKey) && selectedLedgerEntryKeys.size > 1
                          ? [...selectedLedgerEntryKeys].filter((k) => k.endsWith(`:${ledger.accountId}`))
                          : [dragLedgerRowKey];
                        void onLedgerRowDrop(keysToMove, dragOverLedgerRowKey, dragOverLedgerHalf, ledger.accountId);
                       }
                       setDragLedgerRowKey(null);
                       setDragOverLedgerRowKey(null);
                      }}
                      onDragOver={(e) => {
                       e.preventDefault();
                       const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                       setDragOverLedgerHalf(e.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom');
                       setDragOverLedgerRowKey(getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId));
                      }}
                      onDragLeave={() => setDragOverLedgerRowKey((prev) => (prev === getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId) ? null : prev))}
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
                        ...(color ? { backgroundColor: color } : {}),
                        ...(isEditing ? {} : ledgerRowClickHighlight ? { cursor: HIGHLIGHT_PEN_CURSOR } : { cursor: 'copy' }),
                       };
                      })()}
                      className={`border-t border-slate-200 align-top transition-colors ${entryIdx % 2 === 1 ? 'bg-slate-50' : 'bg-white'} hover:bg-slate-100 ${dragLedgerRowKey !== null && ((selectedLedgerEntryKeys.has(dragLedgerRowKey) && selectedLedgerEntryKeys.has(getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId))) || dragLedgerRowKey === getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId)) ? 'opacity-40' : ''} ${dragOverLedgerRowKey === getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId) && dragOverLedgerHalf === 'top' ? 'border-t-2 border-t-blue-500' : ''} ${dragOverLedgerRowKey === getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId) && dragOverLedgerHalf === 'bottom' ? 'border-b-2 border-b-blue-500' : ''}`}
                     >
                      {(() => {
                       const rowKey = getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId);
                       const isEditingRow = editingLedgerRowKeys.has(rowKey);
                       const isRowHighlighted = highlightedLedgerRows.has(rowKey);
                       const draft = isEditingRow ? getClientLedgerDraft(entry.transactionId, ledger.accountId) : null;

                       return (
                        <>
                         {/* checkbox */}
                         <td className="px-2 py-3 align-middle w-8">
                          <input
                           type="checkbox"
                           checked={selectedLedgerEntryKeys.has(rowKey)}
                           onChange={() => onToggleLedgerEntrySelection(rowKey)}
                           className="cursor-pointer"
                          />
                         </td>
                         {/* actions */}
                         <td className="px-2 py-3 align-top w-10">
                          {isEditingRow ? (
                           <div className="flex flex-col items-center gap-1">
                            <button
                             type="button"
                             title={t('save_changes')}
                             onClick={() => void onSaveLedgerRow(entry.transactionId, ledger.accountId)}
                             className="rounded p-1 text-emerald-600 hover:bg-emerald-50"
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
                             className="rounded p-1 text-slate-400 hover:bg-slate-100"
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
                             onClick={() => void onDeleteLedgerEntry(entry, ledger.accountId)}
                             className="rounded p-1 text-red-500 hover:bg-red-50"
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
                           </div>
                          ) : (
                           <div className="flex items-center gap-0.5">
                            <span
                             className="cursor-grab text-slate-300 hover:text-slate-500 active:cursor-grabbing"
                             title="Drag to reorder"
                             onMouseDown={() => {
                              dragLedgerFromHandle.current = true;
                             }}
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
                             title={t('edit')}
                             onClick={() => openLedgerRowForEdit(entry, ledger.accountId)}
                             className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-blue-600"
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
                              <path d="M12 20h9" />
                              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                             </svg>
                            </button>
                           </div>
                          )}
                         </td>
                         {orderedLedgerColumnOptions.map((column) => {
                          if (!ledgerColumnVisibility[column.key]) {
                           return null;
                          }

                          switch (column.key) {
                           case 'created':
                            return (
                             <td
                              key={column.key}
                              className="px-4 py-3 text-slate-500"
                             >
                              {draft ? (
                               <input
                                type="date"
                                value={draft.createdDate}
                                onChange={(event) => updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { createdDate: event.target.value })}
                                style={{ width: '8.5rem' }}
                                className="rounded border border-slate-300 px-2 py-1.5 text-xs outline-none ring-blue-300 focus:ring"
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
                              className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap"
                             >
                              {entry.isAdjustment ? (
                               <span className="text-slate-400">-</span>
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
                                    className="rounded border border-slate-300 py-1.5 pe-6 ps-2 text-xs outline-none ring-blue-300 focus:ring"
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
                                     className="absolute inset-y-0 end-1 my-auto flex h-4 w-4 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
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
                                    <ul className="absolute z-30 mt-1 max-h-48 w-52 overflow-y-auto rounded border border-slate-200 bg-white text-xs shadow-lg">
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
                                       return <li className="px-3 py-2 text-slate-400">{t('transaction_account_placeholder')}</li>;
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
                                          className={`cursor-pointer px-3 py-1.5 hover:bg-blue-50 ${draft.counterpartyAccountId === account.id ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-800'}`}
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
                                          className={`flex cursor-pointer items-center justify-between px-3 py-1.5 hover:bg-blue-50 ${hasSelected ? 'font-medium text-blue-700' : 'text-slate-800'}`}
                                         >
                                          <span>{accts[0].clientName}</span>
                                          <span className="flex items-center gap-1 text-slate-400">
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
                                            className={`cursor-pointer py-1.5 ps-7 pe-3 hover:bg-blue-50 ${draft.counterpartyAccountId === account.id ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-600'}`}
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
                                   className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-blue-600"
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
                                className="cursor-pointer font-medium text-blue-700 underline decoration-blue-300 underline-offset-2 transition hover:text-blue-900"
                               >
                                {entry.counterpartyName}
                               </a>
                              ) : (
                               entry.counterpartyName
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
                                  draft.adjustmentDirection === 'debit' ? 'border-red-500 bg-red-50 text-red-700' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                                 }`}
                                >
                                 {t('adjustment_direction_debit_short')}
                                </button>
                                <button
                                 type="button"
                                 onClick={() => updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { adjustmentDirection: 'credit' })}
                                 className={`rounded border px-2 py-1 text-xs font-semibold transition ${
                                  draft.adjustmentDirection === 'credit'
                                   ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                                   : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                                 }`}
                                >
                                 {t('adjustment_direction_credit_short')}
                                </button>
                               </div>
                              ) : entry.isAdjustment ? (
                               <span
                                className={`inline-flex rounded px-2.5 py-1 text-xs font-semibold ${entry.direction === 'outgoing' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}
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
                                className="rounded border border-slate-300 px-2 py-1.5 text-xs outline-none ring-blue-300 focus:ring"
                               >
                                <option value="incoming">{t('incoming')}</option>
                                <option value="outgoing">{t('outgoing')}</option>
                               </select>
                              ) : (
                               <span
                                className={`inline-flex rounded px-2.5 py-1 text-xs font-semibold ${entry.direction === 'incoming' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}
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
                              className="px-4 py-3 text-slate-600"
                             >
                              {entry.isAdjustment ? (
                               <span className="inline-flex rounded bg-purple-100 px-2.5 py-1 text-xs font-semibold text-purple-700">{t('adjustment_label')}</span>
                              ) : draft ? (
                               <select
                                value={draft.type}
                                onChange={(event) => updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { type: event.target.value })}
                                style={{ width: ledgerSelectWidth(draft.type === 'transfer' ? t('transaction_type_transfer') : t('transaction_type_exchange'), 7, 2) }}
                                className="rounded border border-slate-300 px-2 py-1.5 text-xs outline-none ring-blue-300 focus:ring"
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
                            return (
                             <td
                              key={column.key}
                              className={`whitespace-nowrap px-4 py-3 font-semibold ${(draft?.direction ?? entry.direction) === 'outgoing' ? 'text-emerald-600' : 'text-red-600'}`}
                             >
                              {draft ? (
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
                                className="rounded border border-slate-300 px-2 py-1.5 text-xs outline-none ring-blue-300 focus:ring"
                               />
                              ) : ledgerSumMode ? (
                               (() => {
                                const sumKey = `${rowKey}:amount`;
                                const inSum = ledgerSumSelection.has(sumKey);
                                return (
                                 <button
                                  type="button"
                                  onClick={() => toggleLedgerSumEntry(sumKey, entry.amount, entry.currencyCode)}
                                  className={`cursor-pointer rounded px-1.5 py-0.5 transition ${inSum ? 'bg-purple-200 ring-1 ring-purple-400' : 'hover:bg-purple-50'}`}
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
                             </td>
                            );
                           case 'exchangeRate':
                            return (
                             <td
                              key={column.key}
                              className="px-4 py-3 text-slate-600"
                             >
                              {draft
                               ? (() => {
                                  const ledgerRateKey = `${entry.transactionId}:${ledger.accountId}`;
                                  const isLedgerRateReversed = ledgerRateReversed[ledgerRateKey] ?? false;
                                  const txCurr = entry.currencyCode;
                                  const accCurr = ledger.currencyCode;
                                  // Adjustment with same currency as account: no rate needed
                                  if (entry.isAdjustment && txCurr === accCurr) {
                                   return <span className="text-slate-400">-</span>;
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
                                      updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { exchangeRate: normalizeDecimalInput(event.target.value) })
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
                                      const q = ledgerFilterSearch.trim().toLowerCase();
                                      const visible = ordered.filter((e) => {
                                       if (ledgerFilterDateFrom && e.createdAt.slice(0, 10) < ledgerFilterDateFrom) return false;
                                       if (ledgerFilterDateTo && e.createdAt.slice(0, 10) > ledgerFilterDateTo) return false;
                                       if (ledgerFilterCounterparty && e.counterpartyName !== ledgerFilterCounterparty) return false;
                                       if (q) {
                                        const inCounterparty = e.counterpartyName.toLowerCase().includes(q);
                                        const inDescription = (e.description ?? '').toLowerCase().includes(q);
                                        const inAmount = String(e.amount).includes(q);
                                        if (!inCounterparty && !inDescription && !inAmount) return false;
                                       }
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
                                     className="rounded border border-slate-300 px-2 py-1.5 text-xs outline-none ring-blue-300 focus:ring"
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
                                      className="shrink-0 rounded p-0.5 text-slate-400 hover:text-slate-700"
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
                                     className="text-amber-500"
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
                                     className="rounded p-0.5 text-slate-400 hover:text-slate-700"
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
                                 })()}
                             </td>
                            );
                           case 'commission':
                            return (
                             <td
                              key={column.key}
                              className="px-4 py-3 text-slate-600"
                             >
                              {draft && entry.isAdjustment ? (
                               <span className="text-slate-400">-</span>
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
                                    updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { commission: normalizeDecimalInput(event.target.value) })
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
                                    const q = ledgerFilterSearch.trim().toLowerCase();
                                    const visible = ordered.filter((e) => {
                                     if (ledgerFilterDateFrom && e.createdAt.slice(0, 10) < ledgerFilterDateFrom) return false;
                                     if (ledgerFilterDateTo && e.createdAt.slice(0, 10) > ledgerFilterDateTo) return false;
                                     if (ledgerFilterCounterparty && e.counterpartyName !== ledgerFilterCounterparty) return false;
                                     if (q) {
                                      const inCounterparty = e.counterpartyName.toLowerCase().includes(q);
                                      const inDescription = (e.description ?? '').toLowerCase().includes(q);
                                      const inAmount = String(e.amount).includes(q);
                                      if (!inCounterparty && !inDescription && !inAmount) return false;
                                     }
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
                                   className={`rounded border border-slate-300 px-2 py-1.5 text-xs outline-none ring-blue-300 focus:ring ${commVal > 0 ? 'text-emerald-600 font-semibold' : commVal < 0 ? 'text-red-600 font-semibold' : ''}`}
                                   placeholder="0"
                                  />
                                  <button
                                   type="button"
                                   title={commVal < 0 ? t('commission_from_him') : t('commission_for_him')}
                                   onClick={() => {
                                    const v = parseFloat(draft.commission) || 0;
                                    if (v !== 0) updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { commission: String(-v) });
                                   }}
                                   className="shrink-0 rounded p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
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
                               <span className={entry.commission < 0 ? 'font-semibold text-red-600' : 'font-semibold text-emerald-600'}>
                                {entry.commission.toLocaleString(numLocale, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}%
                               </span>
                              ) : (
                               <span className="text-slate-400">-</span>
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
                             const showCharges = !draft && !entry.isAdjustment && entry.charges > 0 && entry.chargeAffectsThisAccount;
                             return (
                              <td
                               key={column.key}
                               style={highlightNet ? { backgroundColor: ledgerNetChangeHighlightColor } : undefined}
                               className={`px-4 py-3 font-semibold ${isPending ? 'text-amber-500' : liveNetChange >= 0 ? 'text-emerald-600' : 'text-red-600'}`}
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
                                    onClick={() => toggleLedgerSumEntry(sumKey, liveNetChange, ledger.currencyCode)}
                                    className={`cursor-pointer whitespace-nowrap rounded px-1.5 py-0.5 transition ${inSum ? 'bg-purple-200 ring-1 ring-purple-400' : 'hover:bg-purple-50'}`}
                                   >
                                    {liveNetChange.toLocaleString(numLocale, { maximumFractionDigits: ledgerDecimals })}
                                    {renderLedgerCurrencySuffix(ledger.currencySymbol, ledger.currencyCode)}
                                   </button>
                                   {showCharges && (
                                    <div className={`mt-0.5 flex items-center gap-1 text-xs font-semibold ${entry.isChargesPayerThisAccount ? 'text-red-500' : 'text-emerald-500'}`}>
                                     <span>
                                      {entry.isChargesPayerThisAccount ? '−' : '+'}
                                      {entry.charges.toLocaleString(numLocale, { maximumFractionDigits: ledgerDecimals })}
                                     </span>
                                     {entry.chargesDescription && <span className="font-normal italic text-slate-400">{entry.chargesDescription}</span>}
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
                                  <div className={`mt-0.5 flex items-center gap-1 text-xs font-semibold ${entry.isChargesPayerThisAccount ? 'text-red-500' : 'text-emerald-500'}`}>
                                   <span>
                                    {entry.isChargesPayerThisAccount ? '−' : '+'}
                                    {entry.charges.toLocaleString(numLocale, { maximumFractionDigits: ledgerDecimals })}
                                   </span>
                                   {entry.chargesDescription && <span className="font-normal italic text-slate-400">{entry.chargesDescription}</span>}
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
                              className={`whitespace-nowrap px-4 py-3 font-semibold ${entry.runningBalance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}
                             >
                              {entry.runningBalance.toLocaleString(numLocale, { maximumFractionDigits: ledgerDecimals })}
                              {renderLedgerCurrencySuffix(ledger.currencySymbol, ledger.currencyCode)}
                             </td>
                            );
                           case 'currency':
                            return (
                             <td
                              key={column.key}
                              className="px-4 py-3 text-slate-500 whitespace-nowrap"
                             >
                              {draft ? (
                               <select
                                value={draft.currencyId ?? ''}
                                onChange={(event) =>
                                 updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { currencyId: event.target.value ? Number(event.target.value) : null })
                                }
                                style={{ width: ledgerSelectWidth(enabledCurrencies.find((cur) => cur.id === draft.currencyId)?.code ?? '', 5, 2) }}
                                className="rounded border border-slate-300 px-2 py-1.5 text-xs outline-none ring-blue-300 focus:ring"
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
                              className="px-4 py-3 text-slate-500 whitespace-nowrap"
                             >
                              {draft ? (
                               <input
                                type="text"
                                value={draft.description}
                                onChange={(event) => updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { description: event.target.value })}
                                style={{ width: ledgerFieldWidth(draft.description, 6, 3) }}
                                className="rounded border border-slate-300 px-2 py-1.5 text-xs outline-none ring-blue-300 focus:ring"
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
                      const colSpanCount = orderedLedgerColumnOptions.filter((c) => ledgerColumnVisibility[c.key]).length + 3;
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
                          className="border-t border-dashed border-slate-200 bg-slate-50/60"
                         >
                          <td
                           colSpan={colSpanCount}
                           className="px-4 py-2"
                          >
                           <button
                            type="button"
                            onClick={() => setLedgerExpensesExpandedKeys((prev) => new Set([...prev, chargesRowKey]))}
                            className="text-sm text-blue-600 hover:underline"
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
                         className="border-t border-dashed border-slate-200 bg-amber-50/60"
                        >
                         <td
                          colSpan={colSpanCount}
                          className="px-4 py-2"
                         >
                          <div className="flex flex-wrap items-start gap-2">
                           <span className="mt-2 text-xs font-medium text-amber-700">{t('charges')}</span>
                           <input
                            type="text"
                            inputMode="decimal"
                            dir="ltr"
                            value={formatAmountInput(chargesDraft.charges)}
                            onChange={(event) => updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { charges: normalizeDecimalInput(event.target.value) })}
                            className="field-sizing-content min-w-16 rounded border border-slate-300 px-2 py-1.5 text-xs outline-none ring-blue-300 focus:ring"
                            placeholder="0"
                           />
                           <select
                            value={chargesDraft.chargesCurrencyId ?? ''}
                            onChange={(event) =>
                             updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { chargesCurrencyId: event.target.value ? Number(event.target.value) : null })
                            }
                            className="rounded border border-slate-300 px-2 py-1.5 text-xs outline-none ring-blue-300 focus:ring"
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
                           <select
                            value={chargesDraft.chargesPayer}
                            onChange={(event) => updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { chargesPayer: event.target.value })}
                            className="rounded border border-slate-300 px-2 py-1.5 text-xs outline-none ring-blue-300 focus:ring"
                           >
                            <option value="">{t('charges_payer_placeholder')}</option>
                            <option value="from">{fromSideName}</option>
                            <option value="to">{toSideName}</option>
                            <option value="me_to_from">{t('charges_payer_me_to_name', { name: fromSideName })}</option>
                            <option value="me_to_to">{t('charges_payer_me_to_name', { name: toSideName })}</option>
                            <option value="from_to_me">{t('charges_payer_name_to_me', { name: fromSideName })}</option>
                            <option value="to_to_me">{t('charges_payer_name_to_me', { name: toSideName })}</option>
                           </select>
                           {showRate && (
                            <div className="flex items-center gap-1">
                             <span className="text-xs text-slate-500">
                              {draftChargesCurrencyCode} → {ledger.currencyCode}
                             </span>
                             <input
                              type="text"
                              inputMode="decimal"
                              dir="ltr"
                              value={chargesDraft.chargesExchangeRate}
                              onChange={(event) =>
                               updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { chargesExchangeRate: normalizeDecimalInput(event.target.value) })
                              }
                              className="field-sizing-content min-w-16 rounded border border-slate-300 px-2 py-1.5 text-xs outline-none ring-blue-300 focus:ring"
                              placeholder="1"
                             />
                            </div>
                           )}
                           <input
                            type="text"
                            value={chargesDraft.chargesDescription}
                            onChange={(event) => updateLedgerTransactionDraft(entry.transactionId, ledger.accountId, { chargesDescription: event.target.value })}
                            className="field-sizing-content min-w-28 rounded border border-slate-300 px-2 py-1.5 text-xs outline-none ring-blue-300 focus:ring"
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
                   ));
                  })()}
                  {(ledgerFilterSearch || ledgerFilterCounterparty || ledgerFilterDateFrom || ledgerFilterDateTo) &&
                   ledger.entries.length > 0 &&
                   (() => {
                    const q = ledgerFilterSearch.trim().toLowerCase();
                    const visibleCount = ledger.entries.filter((e) => {
                     if (ledgerFilterDateFrom && e.createdAt.slice(0, 10) < ledgerFilterDateFrom) return false;
                     if (ledgerFilterDateTo && e.createdAt.slice(0, 10) > ledgerFilterDateTo) return false;
                     if (ledgerFilterCounterparty && e.counterpartyName !== ledgerFilterCounterparty) return false;
                     if (q && !e.counterpartyName.toLowerCase().includes(q) && !(e.description ?? '').toLowerCase().includes(q) && !String(e.amount).includes(q)) return false;
                     return true;
                    }).length;
                    if (visibleCount > 0) return null;
                    return (
                     <tr>
                      <td
                       colSpan={orderedLedgerColumnOptions.filter((c) => ledgerColumnVisibility[c.key]).length + 3}
                       className="px-4 py-6 text-sm text-slate-500"
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
                const q = ledgerFilterSearch.trim().toLowerCase();
                const visibleCount = ordered.filter((e) => {
                 if (ledgerFilterDateFrom && e.createdAt.slice(0, 10) < ledgerFilterDateFrom) return false;
                 if (ledgerFilterDateTo && e.createdAt.slice(0, 10) > ledgerFilterDateTo) return false;
                 if (ledgerFilterCounterparty && e.counterpartyName !== ledgerFilterCounterparty) return false;
                 if (q && !e.counterpartyName.toLowerCase().includes(q) && !(e.description ?? '').toLowerCase().includes(q) && !String(e.amount).includes(q)) return false;
                 return true;
                }).length;
                if (visibleCount === 0) return null;
                const totalLedgerPages = Math.max(1, Math.ceil(visibleCount / ledgerPageSize));
                const currentLedgerPage = Math.max(1, Math.min(ledgerPageState[ledger.accountId] ?? 99999, totalLedgerPages));
                return (
                 <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-slate-600">
                   {(currentLedgerPage - 1) * ledgerPageSize + 1}–{Math.min(currentLedgerPage * ledgerPageSize, visibleCount)} {t('pagination_of')} {visibleCount}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                   <span className="text-xs text-slate-500">{t('pagination_per_page')}</span>
                   <select
                    value={ledgerPageSize}
                    onChange={(event) => {
                     const nextSize = Number(event.target.value);
                     setLedgerPageSize(nextSize);
                     if (typeof window !== 'undefined') window.localStorage.setItem('arkam:ledger-page-size', String(nextSize));
                     setLedgerPageState((prev) => ({ ...prev, [ledger.accountId]: 99999 }));
                    }}
                    className="rounded border border-slate-300 px-1.5 py-1 text-xs outline-none ring-blue-300 focus:ring"
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
                      className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
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
                      className="w-14 rounded border border-slate-300 px-1.5 py-1 text-center text-xs outline-none ring-blue-300 focus:ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                     />
                     <span className="text-xs text-slate-500">/ {totalLedgerPages}</span>
                     <button
                      type="button"
                      onClick={() => setLedgerPageState((prev) => ({ ...prev, [ledger.accountId]: Math.min(totalLedgerPages, currentLedgerPage + 1) }))}
                      disabled={currentLedgerPage >= totalLedgerPages}
                      className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
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
 );
}
