'use client';

import { ChangeEvent, Fragment, FormEvent, type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useLanguage } from '@/contexts/LanguageContext';
import HomePage from '@/components/marketing/HomePage';
import AccountSettings from '@/components/account/AccountSettings';
import TeamSettings from '@/components/account/TeamSettings';
import { useTranslation } from '@/hooks/useTranslation';
import { confirmDialog } from '@/components/ui/AppDialog';
import { buildLockBoundaries, violatedLock, isAtOrBeforeBoundary, NEW_ROW_REF_ID } from '@/features/ledger/utils/reconciliation';
import { Spinner } from '@/components/ui/Spinner';
import { accountingApi, type BackupInfo } from '@/lib/accountingApi';

import type {
 Organization,
 OrganizationForm,
 Client,
 ClientAccount,
 Currency,
 Transaction,
 TransactionTableRow,
 TransactionForm,
 TransactionUpdateInput,
 TransactionTableDraft,
 LedgerTransactionDraft,
 ClientLedgerEntry,
 ClientAdjustment,
 ClientAccountLedger,
 Reconciliation,
 ImportedTransactionRow,
 ImportMappingState,
 PendingImportData,
 ImportClientReview,
 ImportRowOverride,
 LedgerColumnKey,
 TransactionColumnKey,
 PdfColVisibility,
 StoredLedgerSettings,
 TransactionTableSettings,
 PdfSettings,
 SettingsTab,
 Section,
 IconName,
} from '@/shared/types';
import {
 getStoredLedgerAccountId,
 setStoredLedgerAccountId,
 getStoredLedgerColumnVisibility,
 getStoredLedgerSettings,
 getStoredTxHighlights,
 getStoredTxRowSettings,
 getStoredLedgerHighlights,
 getStoredPdfCols,
 savePdfCols,
 getStoredPdfDateRange,
 savePdfDateRange,
 getStoredTransactionTableSettings,
 saveTransactionTableSettings,
 getStoredLedgerColumnOrder,
 defaultLedgerColumnVisibility,
 defaultLedgerColumnOrder,
 clientsOrgOrderStorageKey,
 ledgerColumnOrderStorageKeyPrefix,
 ledgerColumnVisibilityStorageKeyPrefix,
 ledgerSettingsStorageKeyPrefix,
 ledgerHighlightsStorageKeyPrefix,
 txHighlightsStorageKey,
 txRowSettingsStorageKey,
} from '@/shared/lib/localStorage';
import { normalizeDecimalInput, formatAmountInput } from '@/shared/utils/decimal';
import { HIGHLIGHT_PEN_CURSOR, formatRateValue } from '@/shared/utils/format';
import { formatDateValue } from '@/shared/utils/date';
import { getCommissionAmount } from '@/shared/utils/commission';
import { renderIcon } from '@/shared/utils/icons';
import { getSectionFromPath } from '@/shared/utils/section';
import { getDeviceLabel } from '@/shared/utils/device';
import { ledgerEntryKey, getLedgerTransactionDraftKey } from '@/features/ledger/utils/ledgerEntries';
import {
 normalizeImportHeader,
 toImportString,
 buildImportColumnOptions,
 importNameKey,
 parseTransactionRowsFromMappedSheet,
 DEFAULT_IMPORT_ROW_OVERRIDE,
} from '@/features/transactions/utils/import';
import { SkBar, SkTablePanel, SK_TX, SK_LEDGER, SK_CLIENTS, SK_CURRENCIES } from '@/shared/components/skeletons/Skeletons';
import { useWorkspaceData, useWorkspaceCache } from '@/features/workspace/hooks/useWorkspaceData';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryClient';
import {
 snapshotSharedSettings,
 applySharedSettings,
 serializeSnapshot,
 getAppliedSharedVersion,
 setAppliedSharedVersion,
} from '@/features/settings/lib/sharedTableSettings';
import { ensureCacheOwner } from '@/shared/lib/cacheOwner';
import { panelClassName, mutedPanelClassName, tableWrapClassName } from '@/shared/styles';
import OverviewSection from '@/features/overview/components/OverviewSection';
import LiveRatesSection from '@/features/live-rates/components/LiveRatesSection';
import CurrenciesSection from '@/features/currencies/components/CurrenciesSection';
import CurrenciesReadOnly from '@/features/currencies/components/CurrenciesReadOnly';
import OrganizationsSection from '@/features/organizations/components/OrganizationsSection';
import OrganizationsReadOnly from '@/features/organizations/components/OrganizationsReadOnly';
import LanguageSettings from '@/features/settings/components/LanguageSettings';
import DangerZone from '@/features/settings/components/DangerZone';
import PdfSettingsTab from '@/features/settings/components/PdfSettings';
import DatabaseSettings from '@/features/settings/components/DatabaseSettings';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { useAppStatusStore } from '@/shared/store/appStatusStore';
import { generateArchiveHtml, generateLedgerHtml, generateTransactionsExportHtml, generateOverviewCardsHtml, type OverviewPdfCard } from '@/features/pdf/pdfExport';
import { computeClientLedgers, computeTransactionSideNetChange } from '@/features/ledger/utils/ledgerBalances';
import { buildTransactionTableRows, filterDisplayedTransactionRows } from '@/features/transactions/utils/transactionRows';
import { computeClientPageBalances } from '@/features/clients/utils/clientBalances';
import { sortAndFilterClients, groupClientsByOrganization } from '@/features/clients/utils/clientsView';
import { useClientsStore } from '@/features/clients/store/clientsStore';
import { emptyClientForm, createNewClientAccountDraft } from '@/features/clients/forms';
import { emptyOrganizationForm } from '@/features/organizations/forms';
import ClientsSection from '@/features/clients/components/ClientsSection';
import ClientsReadOnly from '@/features/clients/components/ClientsReadOnly';
import { useTransactionsStore } from '@/features/transactions/store/transactionsStore';
import { emptyTransactionForm } from '@/features/transactions/forms';
import { useDraftHistory } from '@/shared/hooks/useDraftHistory';
import TransactionsSection from '@/features/transactions/components/TransactionsSection';
import { useLedgerStore } from '@/features/ledger/store/ledgerStore';
import LedgerSection from '@/features/ledger/components/LedgerSection';
import ImportWizard from '@/features/transactions/components/ImportWizard';
import CreateOrgDialog from '@/features/organizations/components/CreateOrgDialog';
import ToastHost from '@/shared/components/ToastHost';
import Sidebar from '@/shared/components/Sidebar';
import AppHeader from '@/shared/components/AppHeader';
import LedgerSettingsModal from '@/features/ledger/components/LedgerSettingsModal';
import AdjustmentModal from '@/features/ledger/components/AdjustmentModal';
import PdfExportModal from '@/features/ledger/components/PdfExportModal';
import TransactionExportModal from '@/features/transactions/components/TransactionExportModal';
import TransactionTableSettingsModal from '@/features/transactions/components/TransactionTableSettingsModal';


// Stable empty arrays so the derived server-data views keep a constant identity
// while the workspace query is still loading (avoids needless downstream re-memos).
const EMPTY_ORGANIZATIONS: Organization[] = [];
const EMPTY_CLIENTS: Client[] = [];
const EMPTY_CURRENCIES: Currency[] = [];
const EMPTY_TRANSACTIONS: Transaction[] = [];
const EMPTY_ADJUSTMENTS: ClientAdjustment[] = [];
const EMPTY_RECONCILIATIONS: Reconciliation[] = [];
const EMPTY_CLIENT_ACCOUNTS: ClientAccount[] = [];

function AuthenticatedHome() {
 const router = useRouter();
 const pathname = usePathname();
 const { language, setLanguage, isRTL } = useLanguage();
 // French uses 'en-US' grouping (comma thousands, period decimal) instead of the
 // official fr-FR narrow-no-break-space separator, which renders as near-invisible.
 const numLocale = language === 'fr' ? 'en-US' : language;
 const { t } = useTranslation(language);
 const [section, setSection] = useState<Section>(() => getSectionFromPath(pathname).section);
 const [settingsTab, setSettingsTab] = useState<SettingsTab>('clients');
 const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
  try {
   return localStorage.getItem('arkam:sidebar-collapsed') === 'true';
  } catch {
   return false;
  }
 });
 const [userWorkspaces, setUserWorkspaces] = useState<Array<{ id: string; name: string; role: string }>>([]);
 // Seeded synchronously from storage (same value accountingApi sends as the
 // x-workspace-id header) so the very first render already keys the workspace
 // query correctly; the effect below still re-validates/corrects it against the
 // user's actual memberships once they load.
 const [activeWorkspaceId, setActiveWorkspaceIdState] = useState<string | null>(() => accountingApi.getActiveWorkspaceId());
 // SECURITY: browser caches are per-browser, not per-account. Before the workspace
 // query reads any cached data, purge everything left by a different user on this
 // browser (and clear the in-memory query cache) so one user's data can never bleed
 // into another's on a shared browser. Runs once per mount, synchronously, ahead of
 // useWorkspaceData's cache read below.
 const { data: authSession } = useSession();
 const sessionUserId = authSession?.user?.id ?? null;
 const queryClient = useQueryClient();
 useState(() => {
  if (ensureCacheOwner(sessionUserId)) {
   queryClient.removeQueries();
  }
  return null;
 });

 // Server data is owned by a single TanStack Query cache (useWorkspaceData). The
 // arrays below are derived views; the setX shims write to that cache so the
 // existing optimistic-update sites keep working, and loadData() maps to a refetch.
 const workspaceQuery = useWorkspaceData(sessionUserId, activeWorkspaceId);
 const workspaceData = workspaceQuery.data;
 const { invalidate: invalidateWorkspace, setters: workspaceSetters } = useWorkspaceCache(sessionUserId, activeWorkspaceId);
 const { setOrganizations, setClients, setTransactions, setAdjustments, setClientAccounts, setReconciliations } = workspaceSetters;
 const isLoading = workspaceQuery.isPending;
 const organizations = workspaceData?.organizations ?? EMPTY_ORGANIZATIONS;
 const clients = workspaceData?.clients ?? EMPTY_CLIENTS;
 const clientSort = useClientsStore((s) => s.clientSort);
 const setClientSort = useClientsStore((s) => s.setClientSort);
 const clientSearch = useClientsStore((s) => s.clientSearch);
 const clientsPage = useClientsStore((s) => s.clientsPage);
 const setClientsPage = useClientsStore((s) => s.setClientsPage);
 const clientsPageSize = useClientsStore((s) => s.clientsPageSize);
 const clientsOrgOrder = useClientsStore((s) => s.clientsOrgOrder);
 const setClientsOrgOrder = useClientsStore((s) => s.setClientsOrgOrder);
 const draggedOrgKey = useClientsStore((s) => s.draggedOrgKey);
 const setDraggedOrgKey = useClientsStore((s) => s.setDraggedOrgKey);
 const setDragOverOrgKey = useClientsStore((s) => s.setDragOverOrgKey);
 const currencies = workspaceData?.currencies ?? EMPTY_CURRENCIES;
 const transactions = workspaceData?.transactions ?? EMPTY_TRANSACTIONS;
 const adjustments = workspaceData?.adjustments ?? EMPTY_ADJUSTMENTS;
 const reconciliations = workspaceData?.reconciliations ?? EMPTY_RECONCILIATIONS;
 const clientAccounts = workspaceData?.clientAccounts ?? EMPTY_CLIENT_ACCOUNTS;
 const [selectedClientForAccounts, setSelectedClientForAccounts] = useState<Client | null>(null);
 const [selectedClientForLedger, setSelectedClientForLedger] = useState<Client | null>(null);
 const clientLedgerBackSection = useLedgerStore((s) => s.clientLedgerBackSection);
 const setClientLedgerBackSection = useLedgerStore((s) => s.setClientLedgerBackSection);
 const editingLedgerRowKeys = useLedgerStore((s) => s.editingLedgerRowKeys);
 const setEditingLedgerRowKeys = useLedgerStore((s) => s.setEditingLedgerRowKeys);
 const setEditAllLedgerAccountIds = useLedgerStore((s) => s.setEditAllLedgerAccountIds);
 const selectedLedgerEntryKeys = useLedgerStore((s) => s.selectedLedgerEntryKeys);
 const setSelectedLedgerEntryKeys = useLedgerStore((s) => s.setSelectedLedgerEntryKeys);
 const showLedgerSettingsModal = useLedgerStore((s) => s.showLedgerSettingsModal);
 const setShowLedgerSettingsModal = useLedgerStore((s) => s.setShowLedgerSettingsModal);
 const setLedgerFilterOpen = useLedgerStore((s) => s.setLedgerFilterOpen);
 const ledgerFilterSearch = useLedgerStore((s) => s.ledgerFilterSearch);
 const setLedgerFilterSearch = useLedgerStore((s) => s.setLedgerFilterSearch);
 const ledgerFilterCounterparty = useLedgerStore((s) => s.ledgerFilterCounterparty);
 const setLedgerFilterCounterparty = useLedgerStore((s) => s.setLedgerFilterCounterparty);
 const ledgerFilterDateFrom = useLedgerStore((s) => s.ledgerFilterDateFrom);
 const setLedgerFilterDateFrom = useLedgerStore((s) => s.setLedgerFilterDateFrom);
 const ledgerFilterDateTo = useLedgerStore((s) => s.ledgerFilterDateTo);
 const setLedgerFilterDateTo = useLedgerStore((s) => s.setLedgerFilterDateTo);
 const ledgerDecimals = useLedgerStore((s) => s.ledgerDecimals);
 const setLedgerDecimals = useLedgerStore((s) => s.setLedgerDecimals);
 const ledgerDateFormat = useLedgerStore((s) => s.ledgerDateFormat);
 const setLedgerDateFormat = useLedgerStore((s) => s.setLedgerDateFormat);
 const ledgerHighlightNetChange = useLedgerStore((s) => s.ledgerHighlightNetChange);
 const setLedgerHighlightNetChange = useLedgerStore((s) => s.setLedgerHighlightNetChange);
 const ledgerNetChangeHighlightColor = useLedgerStore((s) => s.ledgerNetChangeHighlightColor);
 const setLedgerNetChangeHighlightColor = useLedgerStore((s) => s.setLedgerNetChangeHighlightColor);
 const ledgerRowHighlightColor = useLedgerStore((s) => s.ledgerRowHighlightColor);
 const setLedgerRowHighlightColor = useLedgerStore((s) => s.setLedgerRowHighlightColor);
 const ledgerRowClickHighlight = useLedgerStore((s) => s.ledgerRowClickHighlight);
 const setLedgerRowClickHighlight = useLedgerStore((s) => s.setLedgerRowClickHighlight);
 const setLedgerRowClickActive = useLedgerStore((s) => s.setLedgerRowClickActive);
 const highlightedLedgerRows = useLedgerStore((s) => s.highlightedLedgerRows);
 const setHighlightedLedgerRows = useLedgerStore((s) => s.setHighlightedLedgerRows);
 const [txRowClickHighlight, setTxRowClickHighlight] = useState<boolean>(() => getStoredTxRowSettings().rowClickHighlight);
 // Whether the tx highlight/copy click mode is engaged at all; when false the pointer is
 // neutral and row clicks do nothing. Session-only — the highlight-vs-copy preference persists.
 const [txRowClickActive, setTxRowClickActive] = useState(true);
 const [highlightedTxRows, setHighlightedTxRows] = useState<Map<number, string>>(() => getStoredTxHighlights());
 const [txRowHighlightColor, setTxRowHighlightColor] = useState<string>(() => getStoredTxRowSettings().rowHighlightColor);
 // "Sum mode" for the transactions table: a third row-click mode alongside highlight/copy.
 // Clicking an amount while it's on adds it to txSumSelection; clicking again removes it.
 const [txSumMode, setTxSumMode] = useState(false);
 const [txSumSelection, setTxSumSelection] = useState<Map<number, { amount: number; currencyCode: string; currencySymbol: string }>>(new Map());
 const setLedgerStartingBalanceDrafts = useLedgerStore((s) => s.setLedgerStartingBalanceDrafts);
 const setEditingStartingBalanceIds = useLedgerStore((s) => s.setEditingStartingBalanceIds);
 const [selectedLedgerAccountId, setSelectedLedgerAccountId] = useState<number | null>(null);
 const setIsTransactionsEditMode = useTransactionsStore((s) => s.setIsTransactionsEditMode);
 const selectedTransactionIds = useTransactionsStore((s) => s.selectedTransactionIds);
 const setSelectedTransactionIds = useTransactionsStore((s) => s.setSelectedTransactionIds);
 const editingRowIds = useTransactionsStore((s) => s.editingRowIds);
 const setEditingRowIds = useTransactionsStore((s) => s.setEditingRowIds);
 const setIsEditAllTransactions = useTransactionsStore((s) => s.setIsEditAllTransactions);
 const setDragRowId = useTransactionsStore((s) => s.setDragRowId);
 const setDragOverRowId = useTransactionsStore((s) => s.setDragOverRowId);
 const setDragOverHalf = useTransactionsStore((s) => s.setDragOverHalf);
 const manualRowOrder = useTransactionsStore((s) => s.manualRowOrder);
 const setManualRowOrder = useTransactionsStore((s) => s.setManualRowOrder);
 const transactionsPage = useTransactionsStore((s) => s.transactionsPage);
 const setTransactionsPage = useTransactionsStore((s) => s.setTransactionsPage);
 const transactionsPageSize = useTransactionsStore((s) => s.transactionsPageSize);
 const setTransactionsPageSize = useTransactionsStore((s) => s.setTransactionsPageSize);
 const setLedgerPageState = useLedgerStore((s) => s.setLedgerPageState);
 const setLedgerPageSize = useLedgerStore((s) => s.setLedgerPageSize);
 const showTransactionTableSettingsModal = useTransactionsStore((s) => s.showTransactionTableSettingsModal);
 const setShowTransactionTableSettingsModal = useTransactionsStore((s) => s.setShowTransactionTableSettingsModal);
 const transactionTableSettings = useTransactionsStore((s) => s.transactionTableSettings);
 const setTransactionTableSettings = useTransactionsStore((s) => s.setTransactionTableSettings);
 const transactionTableSettingsDraft = useTransactionsStore((s) => s.transactionTableSettingsDraft);
 const setTransactionTableSettingsDraft = useTransactionsStore((s) => s.setTransactionTableSettingsDraft);
 const showTransactionExportModal = useTransactionsStore((s) => s.showTransactionExportModal);
 const setShowTransactionExportModal = useTransactionsStore((s) => s.setShowTransactionExportModal);
 const transactionExportFrom = useTransactionsStore((s) => s.transactionExportFrom);
 const setTransactionExportFrom = useTransactionsStore((s) => s.setTransactionExportFrom);
 const transactionExportTo = useTransactionsStore((s) => s.transactionExportTo);
 const setTransactionExportTo = useTransactionsStore((s) => s.setTransactionExportTo);
 const isExportingTransactions = useTransactionsStore((s) => s.isExportingTransactions);
 const setIsExportingTransactions = useTransactionsStore((s) => s.setIsExportingTransactions);
 const txSortDir = useTransactionsStore((s) => s.txSortDir);
 const setTxSortDir = useTransactionsStore((s) => s.setTxSortDir);
 const setTxFilterOpen = useTransactionsStore((s) => s.setTxFilterOpen);
 const txFilterSearch = useTransactionsStore((s) => s.txFilterSearch);
 const setTxFilterSearch = useTransactionsStore((s) => s.setTxFilterSearch);
 const txFilterClient = useTransactionsStore((s) => s.txFilterClient);
 const setTxFilterClient = useTransactionsStore((s) => s.setTxFilterClient);
 const txFilterDateFrom = useTransactionsStore((s) => s.txFilterDateFrom);
 const setTxFilterDateFrom = useTransactionsStore((s) => s.setTxFilterDateFrom);
 const txFilterDateTo = useTransactionsStore((s) => s.txFilterDateTo);
 const setTxFilterDateTo = useTransactionsStore((s) => s.setTxFilterDateTo);
 const txFilterHideExpenses = useTransactionsStore((s) => s.txFilterHideExpenses);
 const setCommissionExpandedTxns = useTransactionsStore((s) => s.setCommissionExpandedTxns);
 const setExpensesExpandedTxns = useTransactionsStore((s) => s.setExpensesExpandedTxns);
 const setLedgerExpensesExpandedKeys = useLedgerStore((s) => s.setLedgerExpensesExpandedKeys);
 const setIsNewTransactionSectionOpen = useTransactionsStore((s) => s.setIsNewTransactionSectionOpen);
 const setIsNewTransactionExpensesOpen = useTransactionsStore((s) => s.setIsNewTransactionExpensesOpen);
 const showLedgerCurrencySymbol = useLedgerStore((s) => s.showLedgerCurrencySymbol);
 const setShowLedgerCurrencySymbol = useLedgerStore((s) => s.setShowLedgerCurrencySymbol);
 const draggedLedgerColumn = useLedgerStore((s) => s.draggedLedgerColumn);
 const setDraggedLedgerColumn = useLedgerStore((s) => s.setDraggedLedgerColumn);
 const setDragLedgerRowKey = useLedgerStore((s) => s.setDragLedgerRowKey);
 const setDragOverLedgerRowKey = useLedgerStore((s) => s.setDragOverLedgerRowKey);
 const setDragOverLedgerHalf = useLedgerStore((s) => s.setDragOverLedgerHalf);
 const ledgerColumnOrder = useLedgerStore((s) => s.ledgerColumnOrder);
 const setLedgerColumnOrder = useLedgerStore((s) => s.setLedgerColumnOrder);
 const setLedgerColumnVisibility = useLedgerStore((s) => s.setLedgerColumnVisibility);
 const ledgerTransactionDrafts = useLedgerStore((s) => s.ledgerTransactionDrafts);
 const setLedgerTransactionDrafts = useLedgerStore((s) => s.setLedgerTransactionDrafts);
 const setLedgerSumMode = useLedgerStore((s) => s.setLedgerSumMode);
 const setLedgerSumSelection = useLedgerStore((s) => s.setLedgerSumSelection);
 const transactionTableDrafts = useTransactionsStore((s) => s.transactionTableDrafts);
 const setTransactionTableDrafts = useTransactionsStore((s) => s.setTransactionTableDrafts);
 const ledgerHistory = useDraftHistory(ledgerTransactionDrafts, setLedgerTransactionDrafts);
 const txTableHistory = useDraftHistory(transactionTableDrafts, setTransactionTableDrafts);
 const resetLedgerHistory = ledgerHistory.reset;
 const resetTxTableHistory = txTableHistory.reset;
 // Clear undo/redo history once an edit session ends (all drafts discarded/saved).
 useEffect(() => {
  if (Object.keys(ledgerTransactionDrafts).length === 0) resetLedgerHistory();
 }, [ledgerTransactionDrafts, resetLedgerHistory]);
 useEffect(() => {
  if (Object.keys(transactionTableDrafts).length === 0) resetTxTableHistory();
 }, [transactionTableDrafts, resetTxTableHistory]);
 const [selectedOrganizationForClients, setSelectedOrganizationForClients] = useState<Organization | null>(null);

 // Shows the open client/organisation next to the favicon in the browser tab, so a user
 // with several tabs open can tell them apart at a glance instead of every tab reading "Arkam".
 useEffect(() => {
  const name = section === 'client-ledger' ? selectedClientForLedger?.name : section === 'organization-clients' ? selectedOrganizationForClients?.name : null;
  document.title = name ? `${name} — Arkam` : 'Arkam';
 }, [section, selectedClientForLedger, selectedOrganizationForClients]);
 const newAccountCurrencyId = useClientsStore((s) => s.newAccountCurrencyId);
 const setNewAccountCurrencyId = useClientsStore((s) => s.setNewAccountCurrencyId);
 const newAccountStartingBalance = useClientsStore((s) => s.newAccountStartingBalance);
 const setNewAccountStartingBalance = useClientsStore((s) => s.setNewAccountStartingBalance);
 const newAccountBalanceType = useClientsStore((s) => s.newAccountBalanceType);
 const setNewAccountBalanceType = useClientsStore((s) => s.setNewAccountBalanceType);
 const setShowAddAccountForm = useClientsStore((s) => s.setShowAddAccountForm);
 const [showCreateOrgDialog, setShowCreateOrgDialog] = useState(false);
 const [isSavingOrg, setIsSavingOrg] = useState(false);
 const [orgDialogError, setOrgDialogError] = useState('');
 // When the create-organization popup is opened from an import-review row, this
 // holds that row's key so the new org is assigned back to it (not the client form).
 const [orgDialogTargetReviewKey, setOrgDialogTargetReviewKey] = useState<string | null>(null);
 const editingAccountId = useClientsStore((s) => s.editingAccountId);
 const setEditingAccountId = useClientsStore((s) => s.setEditingAccountId);
 const editingAccountCurrencyId = useClientsStore((s) => s.editingAccountCurrencyId);
 const editingAccountBalance = useClientsStore((s) => s.editingAccountBalance);
 const editingAccountBalanceType = useClientsStore((s) => s.editingAccountBalanceType);
 // "Move all transactions to another account" picker, scoped to the account being edited.
 const moveTargetAccountId = useClientsStore((s) => s.moveTargetAccountId);
 const setMoveTargetAccountId = useClientsStore((s) => s.setMoveTargetAccountId);
 const setIsMovingAccount = useClientsStore((s) => s.setIsMovingAccount);
 const pdfExportModal = useLedgerStore((s) => s.pdfExportModal);
 const setPdfExportModal = useLedgerStore((s) => s.setPdfExportModal);
 const adjustmentModal = useLedgerStore((s) => s.adjustmentModal);
 const setAdjustmentModal = useLedgerStore((s) => s.setAdjustmentModal);
 const pdfSettings = useSettingsStore((s) => s.pdfSettings);
 const [organizationForm, setOrganizationForm] = useState<OrganizationForm>(emptyOrganizationForm);
 const clientForm = useClientsStore((s) => s.clientForm);
 const setClientForm = useClientsStore((s) => s.setClientForm);
 // Disables the save button while a client is being created/updated so a double-click can't
 // create a duplicate. The ref is the synchronous guard (state hasn't re-rendered yet on a
 // rapid second click); the state drives the disabled UI.
 const isSubmittingClient = useClientsStore((s) => s.isSubmittingClient);
 const setIsSubmittingClient = useClientsStore((s) => s.setIsSubmittingClient);
 const clientSubmitLock = useRef(false);
 const openAccountOnCreate = useClientsStore((s) => s.openAccountOnCreate);
 const setOpenAccountOnCreate = useClientsStore((s) => s.setOpenAccountOnCreate);
 const newClientAccountDrafts = useClientsStore((s) => s.newClientAccountDrafts);
 const setNewClientAccountDrafts = useClientsStore((s) => s.setNewClientAccountDrafts);
 const transactionForm = useTransactionsStore((s) => s.transactionForm);
 const setTransactionForm = useTransactionsStore((s) => s.setTransactionForm);
 // Disables the submit button while a new transaction/adjustment is being created, so a
 // double-click can't create a duplicate. The ref is the synchronous guard (state hasn't
 // re-rendered yet on a rapid second click); the state drives the disabled UI.
 const setIsSubmittingTransaction = useTransactionsStore((s) => s.setIsSubmittingTransaction);
 const transactionSubmitLock = useRef(false);
 // When enabled, the sender and receiver ledgers each get their own description override.
 const txSplitDescription = useTransactionsStore((s) => s.txSplitDescription);
 const setTxSplitDescription = useTransactionsStore((s) => s.setTxSplitDescription);
 const newTransactionDate = useTransactionsStore((s) => s.newTransactionDate);
 const setNewTransactionDate = useTransactionsStore((s) => s.setNewTransactionDate);
 const copiedTransaction = useTransactionsStore((s) => s.copiedTransaction);
 const setCopiedTransaction = useTransactionsStore((s) => s.setCopiedTransaction);
 const setTxFromQuery = useTransactionsStore((s) => s.setTxFromQuery);
 const setTxFromOpen = useTransactionsStore((s) => s.setTxFromOpen);
 const setTxFromExpandedClient = useTransactionsStore((s) => s.setTxFromExpandedClient);
 const setTxToQuery = useTransactionsStore((s) => s.setTxToQuery);
 const setTxToOpen = useTransactionsStore((s) => s.setTxToOpen);
 const setTxToExpandedClient = useTransactionsStore((s) => s.setTxToExpandedClient);
 const setLedgerCounterpartyOpen = useLedgerStore((s) => s.setLedgerCounterpartyOpen);
 const setLedgerCounterpartyQuery = useLedgerStore((s) => s.setLedgerCounterpartyQuery);
 const setLedgerCounterpartyExpandedClient = useLedgerStore((s) => s.setLedgerCounterpartyExpandedClient);
 const setDescriptionSuggestOpen = useTransactionsStore((s) => s.setDescriptionSuggestOpen);
 const txFromRateReversed = useTransactionsStore((s) => s.txFromRateReversed);
 const setTxFromRateReversed = useTransactionsStore((s) => s.setTxFromRateReversed);
 const txToRateReversed = useTransactionsStore((s) => s.txToRateReversed);
 const setTxToRateReversed = useTransactionsStore((s) => s.setTxToRateReversed);
 const ledgerRateReversed = useLedgerStore((s) => s.ledgerRateReversed);
 const setLedgerRateReversed = useLedgerStore((s) => s.setLedgerRateReversed);
 const setLedgerDisplayRateReversed = useLedgerStore((s) => s.setLedgerDisplayRateReversed);
 const tableRateFromReversed = useTransactionsStore((s) => s.tableRateFromReversed);
 const setTableRateFromReversed = useTransactionsStore((s) => s.setTableRateFromReversed);
 const tableRateToReversed = useTransactionsStore((s) => s.tableRateToReversed);
 const setTableRateToReversed = useTransactionsStore((s) => s.setTableRateToReversed);
 const error = useAppStatusStore((s) => s.error);
 const setError = useAppStatusStore((s) => s.setError);
 const showUndo = useAppStatusStore((s) => s.showUndo);
 const [importSummary, setImportSummary] = useState('');
 const setIsImportingTransactions = useTransactionsStore((s) => s.setIsImportingTransactions);
 const pendingImportData = useTransactionsStore((s) => s.pendingImportData);
 const setPendingImportData = useTransactionsStore((s) => s.setPendingImportData);
 const importMapping = useTransactionsStore((s) => s.importMapping);
 const setImportMapping = useTransactionsStore((s) => s.setImportMapping);
 const importReview = useTransactionsStore((s) => s.importReview);
 const setImportReview = useTransactionsStore((s) => s.setImportReview);
 // The parsed sheet rows backing the current review, plus per-row overrides for
 // rows that involve an expense-marked name (expense vs. real transaction).
 const setImportParsedRows = useTransactionsStore((s) => s.setImportParsedRows);
 const importRowOverrides = useTransactionsStore((s) => s.importRowOverrides);
 const setImportRowOverrides = useTransactionsStore((s) => s.setImportRowOverrides);
 // Currencies the "apply to all clients" control will open for every client.
 const transactionsImportInputRef = useRef<HTMLInputElement | null>(null);
 const [isBackingUp, setIsBackingUp] = useState(false);
 const [isRestoringBackup, setIsRestoringBackup] = useState(false);
 const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
 const [lastBackupDevice, setLastBackupDevice] = useState<string | null>(null);
 const backupRestoreInputRef = useRef<HTMLInputElement | null>(null);
 const lastInitializedSubIdRef = useRef<string>('');
 const [subscriptionEndsAt, setSubscriptionEndsAt] = useState<string | null>(null);
 const [subscriptionBannerDismissed, setSubscriptionBannerDismissed] = useState(false);

 // The workspace query (useWorkspaceData) owns fetching + the currency reseed +
 // the sessionStorage cache write and auto-fetches on mount. loadData() now just
 // refetches that snapshot; every mutation site that awaited it keeps working
 // (the promise resolves once the refetch settles).
 const loadData = useCallback(async () => {
  await invalidateWorkspace();
 }, [invalidateWorkspace]);

 // Surface load failures and clear the banner on each successful (re)fetch —
 // mirrors the setError handling that used to live inside loadData.
 useEffect(() => {
  if (workspaceQuery.isError) {
   setError(workspaceQuery.error instanceof Error ? workspaceQuery.error.message : t('error_failed_load'));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [workspaceQuery.isError, workspaceQuery.errorUpdatedAt, t]);
 useEffect(() => {
  if (workspaceQuery.isSuccess) setError('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [workspaceQuery.dataUpdatedAt, workspaceQuery.isSuccess]);

 // Keep the backup indicator in sync with the fetched snapshot. recordBackup still
 // updates these directly for its own optimistic result.
 useEffect(() => {
  const backup = workspaceData?.backup;
  if (backup) {
   setLastBackupAt(backup.lastBackupAt ?? null);
   setLastBackupDevice(backup.lastBackupDevice ?? null);
  }
 }, [workspaceData?.backup]);

 // Reconcile the selected org/client against fresh rows after any data change, so
 // edits are reflected and deletions clear the selection (was done inside loadData).
 useEffect(() => {
  setSelectedOrganizationForClients((current) => (current ? (organizations.find((organization) => organization.id === current.id) ?? null) : null));
  setSelectedClientForAccounts((current) => (current ? (clients.find((client) => client.id === current.id) ?? null) : null));
  setSelectedClientForLedger((current) => (current ? (clients.find((client) => client.id === current.id) ?? null) : null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [organizations, clients]);

 // Load the user's workspaces for the sidebar switcher (shown only when 2+).
 useEffect(() => {
  let mounted = true;
  accountingApi
   .listWorkspaces()
   .then(({ workspaces, defaultWorkspaceId }) => {
    if (!mounted) return;
    setUserWorkspaces(workspaces);
    // Only honour a stored workspace id if it actually belongs to this user;
    // otherwise a stale id from a previous account (or a workspace this user was
    // removed from) would target the wrong tenant. Fall back to their default.
    const stored = accountingApi.getActiveWorkspaceId();
    const chosen = (stored && workspaces.some((workspace) => workspace.id === stored) ? stored : null) || defaultWorkspaceId || workspaces[0]?.id || null;
    if (chosen !== stored) {
     accountingApi.setActiveWorkspaceId(chosen);
    }
    setActiveWorkspaceIdState(chosen);
   })
   .catch(() => {
    /* non-fatal */
   });
  return () => {
   mounted = false;
  };
 }, []);

 // Fetch the signed-in user's own subscription window (null for invited teammates,
 // who don't carry a subscription of their own) to drive the expiry banner below.
 useEffect(() => {
  if (!sessionUserId) return;
  let mounted = true;
  fetch('/api/account/subscription')
   .then((res) => (res.ok ? (res.json() as Promise<{ subscriptionEndsAt: string | null }>) : null))
   .then((data) => {
    if (mounted && data) setSubscriptionEndsAt(data.subscriptionEndsAt ?? null);
   })
   .catch(() => {
    /* non-fatal */
   });
  return () => {
   mounted = false;
  };
 }, [sessionUserId]);

 const subscriptionDaysLeft = subscriptionEndsAt ? Math.ceil((new Date(subscriptionEndsAt).getTime() - Date.now()) / 86_400_000) : null;
 const subscriptionBannerDismissKey = subscriptionEndsAt ? `arkam:subscription-banner-dismissed:${subscriptionEndsAt}` : '';
 const showSubscriptionBanner = subscriptionDaysLeft !== null && subscriptionDaysLeft <= 5 && !subscriptionBannerDismissed;

 // Re-check dismissal (keyed by the current end date, so renewing resets it) whenever
 // the subscription window changes.
 useEffect(() => {
  if (!subscriptionBannerDismissKey) {
   setSubscriptionBannerDismissed(false);
   return;
  }
  try {
   setSubscriptionBannerDismissed(localStorage.getItem(subscriptionBannerDismissKey) === 'true');
  } catch {
   setSubscriptionBannerDismissed(false);
  }
 }, [subscriptionBannerDismissKey]);

 const dismissSubscriptionBanner = () => {
  setSubscriptionBannerDismissed(true);
  try {
   if (subscriptionBannerDismissKey) localStorage.setItem(subscriptionBannerDismissKey, 'true');
  } catch {
   /* non-fatal */
  }
 };

 const onSwitchWorkspace = (id: string) => {
  if (!id || id === activeWorkspaceId) return;
  accountingApi.setActiveWorkspaceId(id);
  // Full reload to cleanly re-scope all workspace-bound state.
  window.location.reload();
 };

 useEffect(() => {
  setSection(getSectionFromPath(pathname).section);
 }, [pathname]);

 // Resolve the client/organization from the URL path. Intentionally does NOT depend on
 // clientAccounts or touch the selected account — that would reset the user's chosen account
 // on every data reload after a save. Account selection is handled by the effect below.
 useEffect(() => {
  const { section: pathSection, subId } = getSectionFromPath(pathname);
  if (pathSection === 'client-ledger' && subId) {
   const clientId = parseInt(subId, 10);
   if (!isNaN(clientId) && clients.length > 0) {
    const client = clients.find((c) => c.id === clientId);
    if (client) {
     if (lastInitializedSubIdRef.current !== subId) {
      setLedgerTransactionDrafts({});
      lastInitializedSubIdRef.current = subId;
     }
     setSelectedClientForLedger(client);
    }
   }
  } else if (pathSection === 'organization-clients' && subId) {
   const orgId = parseInt(subId, 10);
   if (!isNaN(orgId) && organizations.length > 0) {
    const org = organizations.find((o) => o.id === orgId);
    if (org) setSelectedOrganizationForClients(org);
   }
  }
 }, [pathname, clients, organizations]);

 // Choose the active ledger account for the open client. Keeps the current selection if it is
 // still valid (so reloads after a save don't jump to the first account); otherwise restores the
 // last-viewed account from localStorage, falling back to the first account.
 useEffect(() => {
  const clientId = selectedClientForLedger?.id;
  if (!clientId) return;
  const accounts = clientAccounts.filter((a) => a.clientId === clientId);
  if (accounts.length === 0) return;
  setSelectedLedgerAccountId((current) => {
   if (current != null && accounts.some((a) => a.id === current)) return current;
   const stored = getStoredLedgerAccountId(clientId);
   if (stored != null && accounts.some((a) => a.id === stored)) return stored;
   return accounts[0].id;
  });
 }, [selectedClientForLedger?.id, clientAccounts]);

 // Persist the active ledger account so a refresh restores it. Guard against persisting an
 // account that doesn't belong to the current client during the brief cross-client transition.
 useEffect(() => {
  const clientId = selectedClientForLedger?.id;
  if (!clientId || selectedLedgerAccountId == null) return;
  const account = clientAccounts.find((a) => a.id === selectedLedgerAccountId);
  if (account && account.clientId === clientId) {
   setStoredLedgerAccountId(clientId, selectedLedgerAccountId);
  }
 }, [selectedClientForLedger?.id, selectedLedgerAccountId, clientAccounts]);

 // Re-reads the open client's ledger prefs from localStorage into the store. Reused
 // both on client change and after applying shared workspace settings.
 const hydrateLedgerPrefsFromStorage = useCallback(() => {
  const clientId = selectedClientForLedger?.id;
  setLedgerColumnVisibility(getStoredLedgerColumnVisibility(clientId));
  setLedgerColumnOrder(getStoredLedgerColumnOrder(clientId));
  const settings = getStoredLedgerSettings(clientId);
  setLedgerDecimals(settings.decimals);
  setShowLedgerCurrencySymbol(settings.showCurrencySymbol);
  setLedgerDateFormat(settings.dateFormat);
  setLedgerHighlightNetChange(settings.highlightNetChange);
  setLedgerNetChangeHighlightColor(settings.netChangeHighlightColor);
  setLedgerRowHighlightColor(settings.rowHighlightColor);
  setLedgerRowClickHighlight(settings.rowClickHighlight);
  setHighlightedLedgerRows(getStoredLedgerHighlights(clientId));
  // Store setters are stable; only the open client id should retrigger a reload.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [selectedClientForLedger?.id]);

 // Load ALL per-client ledger preferences whenever the open client changes.
 useEffect(() => {
  hydrateLedgerPrefsFromStorage();
 }, [hydrateLedgerPrefsFromStorage]);

 // --- Workspace-shared table settings (owner-controlled) --------------------
 // When enabled, the ledger/transaction table layout + display settings live on the
 // server (per workspace) and the owner pushes them to every member. Members can
 // still tweak locally between pushes (their "override"). Shareable settings are a
 // snapshot of the relevant localStorage keys (see sharedTableSettings.ts).
 const isWorkspaceOwner = userWorkspaces.find((workspace) => workspace.id === activeWorkspaceId)?.role === 'owner';

 const workspaceSettingsQuery = useQuery({
  queryKey: queryKeys.workspaceSettings(activeWorkspaceId),
  queryFn: () => accountingApi.getWorkspaceSettings(),
  enabled: Boolean(activeWorkspaceId && sessionUserId),
  staleTime: 60_000,
 });
 const sharedSettingsEnabled = workspaceSettingsQuery.data?.sharedEnabled ?? false;
 const sharedSettingsPushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
 const lastPushedSharedSnapshot = useRef<string | null>(null);

 // Apply the owner's shared settings whenever the server version advances past what
 // this browser last applied (later local edits stand until the next owner push).
 useEffect(() => {
  const settings = workspaceSettingsQuery.data;
  if (!settings || !settings.sharedEnabled) return;
  if (settings.version <= getAppliedSharedVersion()) return;
  applySharedSettings(settings.settings);
  setAppliedSharedVersion(settings.version);
  lastPushedSharedSnapshot.current = serializeSnapshot(snapshotSharedSettings());
  hydrateLedgerPrefsFromStorage();
  setTransactionTableSettings(getStoredTransactionTableSettings());
 }, [workspaceSettingsQuery.data, hydrateLedgerPrefsFromStorage, setTransactionTableSettings]);

 // Debounced push of the current shared-settings snapshot — no-op unless sharing is
 // on AND the current user is the owner AND something shareable actually changed.
 function pushSharedSettingsIfOwner() {
  if (!sharedSettingsEnabled || !isWorkspaceOwner) return;
  if (sharedSettingsPushTimer.current) clearTimeout(sharedSettingsPushTimer.current);
  sharedSettingsPushTimer.current = setTimeout(() => {
   const snapshot = snapshotSharedSettings();
   const serialized = serializeSnapshot(snapshot);
   if (serialized === lastPushedSharedSnapshot.current) return;
   lastPushedSharedSnapshot.current = serialized;
   accountingApi
    .saveWorkspaceSettings({ settings: snapshot })
    .then((result) => {
     setAppliedSharedVersion(result.version);
     queryClient.setQueryData(queryKeys.workspaceSettings(activeWorkspaceId), result);
    })
    .catch(() => {
     /* best-effort; the next change retries */
    });
  }, 500);
 }

 // Owner toggles workspace-wide sharing. Enabling seeds the shared set from the
 // owner's current settings; disabling leaves everyone's current settings in place.
 async function setWorkspaceSharedSettingsEnabled(enabled: boolean) {
  try {
   const result = await accountingApi.saveWorkspaceSettings(enabled ? { sharedEnabled: true, settings: snapshotSharedSettings() } : { sharedEnabled: false });
   setAppliedSharedVersion(result.version);
   lastPushedSharedSnapshot.current = serializeSnapshot(snapshotSharedSettings());
   queryClient.setQueryData(queryKeys.workspaceSettings(activeWorkspaceId), result);
  } catch (error) {
   setError(error instanceof Error ? error.message : t('error_failed_save'));
  }
 }

 // --- Personal table settings (persisted per user, independent of sharing) --
 // Every user's own layout/display settings (the same snapshot shape as the shared
 // settings above) are saved to the server on every change and re-applied on first
 // load, so they survive a cleared browser or a new device instead of resetting to
 // default — and round-trip through the manual backup like any other workspace data.
 const userTableSettingsQuery = useQuery({
  queryKey: queryKeys.userTableSettings(sessionUserId, activeWorkspaceId),
  queryFn: () => accountingApi.getUserTableSettings(),
  enabled: Boolean(activeWorkspaceId && sessionUserId),
  staleTime: 60_000,
 });
 const userTableSettingsPushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
 const lastPushedUserSnapshot = useRef<string | null>(null);
 const appliedUserSettingsOnce = useRef(false);

 // Apply this user's saved settings once per session, on first load — later local
 // edits are the user's active session and must not be overwritten mid-session.
 useEffect(() => {
  if (appliedUserSettingsOnce.current) return;
  const settings = userTableSettingsQuery.data;
  if (!settings) return;
  appliedUserSettingsOnce.current = true;
  if (Object.keys(settings).length > 0) {
   applySharedSettings(settings);
   hydrateLedgerPrefsFromStorage();
   setTransactionTableSettings(getStoredTransactionTableSettings());
  }
  lastPushedUserSnapshot.current = serializeSnapshot(snapshotSharedSettings());
 }, [userTableSettingsQuery.data, hydrateLedgerPrefsFromStorage, setTransactionTableSettings]);

 // Debounced push of this user's current settings snapshot — always on (unlike the
 // owner-only shared push above), skipped when nothing actually changed.
 function pushUserTableSettings() {
  if (!activeWorkspaceId || !sessionUserId) return;
  if (userTableSettingsPushTimer.current) clearTimeout(userTableSettingsPushTimer.current);
  userTableSettingsPushTimer.current = setTimeout(() => {
   const snapshot = snapshotSharedSettings();
   const serialized = serializeSnapshot(snapshot);
   if (serialized === lastPushedUserSnapshot.current) return;
   lastPushedUserSnapshot.current = serialized;
   accountingApi
    .saveUserTableSettings(snapshot)
    .then(() => {
     queryClient.setQueryData(queryKeys.userTableSettings(sessionUserId, activeWorkspaceId), snapshot);
    })
    .catch(() => {
     /* best-effort; the next change retries */
    });
  }, 500);
 }

 const transactionTableRows = useMemo<TransactionTableRow[]>(
  () => buildTransactionTableRows({ adjustments, clientAccounts, transactions, txSortDir }),
  [adjustments, clientAccounts, transactions, txSortDir],
 );

 useEffect(() => {
  const transactionIds = new Set(transactionTableRows.map((transaction) => transaction.id));
  setSelectedTransactionIds((current) => new Set([...current].filter((id) => transactionIds.has(id))));
  // Keep manualRowOrder in sync: add newly created rows at top, drop deleted rows
  setManualRowOrder((currentOrder) => {
   if (!currentOrder) return null;
   const newIds = transactionTableRows.map((r) => r.id);
   const currentSet = new Set(currentOrder);
   const added = newIds.filter((id) => !currentSet.has(id));
   const kept = currentOrder.filter((id) => transactionIds.has(id));
   return [...added, ...kept];
  });
 }, [transactionTableRows]);

 // Rows in user-defined order (if any), otherwise natural sort order.
 // The Archive section shows only transactions missing a party; the main
 // Transactions section shows everything (including those archived rows).
 const displayedTransactionRows = useMemo<TransactionTableRow[]>(
  () => filterDisplayedTransactionRows({ transactionTableRows, manualRowOrder, section, txFilterSearch, txFilterClient, txFilterDateFrom, txFilterDateTo, txFilterHideExpenses }),
  [transactionTableRows, manualRowOrder, section, txFilterSearch, txFilterClient, txFilterDateFrom, txFilterDateTo, txFilterHideExpenses],
 );

 const txFilterClientOptions = useMemo(() => {
  const names = new Set<string>();
  for (const row of transactionTableRows) {
   if (row.clientFromName) names.add(row.clientFromName);
   if (row.clientToName) names.add(row.clientToName);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
 }, [transactionTableRows]);

 // Per-currency totals across all archived rows (not just the current page), shown at the table foot.
 const archiveCurrencyTotals = useMemo(() => {
  if (section !== 'archive') return [] as Array<{ code: string; symbol: string; total: number }>;
  const totals = new Map<string, { code: string; symbol: string; total: number }>();
  for (const row of displayedTransactionRows) {
   if (!row.amount) continue;
   const key = row.currencyCode || String(row.currencyId);
   const existing = totals.get(key);
   if (existing) existing.total += row.amount;
   else totals.set(key, { code: row.currencyCode, symbol: row.currencySymbol, total: row.amount });
  }
  return [...totals.values()];
 }, [section, displayedTransactionRows]);

 const totalTransactionPages = Math.max(1, Math.ceil(displayedTransactionRows.length / transactionsPageSize));
 const paginatedTransactions = useMemo(() => {
  // Page 1 = oldest, page N = newest. Data is newest-first, so we reverse the slice.
  const clampedPage = Math.max(1, Math.min(transactionsPage, totalTransactionPages));
  const reversedPage = totalTransactionPages - clampedPage + 1;
  const start = (reversedPage - 1) * transactionsPageSize;
  return displayedTransactionRows.slice(start, start + transactionsPageSize);
 }, [displayedTransactionRows, transactionsPage, transactionsPageSize, totalTransactionPages]);

 useEffect(() => {
  setTransactionsPage((current) => Math.min(current, totalTransactionPages));
 }, [totalTransactionPages]);

 useEffect(() => {
  setTransactionsPage(99999);
 }, [txFilterSearch, txFilterClient, txFilterDateFrom, txFilterDateTo, txFilterHideExpenses]);

 useEffect(() => {
  setLedgerPageState({});
 }, [ledgerFilterSearch, ledgerFilterCounterparty, ledgerFilterDateFrom, ledgerFilterDateTo]);

 useEffect(() => {
  if (!transactionForm.currencyId || !transactionForm.accountFromId) return;
  const selectedCurrency = currencies.find((c) => c.id === transactionForm.currencyId);
  const accountFrom = clientAccounts.find((a) => a.id === transactionForm.accountFromId);
  if (!selectedCurrency || !accountFrom) return;
  if (selectedCurrency.code === accountFrom.currencyCode) {
   setTransactionForm((current) => ({ ...current, exchangeRateFrom: '1.00' }));
  } else {
   // Cross-currency: never default to 1 — clear the default so the row stays pending
   // (a dash, excluded from the balance) until the user enters a rate manually.
   setTransactionForm((current) => (current.exchangeRateFrom === '1.00' ? { ...current, exchangeRateFrom: '' } : current));
  }
 }, [transactionForm.currencyId, transactionForm.accountFromId, currencies, clientAccounts]);

 useEffect(() => {
  if (!transactionForm.currencyId || !transactionForm.accountToId) return;
  const selectedCurrency = currencies.find((c) => c.id === transactionForm.currencyId);
  const accountTo = clientAccounts.find((a) => a.id === transactionForm.accountToId);
  if (!selectedCurrency || !accountTo) return;
  if (selectedCurrency.code === accountTo.currencyCode) {
   setTransactionForm((current) => ({ ...current, exchangeRateTo: '1.00' }));
  } else {
   setTransactionForm((current) => (current.exchangeRateTo === '1.00' ? { ...current, exchangeRateTo: '' } : current));
  }
 }, [transactionForm.currencyId, transactionForm.accountToId, currencies, clientAccounts]);

 useEffect(() => {
  if (!transactionForm.chargesCurrencyId || !transactionForm.chargesPayer) return;
  const chargesCur = currencies.find((c) => c.id === transactionForm.chargesCurrencyId);
  const payerAccountId = transactionForm.chargesPayer === 'from' ? transactionForm.accountFromId : transactionForm.chargesPayer === 'to' ? transactionForm.accountToId : null;
  const payerAccount = payerAccountId ? clientAccounts.find((a) => a.id === payerAccountId) : undefined;
  if (chargesCur && payerAccount && chargesCur.code === payerAccount.currencyCode) {
   setTransactionForm((current) => ({ ...current, chargesExchangeRate: '1.00' }));
  }
 }, [transactionForm.chargesCurrencyId, transactionForm.chargesPayer, transactionForm.accountFromId, transactionForm.accountToId, currencies, clientAccounts]);

 function navigateToSection(nextSection: Section) {
  setSection(nextSection);
  if (nextSection === 'client-ledger' || nextSection === 'organization-clients') return;
  router.replace(nextSection === 'overview' ? '/' : `/${nextSection}`);
 }

 function openOrganizationClientsPage(organization: Organization) {
  setSelectedOrganizationForClients(organization);
  setSection('organization-clients');
  router.push(`/organizations/${organization.id}`);
 }

 // Jumps to the Clients tab with the new-client form pre-scoped to this organization,
 // reusing the existing create-client form/submit path unchanged.
 function openAddClientForOrganization(organization: Organization) {
  setClientForm({ ...emptyClientForm(), organizationId: organization.id });
  setOpenAccountOnCreate(true);
  setNewClientAccountDrafts([createNewClientAccountDraft()]);
  navigateToSection('clients');
 }

 function openClientLedger(client: Client, origin: 'clients' | 'organization-clients' = 'clients', accountId?: number | null) {
  setClientLedgerBackSection(origin);
  setLedgerTransactionDrafts({});
  // Start each client's ledger with a clean sum-mode calculator (a running total from the
  // previous client would be meaningless here).
  setLedgerSumMode(false);
  setLedgerSumSelection(new Map());
  setSelectedClientForLedger(client);
  // When a specific account is requested (e.g. clicking a client's USD vs EUR row),
  // preselect it; the ledger-account effect keeps it since it belongs to the client.
  // Otherwise it restores the last-viewed account or defaults to the first.
  if (accountId != null) setSelectedLedgerAccountId(accountId);
  setSection('client-ledger');
  router.push(`/clients/${client.id}`);
 }

 function toggleLedgerColumn(column: LedgerColumnKey) {
  setLedgerColumnVisibility((current) => {
   const next = { ...current, [column]: !current[column] };
   const clientId = selectedClientForLedger?.id;
   if (clientId && typeof window !== 'undefined') {
    window.localStorage.setItem(ledgerColumnVisibilityStorageKeyPrefix + clientId, JSON.stringify(next));
   }
   return next;
  });
  pushSharedSettingsIfOwner();
  pushUserTableSettings();
 }

 // Persist the current client's ledger display settings. `patch` carries the value
 // just changed; the rest come from current state so all three stay in one record.
 function persistLedgerSettings(patch: Partial<StoredLedgerSettings>) {
  const clientId = selectedClientForLedger?.id;
  if (!clientId || typeof window === 'undefined') return;
  const next: StoredLedgerSettings = {
   decimals: ledgerDecimals,
   showCurrencySymbol: showLedgerCurrencySymbol,
   dateFormat: ledgerDateFormat,
   highlightNetChange: ledgerHighlightNetChange,
   netChangeHighlightColor: ledgerNetChangeHighlightColor,
   rowHighlightColor: ledgerRowHighlightColor,
   rowClickHighlight: ledgerRowClickHighlight,
   ...patch,
  };
  window.localStorage.setItem(ledgerSettingsStorageKeyPrefix + clientId, JSON.stringify(next));
  pushSharedSettingsIfOwner();
  pushUserTableSettings();
 }

 function updateLedgerDecimals(next: number) {
  setLedgerDecimals(next);
  persistLedgerSettings({ decimals: next });
 }

 function toggleLedgerCurrencySymbol() {
  const next = !showLedgerCurrencySymbol;
  setShowLedgerCurrencySymbol(next);
  persistLedgerSettings({ showCurrencySymbol: next });
 }

 function updateLedgerDateFormat(next: PdfSettings['dateFormat']) {
  setLedgerDateFormat(next);
  persistLedgerSettings({ dateFormat: next });
 }

 function toggleLedgerHighlightNetChange() {
  const next = !ledgerHighlightNetChange;
  setLedgerHighlightNetChange(next);
  persistLedgerSettings({ highlightNetChange: next });
 }

 function updateLedgerRowHighlightColor(next: string) {
  setLedgerRowHighlightColor(next);
  persistLedgerSettings({ rowHighlightColor: next });
 }

 function updateLedgerNetChangeHighlightColor(next: string) {
  setLedgerNetChangeHighlightColor(next);
  persistLedgerSettings({ netChangeHighlightColor: next });
 }

 // Explicit mode setter for the highlight / copy / none row-click group shown above the table.
 // 'none' disengages both modes for a neutral pointer; picking highlight/copy re-engages and
 // persists which of the two is preferred.
 function setLedgerRowClickMode(mode: 'highlight' | 'copy' | 'none') {
  if (mode === 'none') {
   setLedgerRowClickActive(false);
   return;
  }
  const highlight = mode === 'highlight';
  setLedgerRowClickActive(true);
  setLedgerRowClickHighlight(highlight);
  persistLedgerSettings({ rowClickHighlight: highlight });
 }

 // Toggle a single row's highlight on click; persisted per client so it survives refresh.
 function toggleLedgerRowHighlight(rowKey: string) {
  setHighlightedLedgerRows((current) => {
   const next = new Map(current);
   if (next.has(rowKey)) {
    next.delete(rowKey);
   } else {
    // Store the color active at the moment of the click so future color changes
    // in settings don't retroactively recolor this row.
    next.set(rowKey, ledgerRowHighlightColor);
   }
   const clientId = selectedClientForLedger?.id;
   if (clientId && typeof window !== 'undefined') {
    window.localStorage.setItem(ledgerHighlightsStorageKeyPrefix + clientId, JSON.stringify(Object.fromEntries(next)));
   }
   return next;
  });
 }

 // Explicit mode setter for the highlight / copy / none row-click group shown above the table.
 // 'none' disengages both modes for a neutral pointer; picking highlight/copy re-engages and
 // persists which of the two is preferred.
 function setTxRowClickMode(mode: 'highlight' | 'copy' | 'none') {
  if (mode === 'none') {
   setTxRowClickActive(false);
   return;
  }
  const highlight = mode === 'highlight';
  setTxRowClickActive(true);
  setTxRowClickHighlight(highlight);
  try {
   const stored = JSON.parse(window.localStorage.getItem(txRowSettingsStorageKey) ?? '{}') as Record<string, unknown>;
   window.localStorage.setItem(txRowSettingsStorageKey, JSON.stringify({ ...stored, rowClickHighlight: highlight }));
  } catch {
   /* ignore */
  }
  pushSharedSettingsIfOwner();
  pushUserTableSettings();
 }

 // Sum mode: toggling it off clears whatever was accumulated so the next session starts fresh.
 function toggleTxSumMode() {
  setTxSumMode((on) => {
   if (on) setTxSumSelection(new Map());
   return !on;
  });
 }

 // Add the clicked amount to the running total, or remove it if it was already added.
 function toggleTxSumEntry(id: number, amount: number, currencyCode: string, currencySymbol: string) {
  setTxSumSelection((prev) => {
   const next = new Map(prev);
   if (next.has(id)) next.delete(id);
   else next.set(id, { amount, currencyCode, currencySymbol });
   return next;
  });
 }

 function toggleTxRowHighlight(txnId: number) {
  setHighlightedTxRows((current) => {
   const next = new Map(current);
   if (next.has(txnId)) {
    next.delete(txnId);
   } else {
    next.set(txnId, txRowHighlightColor);
   }
   try {
    window.localStorage.setItem(txHighlightsStorageKey, JSON.stringify(Object.fromEntries(next)));
   } catch {
    /* ignore */
   }
   return next;
  });
 }

 function updateTxRowHighlightColor(next: string) {
  setTxRowHighlightColor(next);
  try {
   const stored = JSON.parse(window.localStorage.getItem(txRowSettingsStorageKey) ?? '{}') as Record<string, unknown>;
   window.localStorage.setItem(txRowSettingsStorageKey, JSON.stringify({ ...stored, rowHighlightColor: next }));
  } catch {
   /* ignore */
  }
  pushSharedSettingsIfOwner();
  pushUserTableSettings();
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

 // Apply a transaction update to local state immediately so edits appear instantly,
 // re-resolving the derived display fields (client names, currency code/symbol) from the
 // current account/currency maps. A background loadData() later reconciles with the server.
 function applyTransactionPatch(input: TransactionUpdateInput) {
  const fromAccount = input.accountFromId != null ? clientAccountMap.get(input.accountFromId) : undefined;
  const toAccount = input.accountToId != null ? clientAccountMap.get(input.accountToId) : undefined;
  const currency = currencyMap.get(input.currencyId);
  const chargesCurrency = input.chargesCurrencyId != null ? currencyMap.get(input.chargesCurrencyId) : null;
  setTransactions((prev) =>
   prev.map((tx) =>
    tx.id === input.id
     ? {
        ...tx,
        accountFromId: input.accountFromId,
        accountToId: input.accountToId,
        clientFromName: fromAccount?.clientName ?? tx.clientFromName,
        accountFromCurrencyCode: fromAccount?.currencyCode ?? tx.accountFromCurrencyCode,
        accountFromCurrencySymbol: fromAccount?.currencySymbol ?? tx.accountFromCurrencySymbol,
        clientToName: toAccount?.clientName ?? tx.clientToName,
        accountToCurrencyCode: toAccount?.currencyCode ?? tx.accountToCurrencyCode,
        accountToCurrencySymbol: toAccount?.currencySymbol ?? tx.accountToCurrencySymbol,
        currencyId: input.currencyId,
        currencyCode: currency?.code ?? tx.currencyCode,
        currencySymbol: currency?.symbol ?? tx.currencySymbol,
        amount: input.amount,
        type: input.type,
        exchangeRateFrom: input.exchangeRateFrom,
        commissionFrom: input.commissionFrom,
        exchangeRateTo: input.exchangeRateTo,
        commissionTo: input.commissionTo,
        exchangeRateFromReversed: input.exchangeRateFromReversed ?? tx.exchangeRateFromReversed,
        exchangeRateToReversed: input.exchangeRateToReversed ?? tx.exchangeRateToReversed,
        charges: input.charges,
        chargesCurrencyId: input.chargesCurrencyId,
        chargesCurrencyCode: chargesCurrency?.code ?? null,
        chargesCurrencySymbol: chargesCurrency?.symbol ?? null,
        chargesPayer: input.chargesPayer,
        chargesExchangeRate: input.chargesExchangeRate,
        chargesDescription: input.chargesDescription,
        description: input.description,
        archiveNote: input.archiveNote ?? tx.archiveNote,
        createdAt: input.createdAt,
       }
     : tx,
   ),
  );
 }

 // Same idea for an adjustment row edited from the transaction table.
 function applyAdjustmentPatch(input: ClientAdjustment) {
  setAdjustments((prev) => prev.map((adjustment) => (adjustment.id === input.id ? { ...adjustment, ...input } : adjustment)));
 }

 // Returns whether the save actually succeeded, so callers only exit edit mode /
 // discard the draft on success — otherwise a validation or API failure would be
 // silently swallowed and the row would revert as if nothing had been typed.
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
  const originalCounterpartyId = draft.direction === 'outgoing' ? transaction.accountToId : transaction.accountFromId;
  if ((originalCounterpartyId != null && !draft.counterpartyAccountId) || !amount || draft.currencyId == null) {
   setError(t('transaction_required'));
   return false;
  }

  const createdAt = resolveCreatedAt(draft.createdDate, transaction.createdAt);
  const payload: TransactionUpdateInput = {
   id: transaction.id,
   accountFromId: draft.direction === 'outgoing' ? draft.ledgerAccountId : draft.counterpartyAccountId,
   accountToId: draft.direction === 'outgoing' ? draft.counterpartyAccountId : draft.ledgerAccountId,
   currencyId: draft.currencyId,
   amount,
   type: draft.type,
   exchangeRateFrom: draft.direction === 'outgoing' ? exchangeRate : transaction.exchangeRateFrom,
   commissionFrom: draft.direction === 'outgoing' ? commission : transaction.commissionFrom,
   exchangeRateTo: draft.direction === 'incoming' ? exchangeRate : transaction.exchangeRateTo,
   commissionTo: draft.direction === 'incoming' ? commission : transaction.commissionTo,
   exchangeRateFromReversed: draft.direction === 'outgoing' ? (rateIsReversed ? 1 : 0) : (transaction.exchangeRateFromReversed ?? 0),
   exchangeRateToReversed: draft.direction === 'incoming' ? (rateIsReversed ? 1 : 0) : (transaction.exchangeRateToReversed ?? 0),
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

 // Puts a single ledger row into inline-edit mode (builds its draft + seeds the
 // reversed-rate flag). Shared by the row's Edit (pencil) button and the arrow-key
 // "save and move to next row" flow below.
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

 // Arrow left/right while editing a row's amount / exchange rate / commission: move to the
 // neighbouring editable cell in the same row, in the currently visible column order. Only
 // triggers at the start (left) or end (right) of the field's text so the caret can still be
 // moved within the value normally. The fields themselves are always dir="ltr" (numeric), so
 // the caret's start/end doesn't flip in RTL — but the column layout is visually mirrored, so
 // which physical key ("→") maps to "next column" does flip.
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

 // Arrow up/down while editing a row's amount / exchange rate / commission: move to the
 // adjacent row in the same field. If that row isn't being edited yet (single-row edit),
 // save the current row first and open the neighbour for editing; if it's already open
 // (e.g. "edit all" mode) just move the caret. `pagedEntries` is the exact rendered order.
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

 // Marks one ledger row as reconciled with the client at its running balance. The
 // captured balance + row (createdAt, id) become a lock line protecting earlier rows.
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

 async function onOrganizationSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  if (!accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  if (!organizationForm.name.trim()) {
   setError(t('organization_required'));
   return;
  }

  try {
   if (organizationForm.id) {
    await accountingApi.updateOrganization(organizationForm);
   } else {
    await accountingApi.createOrganization(organizationForm);
   }

   setOrganizationForm(emptyOrganizationForm());
   setError('');
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_update'));
  }
 }

 async function onCreateOrgFromDialog(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  if (!accountingApi || !organizationForm.name.trim()) {
   setOrgDialogError(t('organization_required'));
   return;
  }
  const newName = organizationForm.name.trim();
  setIsSavingOrg(true);
  setOrgDialogError('');
  try {
   await accountingApi.createOrganization(organizationForm);
   await loadData();
   // Auto-select the newly created org in whichever form opened the dialog.
   setOrganizations((freshOrgs) => {
    const newOrg = freshOrgs.find((o) => o.name === newName);
    if (newOrg) {
     if (orgDialogTargetReviewKey) {
      updateImportReviewEntry(orgDialogTargetReviewKey, { organizationId: newOrg.id });
     } else {
      setClientForm((current) => ({ ...current, organizationId: newOrg.id }));
     }
    }
    return freshOrgs;
   });
   setOrganizationForm(emptyOrganizationForm());
   setShowCreateOrgDialog(false);
   setOrgDialogTargetReviewKey(null);
  } catch (e) {
   setOrgDialogError(e instanceof Error ? e.message : t('error_failed_save'));
  } finally {
   setIsSavingOrg(false);
  }
 }

 async function onClientSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  // Guard against a rapid double-submit creating a duplicate (button disabled may not have
  // re-rendered yet). Cleared in the finally below.
  if (clientSubmitLock.current) return;
  if (!accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  if (!clientForm.name.trim()) {
   setError(t('client_required'));
   return;
  }

  // Reject a name already used by another client (case/whitespace-insensitive).
  const nameKey = clientForm.name.trim().replace(/\s+/g, ' ').toLowerCase();
  const duplicateName = clients.some((client) => client.id !== clientForm.id && client.name.trim().replace(/\s+/g, ' ').toLowerCase() === nameKey);
  if (duplicateName) {
   setError(t('client_name_duplicate'));
   return;
  }

  if (!clientForm.id && openAccountOnCreate) {
   if (!newClientAccountDrafts.length || newClientAccountDrafts.some((draft) => !draft.currencyId)) {
    setError(t('client_account_currency_placeholder'));
    return;
   }

   const selectedCurrencyIds = newClientAccountDrafts.map((draft) => draft.currencyId).filter((currencyId): currencyId is number => Boolean(currencyId));
   if (new Set(selectedCurrencyIds).size !== selectedCurrencyIds.length) {
    setError('Choose a different currency for each account.');
    return;
   }
  }

  clientSubmitLock.current = true;
  setIsSubmittingClient(true);
  try {
   if (clientForm.id) {
    await accountingApi.updateClient(clientForm);
   } else {
    const created = await accountingApi.createClient(clientForm);
    if (openAccountOnCreate) {
     for (const draft of newClientAccountDrafts) {
      if (!draft.currencyId) {
       continue;
      }

      await accountingApi.createClientAccount({
       clientId: created.clientId,
       currencyId: draft.currencyId,
       startingBalance: (() => {
        const abs = Math.abs(parseFloat(draft.startingBalance.replace(/,/g, '')) || 0);
        return draft.balanceType === 'debit' ? -abs : abs;
       })(),
      });
     }
    }
   }

   const wasCreate = !clientForm.id;
   setClientForm(emptyClientForm());
   setOpenAccountOnCreate(true);
   setNewClientAccountDrafts([createNewClientAccountDraft()]);
   setError('');
   if (wasCreate) showToast(t('toast_client_created'));
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_update'));
  } finally {
   clientSubmitLock.current = false;
   setIsSubmittingClient(false);
  }
 }

 async function onDeleteOrganization(id: number) {
  if (!accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  if (!(await confirmDialog({ message: t('organization_delete_confirm'), confirmText: t('delete'), tone: 'danger' }))) {
   return;
  }

  try {
   await accountingApi.deleteOrganization(id);
   if (organizationForm.id === id) {
    setOrganizationForm(emptyOrganizationForm());
   }
   if (selectedOrganizationForClients?.id === id) {
    setSelectedOrganizationForClients(null);
    navigateToSection('organizations');
   }
   if (clientForm.organizationId === id) {
    setClientForm((current) => ({ ...current, organizationId: null }));
   }
   setError('');
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_delete'));
  }
 }

 async function onDeleteClient(id: number) {
  if (!accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  if (!(await confirmDialog({ message: t('client_delete_confirm'), confirmText: t('delete'), tone: 'danger' }))) {
   return;
  }

  try {
   await accountingApi.deleteClient(id);
   if (clientForm.id === id) {
    setClientForm(emptyClientForm());
   }
   if (selectedClientForAccounts?.id === id) {
    setSelectedClientForAccounts(null);
   }
   if (selectedClientForLedger?.id === id) {
    setSelectedClientForLedger(null);
    navigateToSection('clients');
   }
   setError('');
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_delete'));
  }
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

 async function onDeleteAllClients() {
  if (!accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  if (!clients.length) {
   setError(t('no_clients'));
   return;
  }

  const firstConfirm = await confirmDialog({
   title: t('danger_action_cannot_undo'),
   message: t('danger_delete_all_clients_confirm'),
   confirmText: t('delete'),
   tone: 'danger',
  });
  if (!firstConfirm) {
   return;
  }

  try {
   await accountingApi.deleteAllClients();
   setClientForm(emptyClientForm());
   setSelectedClientForAccounts(null);
   setSelectedClientForLedger(null);
   setSelectedLedgerAccountId(null);
   setSelectedTransactionIds(new Set());
   setTransactionTableDrafts({});
   setCommissionExpandedTxns(new Set());
   setExpensesExpandedTxns(new Set());
   setError('');
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_delete'));
  }
 }

 async function onDownloadBackup() {
  if (!accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  setIsBackingUp(true);
  try {
   const backup = await accountingApi.exportWorkspaceData();
   const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
   const url = URL.createObjectURL(blob);
   const link = document.createElement('a');
   link.href = url;
   link.download = `arkam_backup_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
   document.body.appendChild(link);
   link.click();
   document.body.removeChild(link);
   URL.revokeObjectURL(url);
   // Stamp the backup server-side so the indicator syncs to every device.
   try {
    const recorded = await accountingApi.recordBackup(getDeviceLabel());
    setLastBackupAt(recorded.lastBackupAt);
    setLastBackupDevice(recorded.lastBackupDevice);
   } catch {
    // Download already succeeded; a failed stamp is non-fatal.
    setLastBackupAt(new Date().toISOString());
    setLastBackupDevice(getDeviceLabel());
   }
   setError('');
   setImportSummary(t('backup_download_success'));
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_save'));
  } finally {
   setIsBackingUp(false);
  }
 }

 async function onRestoreBackupFile(event: ChangeEvent<HTMLInputElement>) {
  const file = event.target.files?.[0];
  if (backupRestoreInputRef.current) backupRestoreInputRef.current.value = '';
  if (!file) return;

  if (!accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  const confirmed = await confirmDialog({
   title: t('danger_action_cannot_undo'),
   message: t('backup_restore_confirm'),
   tone: 'danger',
  });
  if (!confirmed) return;

  setIsRestoringBackup(true);
  try {
   const text = await file.text();
   let parsed: unknown;
   try {
    parsed = JSON.parse(text);
   } catch {
    throw new Error(t('backup_restore_invalid_file'));
   }

   if (!parsed || typeof parsed !== 'object' || (parsed as { format?: string }).format !== 'arkam-backup') {
    throw new Error(t('backup_restore_invalid_file'));
   }

   await accountingApi.importWorkspaceData(parsed as Parameters<typeof accountingApi.importWorkspaceData>[0]);
   setSelectedTransactionIds(new Set());
   setTransactionTableDrafts({});
   setCommissionExpandedTxns(new Set());
   setExpensesExpandedTxns(new Set());
   setClientForm(emptyClientForm());
   setSelectedClientForAccounts(null);
   setSelectedClientForLedger(null);
   setSelectedLedgerAccountId(null);
   setTransactionsPage(99999);
   setError('');
   await loadData();
   setImportSummary(t('backup_restore_success'));
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_save'));
  } finally {
   setIsRestoringBackup(false);
  }
 }

 // Localized "Last backup: 2 days ago" style label, or a "never" message.
 function lastBackupLabel(): string {
  if (!lastBackupAt) return t('backup_last_never');

  const then = new Date(lastBackupAt).getTime();
  if (Number.isNaN(then)) return t('backup_last_never');

  const diffMs = Date.now() - then;
  const minutes = Math.round(diffMs / 60000);
  const hours = Math.round(diffMs / 3600000);
  const days = Math.round(diffMs / 86400000);

  const exact = new Date(lastBackupAt).toLocaleString(language, {
   year: 'numeric',
   month: 'short',
   day: 'numeric',
   hour: '2-digit',
   minute: '2-digit',
   second: '2-digit',
  });

  let relative: string;
  try {
   const rtf = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
   if (Math.abs(days) >= 1) relative = rtf.format(-days, 'day');
   else if (Math.abs(hours) >= 1) relative = rtf.format(-hours, 'hour');
   else if (Math.abs(minutes) >= 1) relative = rtf.format(-minutes, 'minute');
   else relative = rtf.format(0, 'minute');
  } catch {
   relative = exact;
  }

  const time = `${relative} (${exact})`;
  if (lastBackupDevice) {
   return t('backup_last_device').replace('{time}', time).replace('{device}', lastBackupDevice);
  }
  return t('backup_last_label').replace('{time}', time);
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
  // A new entry lands at the end of its date's sequence (top of the table / bottom of the
  // ledger), after any same-day rows the user manually reordered.
  const newTransactionCreatedAt = nextCreatedAtForDate(newTransactionDate);

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
   createdAt: newTransactionCreatedAt,
  };

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

 // Builds the per-client review list from the mapped sheet so the user can
 // rename clients and assign organizations before anything is created.
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
     await accountingApi.updateClientAdjustment({
      id: draft.adjustmentId,
      accountId: draft.accountFromId,
      amount,
      direction: draft.adjustmentDirection ?? 'debit',
      currencyId: draft.currencyId,
      currencyCode: selectedCurrency?.code || account?.currencyCode || '',
      currencySymbol: selectedCurrency?.symbol || account?.currencySymbol || '',
      exchangeRate: tableRateFromReversed[transactionId] ? 1 / (parseFloat(draft.exchangeRateFrom) || 1) : parseFloat(draft.exchangeRateFrom) || 1,
      exchangeRateReversed: !!tableRateFromReversed[transactionId],
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
    date: new Date().toISOString().slice(0, 10),
   });
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
  const createdAt = existingAdj ? resolveCreatedAt(adjustmentModal.date, existingAdj.createdAt) : nextCreatedAtForDate(adjustmentModal.date);

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

 // Reverses a delete by recreating the row from its captured snapshot, on the exact
 // same createdAt so it lands back in the same spot. New DB id (hard delete leaves
 // nothing to restore by id); a reconciliation mark on the old id would not carry over.
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

 // Shared field mapping from a stored transaction/table-row to a createTransaction
 // payload (same shape createTransaction expects) — used by both duplicate and undo,
 // which differ only in which createdAt they pass in.
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
   createdAt,
  };
 }

 // One-click zero-out for a small (negligible) account balance: creates a single
 // adjustment for the exact remaining amount, in the account's own currency, so no
 // exchange rate is needed. Direction is the inverse of the balance's sign since a
 // positive balance means the client owes us (needs a debit adjustment to net to 0).
 async function onWriteOffBalance(accountId: number, balance: number) {
  if (!accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  const amount = Math.abs(balance);
  if (amount <= 0) return;

  const account = clientAccounts.find((a) => a.id === accountId);
  const client = account ? clients.find((c) => c.id === account.clientId) : undefined;
  if (!account || !client) return;

  const confirmed = await confirmDialog({
   title: t('write_off_confirm_title'),
   message: t('write_off_confirm_message')
    .replace('{amount}', amount.toLocaleString(numLocale, { maximumFractionDigits: 2 }))
    .replace('{currency}', account.currencySymbol || account.currencyCode)
    .replace('{name}', client.name),
   confirmText: t('write_off_confirm_button'),
   tone: 'danger',
  });
  if (!confirmed) return;

  try {
   await accountingApi.createClientAdjustment({
    accountId,
    amount,
    direction: balance > 0 ? 'debit' : 'credit',
    currencyId: account.currencyId,
    currencyCode: account.currencyCode,
    currencySymbol: account.currencySymbol,
    exchangeRate: 1,
    exchangeRateReversed: false,
    description: t('write_off_description'),
    createdAt: nextCreatedAtForDate(new Date().toISOString().slice(0, 10)),
   });
   setError('');
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_save'));
  }
 }

 // Mid-table write-off: zeroes the running balance AT a specific ledger row by inserting a
 // write-off adjustment immediately after it (later rows then continue from zero). Same
 // mechanism as onWriteOffBalance, but the amount is this row's running balance and the
 // adjustment is time-placed to land right after the row instead of at the account's end.
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
  // they differ), so it sorts right after this row in the ledger.
  const ledger = selectedClientLedgers.find((l) => l.accountId === ledgerAccountId);
  const entries = ledger?.entries ?? [];
  const idx = entries.findIndex((e) => e.transactionId === entry.transactionId);
  const nextEntry = idx >= 0 ? entries[idx + 1] : undefined;
  const targetMs = Date.parse(entry.createdAt);
  let createdAt = entry.createdAt;
  if (nextEntry) {
   const nextMs = Date.parse(nextEntry.createdAt);
   if (nextMs > targetMs) createdAt = new Date(targetMs + Math.min(1000, Math.floor((nextMs - targetMs) / 2))).toISOString();
  }

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

 async function onDeleteTransactionTableRow(row: TransactionTableRow) {
  if (row.isAdjustment && row.adjustmentId) {
   await onDeleteAdjustment(row.adjustmentId);
   return;
  }

  await onDeleteTransaction(row.id);
 }

 // Creates an exact copy of a row (same accounts/amount/rates/charges/description) dated
 // on the same day as the original, landing right after it in that day's sequence — same
 // logic new rows always use (nextCreatedAtForDate), just seeded with the original's date
 // instead of "today".
 async function onDuplicateTransactionRow(row: TransactionTableRow) {
  if (!accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  const createdAt = nextCreatedAtForDate(row.createdAt.slice(0, 10));

  try {
   if (row.isAdjustment) {
    const adjPayload = {
     accountId: row.accountFromId as number,
     amount: row.amount,
     direction: row.adjustmentDirection ?? ('debit' as const),
     currencyId: row.currencyId,
     currencyCode: row.currencyCode,
     currencySymbol: row.currencySymbol,
     exchangeRate: row.exchangeRateFrom,
     exchangeRateReversed: !!row.exchangeRateFromReversed,
     description: row.description,
     createdAt,
    };
    if (!(await confirmIfLocked([adjPayload.accountId], adjPayload.createdAt, NEW_ROW_REF_ID))) return;
    await accountingApi.createClientAdjustment(adjPayload);
   } else {
    const txPayload = buildTransactionCreatePayload(row, createdAt);
    if (!row.isArchived && !(await confirmIfLocked([txPayload.accountFromId, txPayload.accountToId], txPayload.createdAt, NEW_ROW_REF_ID))) return;
    await accountingApi.createTransaction(txPayload);
   }
   setError('');
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_save'));
  }
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

 function onCopySelectedTransaction(e: React.MouseEvent) {
  const ids = [...selectedTransactionIds];
  if (ids.length !== 1) return;
  const row = transactionTableRowMap.get(ids[0]);
  if (row) {
   setCopiedTransaction(row);
   // Unmark the row once copied: the selection toolbar collapses and the row is free to be
   // re-selected, so a follow-up copy/paste doesn't act on a stale marking.
   setSelectedTransactionIds(new Set());
   showToast(t('toast_copied'), e);
  }
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
  });
  setTxSplitDescription(!isAdjustment && Boolean(row.descriptionFrom?.trim() || row.descriptionTo?.trim()));
  setTxFromRateReversed(fromReversed);
  setTxToRateReversed(toReversed);
  setTxFromQuery('');
  setTxToQuery('');
  setIsNewTransactionExpensesOpen(true);
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
  let dropLockHit: { accountId: number; boundary: { balance: number } } | null = null;
  for (const draggedId of draggedIds) {
   const draggedRow = rowMap.get(draggedId);
   if (!draggedRow) continue;
   const pos = next.indexOf(draggedId);
   const neighborAbove = (() => { for (let i = pos - 1; i >= 0; i--) { if (!dragSet.has(next[i])) return rowMap.get(next[i]); } })();
   const neighborBelow = (() => { for (let i = pos + 1; i < next.length; i++) { if (!dragSet.has(next[i])) return rowMap.get(next[i]); } })();
   const zoneDate = (neighborAbove ?? neighborBelow)?.createdAt.slice(0, 10);
   const draggedDate = draggedRow.createdAt.slice(0, 10);
   const newCreatedAt = !zoneDate || zoneDate === draggedDate ? draggedRow.createdAt : zoneDate + draggedRow.createdAt.slice(10);
   const accIds = draggedRow.isAdjustment ? [draggedRow.accountFromId] : [draggedRow.accountFromId, draggedRow.accountToId];
   const refId = draggedRow.isAdjustment ? draggedRow.adjustmentId ?? 0 : draggedRow.id;
   dropLockHit = violatedLock(accIds, draggedRow.createdAt, refId, lockBoundaries) ?? violatedLock(accIds, newCreatedAt, refId, lockBoundaries);
   if (dropLockHit) break;
  }
  if (dropLockHit && !(await confirmDialog({ title: t('reconcile_warn_title'), message: t('reconcile_warn_message', { balance: formatLockBalance(dropLockHit.accountId, dropLockHit.boundary.balance) }), confirmText: t('reconcile_warn_confirm'), tone: 'danger' }))) {
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

  // Reconciliation guard: reordering rows at or before the lock line rewrites reconciled history.
  const reorderRows = next.flatMap((k) => {
   const e = entryMap.get(k);
   if (!e) return [];
   return [{ createdAt: e.createdAt, refId: e.isAdjustment ? e.adjustmentId ?? 0 : e.transactionId, newCreatedAt: newTimes.get(k) ?? e.createdAt }];
  });
  if (!(await confirmIfReorderLocked(accountId, reorderRows))) return;

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

 // Places a newly created transaction/adjustment strictly after every existing row on
 // `dateStr`, so it lands at the END of that date's sequence: the top of the descending
 // transactions table and the bottom of the ascending client ledger. This keeps a new
 // entry with today's date at the very top even when other same-day rows were manually
 // drag-reordered (which rewrites their timestamps across the day).
 function nextCreatedAtForDate(dateStr: string): string {
  const dayStart = Date.parse(`${dateStr}T00:00:00.000Z`);
  const dayEnd = Date.parse(`${dateStr}T23:59:59.999Z`);
  let maxEpoch = dayStart;
  for (const tx of transactions) {
   if (tx.createdAt.slice(0, 10) === dateStr) {
    const e = Date.parse(tx.createdAt);
    if (Number.isFinite(e)) maxEpoch = Math.max(maxEpoch, e);
   }
  }
  for (const adj of adjustments) {
   if (adj.createdAt.slice(0, 10) === dateStr) {
    const e = Date.parse(adj.createdAt);
    if (Number.isFinite(e)) maxEpoch = Math.max(maxEpoch, e);
   }
  }
  const next = Math.min(maxEpoch + 1000, dayEnd);
  return new Date(next).toISOString();
 }

 function resolveCreatedAt(draftDate: string, originalCreatedAt: string): string {
  const originalDate = originalCreatedAt.slice(0, 10);
  if (draftDate === originalDate) {
   // Date unchanged — preserve the exact original timestamp so sort order never changes
   return originalCreatedAt;
  }
  // User changed the date — keep the original time component
  const sep = originalCreatedAt.includes('T') ? 'T' : ' ';
  const timePart = originalCreatedAt.includes(sep) ? originalCreatedAt.split(sep)[1] : '00:00:00';
  return `${draftDate} ${timePart}`;
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

   const adjustmentPayload: ClientAdjustment = {
    id: draft.adjustmentId,
    accountId: draft.accountFromId,
    amount,
    direction: draft.adjustmentDirection ?? 'debit',
    currencyId: draft.currencyId,
    currencyCode: selectedCurrency?.code || account?.currencyCode || '',
    currencySymbol: selectedCurrency?.symbol || account?.currencySymbol || '',
    exchangeRate: tableRateFromReversed[transactionId] ? 1 / (parseFloat(draft.exchangeRateFrom) || 1) : parseFloat(draft.exchangeRateFrom) || 1,
    exchangeRateReversed: !!tableRateFromReversed[transactionId],
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

  const transactionPayload: TransactionUpdateInput = {
   id: transaction.id,
   accountFromId: draft.accountFromId,
   accountToId: draft.accountToId,
   currencyId: draft.currencyId,
   amount,
   type: draft.type,
   exchangeRateFrom: tableRateFromReversed[transactionId] ? 1 / (parseFloat(draft.exchangeRateFrom) || 1) : parseFloat(draft.exchangeRateFrom) || 1,
   commissionFrom: parseFloat(draft.commissionFrom) || 0,
   exchangeRateTo: tableRateToReversed[transactionId] ? 1 / (parseFloat(draft.exchangeRateTo) || 1) : parseFloat(draft.exchangeRateTo) || 1,
   commissionTo: parseFloat(draft.commissionTo) || 0,
   exchangeRateFromReversed: tableRateFromReversed[transactionId] ? 1 : 0,
   exchangeRateToReversed: tableRateToReversed[transactionId] ? 1 : 0,
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

 async function onAddClientAccount(clientId: number) {
  if (!accountingApi || !newAccountCurrencyId) return;
  try {
   const abs = Math.abs(parseFloat(newAccountStartingBalance.replace(/,/g, '')) || 0);
   const startingBalance = newAccountBalanceType === 'debit' ? -abs : abs;
   await accountingApi.createClientAccount({ clientId, currencyId: newAccountCurrencyId, startingBalance });
   setNewAccountCurrencyId(null);
   setNewAccountStartingBalance('0');
   setNewAccountBalanceType('debit');
   setShowAddAccountForm(false);
   await loadData();
   // Re-sync selectedClientForAccounts with updated client data
   setSelectedClientForAccounts((prev) => (prev ? { ...prev } : null));
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_save'));
  }
 }

 async function onSaveEditAccount() {
  if (!accountingApi || !editingAccountId || !editingAccountCurrencyId) return;
  const accountId = editingAccountId;
  const currencyId = editingAccountCurrencyId;
  try {
   const abs = Math.abs(parseFloat(editingAccountBalance.replace(/,/g, '')) || 0);
   const startingBalance = editingAccountBalanceType === 'debit' ? -abs : abs;
   await accountingApi.updateClientAccount({ accountId, currencyId, startingBalance });
   setEditingAccountId(null);
   const currency = currencyMap.get(currencyId);
   setClientAccounts((prev) =>
    prev.map((account) =>
     account.id === accountId
      ? { ...account, currencyId, startingBalance, currencyCode: currency?.code ?? account.currencyCode, currencySymbol: currency?.symbol ?? account.currencySymbol }
      : account,
    ),
   );
   void loadData();
   setSelectedClientForAccounts((prev) => (prev ? { ...prev } : null));
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_save'));
  }
 }

 async function onDeleteClientAccount(accountId: number) {
  if (!accountingApi) return;
  if (!(await confirmDialog({ message: t('client_account_delete_confirm'), confirmText: t('delete'), tone: 'danger' }))) return;
  try {
   await accountingApi.deleteClientAccount(accountId);
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_delete'));
  }
 }

 async function onMoveAccountTransactions(fromAccountId: number) {
  if (!accountingApi || !moveTargetAccountId || moveTargetAccountId === fromAccountId) return;
  const target = clientAccountMap.get(moveTargetAccountId);
  const targetLabel = target ? `${target.clientName} · ${target.currencyCode}` : '';
  if (!(await confirmDialog({ message: t('client_account_move_confirm', { target: targetLabel }), confirmText: t('client_account_move_action') }))) return;
  setIsMovingAccount(true);
  try {
   await accountingApi.moveAccountTransactions({ fromAccountId, toAccountId: moveTargetAccountId });
   setMoveTargetAccountId(null);
   setEditingAccountId(null);
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_save'));
  } finally {
   setIsMovingAccount(false);
  }
 }

 async function onUpdateAccountStartingBalance(accountId: number, value: string) {
  if (!accountingApi) return;
  const startingBalance = parseFloat(value) || 0;
  try {
   await accountingApi.updateClientAccountStartingBalance({ accountId, startingBalance });
   setClientAccounts((prev) => prev.map((account) => (account.id === accountId ? { ...account, startingBalance } : account)));
   void loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_save'));
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


 // Excel counterpart to onExportLedgerPdf: same selected-range/column logic, but each
 // entry's already-computed `runningBalance` is the correct absolute balance at that row
 // (computeClientLedgers accumulates it across the whole ledger), so no pre-balance
 // recomputation is needed here — unlike the PDF, which recomputes it to show as a
 // separate pre-balance line above the table.
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
    { key: 'type', header: t('transaction_type'), cell: (e) => (e.isAdjustment ? t('adjustment_label') : t(e.type === 'transfer' ? 'transaction_type_transfer' : 'transaction_type_exchange')) },
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

 async function onExportArchivePdf() {
  if (!accountingApi) return;
  try {
   const html = generateArchiveHtml({ t, numLocale, isRTL, language, pdfSettings }, displayedTransactionRows, transactionTableSettings.columns);
   const exportDate = new Date().toISOString().slice(0, 10);
   const result = await accountingApi.exportLedgerPdf({ html, defaultFileName: `archive_${exportDate}.pdf` });
   if (!result.ok) setError(t('error_failed_save'));
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_save'));
  }
 }

 async function onExportOverviewPdf(cards: OverviewPdfCard[], mainCode: string, mainSymbol: string) {
  if (!accountingApi || cards.length === 0) return;
  try {
   const html = generateOverviewCardsHtml({ t, numLocale, isRTL, language, pdfSettings }, { cards, mainCode, mainSymbol });
   const exportDate = new Date().toISOString().slice(0, 10);
   const result = await accountingApi.exportLedgerPdf({ html, defaultFileName: `overview_${exportDate}.pdf` });
   if (!result.ok) setError(t('error_failed_save'));
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_save'));
  }
 }

 const navItems: Array<{ key: Section; label: string; icon: IconName }> = [
  { key: 'overview', label: t('nav_overview'), icon: 'home' },
  { key: 'organizations', label: t('nav_organizations'), icon: 'organizations' },
  { key: 'clients', label: t('nav_clients'), icon: 'clients' },
  { key: 'currencies', label: t('nav_currencies'), icon: 'currencies' },
  { key: 'transactions', label: t('nav_transactions'), icon: 'transactions' },
  { key: 'archive', label: t('nav_archive'), icon: 'archive' },
  { key: 'live-rates', label: t('nav_live_rates'), icon: 'rates' },
 ];

 // Editors (workspace role 'member') don't get destructive/billing controls.
 const currentWorkspaceRole = userWorkspaces.find((workspace) => workspace.id === activeWorkspaceId)?.role ?? '';
 const isEditorRole = currentWorkspaceRole === 'member';

 const settingsTabs: Array<{ key: SettingsTab; label: string; icon: IconName }> = [
  { key: 'account', label: t('account_title'), icon: 'auth' },
  { key: 'team', label: t('team_title'), icon: 'clients' },
  { key: 'database', label: t('settings_database_title'), icon: 'database' },
  { key: 'language', label: t('settings_language_title'), icon: 'settings' },
  { key: 'pdf', label: t('settings_pdf_title'), icon: 'settings' },
  { key: 'clients', label: t('nav_clients'), icon: 'clients' },
  { key: 'organizations', label: t('nav_organizations'), icon: 'organizations' },
  { key: 'currencies', label: t('nav_currencies'), icon: 'currencies' },
  ...(isEditorRole ? [] : [{ key: 'danger' as const, label: t('settings_danger_title'), icon: 'settings' as IconName }]),
 ];

 const getLocalizedCurrencyName = (currencyCode: string, fallbackName: string) => {
  try {
   if (typeof Intl.DisplayNames === 'function') {
    return new Intl.DisplayNames([language], { type: 'currency' }).of(currencyCode) || fallbackName || currencyCode;
   }
  } catch {
   // ignore and fall back to the stored name
  }

  return fallbackName || currencyCode;
 };

 const localizedCurrencies = useMemo(
  () =>
   currencies.map((currency) => ({
    ...currency,
    name: getLocalizedCurrencyName(currency.code, currency.name),
   })),
  [currencies, language],
 );
 const enabledCurrencies = useMemo(() => localizedCurrencies.filter((currency) => currency.isEnabled === 1), [localizedCurrencies]);
 const currencyMap = useMemo(() => new Map(localizedCurrencies.map((currency) => [currency.id, currency])), [localizedCurrencies]);
 const sortedClients = useMemo(() => sortAndFilterClients({ clients, clientSort, clientSearch, language }), [clients, clientSort, clientSearch, language]);
 const totalClientPages = Math.max(1, Math.ceil(sortedClients.length / clientsPageSize));
 const clampedClientsPage = Math.min(clientsPage, totalClientPages);
 const paginatedClients = useMemo(() => {
  const start = (clampedClientsPage - 1) * clientsPageSize;
  return sortedClients.slice(start, start + clientsPageSize);
 }, [sortedClients, clampedClientsPage, clientsPageSize]);
 // Clients grouped per organization for the card view; respects the active
 // search/sort (built from sortedClients) and lists clients with no organization last.
 const clientsByOrganization = useMemo(() => groupClientsByOrganization({ sortedClients, clientsOrgOrder, language, t }), [sortedClients, language, t, clientsOrgOrder]);

 // Drop a dragged organization card before the target card and persist the new order.
 function onClientsOrgDrop(targetKey: string) {
  const dragged = draggedOrgKey;
  setDraggedOrgKey(null);
  setDragOverOrgKey(null);
  if (!dragged || dragged === targetKey) return;
  const keys = clientsByOrganization.map((group) => (group.id == null ? '__unassigned__' : String(group.id)));
  const from = keys.indexOf(dragged);
  const to = keys.indexOf(targetKey);
  if (from === -1 || to === -1) return;
  const next = [...keys];
  next.splice(from, 1);
  next.splice(to, 0, dragged);
  setClientsOrgOrder(next);
  if (typeof window !== 'undefined') {
   window.localStorage.setItem(clientsOrgOrderStorageKey, JSON.stringify(next));
  }
 }

 // Jump back to the first page whenever the result set changes (search / sort / page size).
 useEffect(() => {
  setClientsPage(1);
 }, [clientSearch, clientSort, clientsPageSize]);
 const toggleClientSort = useCallback((key: 'name' | 'organization') => {
  setClientSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
 }, []);
 const showToast = useAppStatusStore((s) => s.showToast);
 const clientAccountMap = useMemo(() => new Map(clientAccounts.map((account) => [account.id, account])), [clientAccounts]);

 // Newest reconciliation per client account = the lock line used by the guards below.
 const lockBoundaries = useMemo(() => buildLockBoundaries(reconciliations), [reconciliations]);

 // Formats a reconciled balance for dialogs, e.g. "$100,553.00".
 function formatLockBalance(accountId: number, balance: number): string {
  const symbol = clientAccountMap.get(accountId)?.currencySymbol ?? '';
  return `${symbol}${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
 }

 /**
  * Guard shared by all four dangerous operations. `accountIds` are the accounts a
  * change touches (a transaction hits both from & to); `createdAt`/`refId` locate
  * the affected row (pass NEW_ROW_REF_ID for a not-yet-created transaction). Returns
  * true to proceed — either nothing is locked, or the user confirmed the warning.
  */
 async function confirmIfLocked(accountIds: Array<number | null | undefined>, createdAt: string, refId: number): Promise<boolean> {
  const hit = violatedLock(accountIds, createdAt, refId, lockBoundaries);
  if (!hit) return true;
  return confirmDialog({
   title: t('reconcile_warn_title'),
   message: t('reconcile_warn_message', { balance: formatLockBalance(hit.accountId, hit.boundary.balance) }),
   confirmText: t('reconcile_warn_confirm'),
   tone: 'danger',
  });
 }

 /**
  * Reorder variant of the guard: warns if any reflowed row sits at or before an
  * account's lock line, either at its current timestamp or the one the drag assigns.
  * Returns true to proceed.
  */
 async function confirmIfReorderLocked(accountId: number, rows: Array<{ createdAt: string; refId: number; newCreatedAt: string }>): Promise<boolean> {
  const boundary = lockBoundaries.get(accountId);
  if (!boundary) return true;
  const touches = rows.some((r) => isAtOrBeforeBoundary(r.createdAt, r.refId, boundary) || isAtOrBeforeBoundary(r.newCreatedAt, r.refId, boundary));
  if (!touches) return true;
  return confirmDialog({
   title: t('reconcile_warn_title'),
   message: t('reconcile_warn_message', { balance: formatLockBalance(accountId, boundary.balance) }),
   confirmText: t('reconcile_warn_confirm'),
   tone: 'danger',
  });
 }

 /**
  * Delete confirmation that folds in the reconciliation guard: if the row is at or
  * before a lock line it shows the lock warning, otherwise the normal delete prompt —
  * one dialog either way. Returns true to proceed.
  */
 async function confirmDeleteWithLock(accountIds: Array<number | null | undefined>, createdAt: string, refId: number, fallbackMessageKey: string): Promise<boolean> {
  const hit = violatedLock(accountIds, createdAt, refId, lockBoundaries);
  if (hit) {
   return confirmDialog({
    title: t('reconcile_warn_title'),
    message: t('reconcile_warn_message', { balance: formatLockBalance(hit.accountId, hit.boundary.balance) }),
    confirmText: t('reconcile_warn_confirm'),
    tone: 'danger',
   });
  }
  return confirmDialog({ message: t(fallbackMessageKey), confirmText: t('delete'), tone: 'danger' });
 }

 /**
  * Edit guard: warns if a row is locked either where it is now (old position) or where
  * the edit would move it (new position) — covers re-dating and amount changes on or
  * near reconciled history. Returns true to proceed.
  */
 async function confirmIfEditLocked(oldAccountIds: Array<number | null | undefined>, oldCreatedAt: string, newAccountIds: Array<number | null | undefined>, newCreatedAt: string, refId: number): Promise<boolean> {
  const hit = violatedLock(oldAccountIds, oldCreatedAt, refId, lockBoundaries) ?? violatedLock(newAccountIds, newCreatedAt, refId, lockBoundaries);
  if (!hit) return true;
  return confirmDialog({
   title: t('reconcile_warn_title'),
   message: t('reconcile_warn_message', { balance: formatLockBalance(hit.accountId, hit.boundary.balance) }),
   confirmText: t('reconcile_warn_confirm'),
   tone: 'danger',
  });
 }

 /**
  * Two-sided edit guard for a transaction (the ledger-row/table-row edit save paths).
  * Unlike confirmIfEditLocked, this only checks the lock on a SIDE (from/to account) whose
  * own balance the edit could actually change — e.g. editing only the "from" side's
  * exchange rate never affects the "to" account's ledger, so the "to" account's lock (even
  * if reconciled) is not checked and no warning appears. A side counts as affected if its
  * account changed, the shared date changed (reorders both ledgers), or its computed net
  * change actually differs. Returns true to proceed.
  */
 async function confirmIfTransactionEditLocked(oldTx: Transaction, newPayload: TransactionUpdateInput): Promise<boolean> {
  const dateChanged = new Date(oldTx.createdAt).getTime() !== new Date(newPayload.createdAt).getTime();
  const accountIdsToCheck: number[] = [];
  for (const side of ['from', 'to'] as const) {
   const oldAccountId = side === 'from' ? oldTx.accountFromId : oldTx.accountToId;
   const newAccountId = side === 'from' ? newPayload.accountFromId : newPayload.accountToId;
   const oldAccount = oldAccountId != null ? clientAccountMap.get(oldAccountId) : undefined;
   const newAccount = newAccountId != null ? clientAccountMap.get(newAccountId) : undefined;
   const oldNetChange = oldAccountId != null && oldAccount ? computeTransactionSideNetChange(oldTx, oldAccount.currencyId, side) : 0;
   const newNetChange = newAccountId != null && newAccount ? computeTransactionSideNetChange(newPayload, newAccount.currencyId, side) : 0;
   const affected = oldAccountId !== newAccountId || dateChanged || Math.abs(oldNetChange - newNetChange) > 1e-9;
   if (!affected) continue;
   if (oldAccountId != null) accountIdsToCheck.push(oldAccountId);
   if (newAccountId != null) accountIdsToCheck.push(newAccountId);
  }
  if (accountIdsToCheck.length === 0) return true;
  const hit = violatedLock(accountIdsToCheck, oldTx.createdAt, oldTx.id, lockBoundaries) ?? violatedLock(accountIdsToCheck, newPayload.createdAt, oldTx.id, lockBoundaries);
  if (!hit) return true;
  return confirmDialog({
   title: t('reconcile_warn_title'),
   message: t('reconcile_warn_message', { balance: formatLockBalance(hit.accountId, hit.boundary.balance) }),
   confirmText: t('reconcile_warn_confirm'),
   tone: 'danger',
  });
 }

 // Per-client balances for the clients list/group view. Keyed by clientId, each value is
 // an array of { accountId, currencyCode, currencySymbol, balance } — one entry per account.
 const clientPageBalances = useMemo(
  () => computeClientPageBalances({ clientAccounts, transactions, adjustments }),
  [clientAccounts, transactions, adjustments],
 );

 const transactionMap = useMemo(() => new Map(transactions.map((transaction) => [transaction.id, transaction])), [transactions]);
 const transactionTableRowMap = useMemo(() => new Map(transactionTableRows.map((transaction) => [transaction.id, transaction])), [transactionTableRows]);

 // Sum of the checkbox-selected transaction-table rows, grouped per currency so mixed-currency
 // selections show one total each. Shown next to the bulk actions when 2+ rows are selected.
 const selectedTransactionSums = useMemo(() => {
  if (selectedTransactionIds.size < 2) return [] as Array<{ code: string; symbol: string; total: number }>;
  const byCurrency = new Map<string, { code: string; symbol: string; total: number }>();
  for (const id of selectedTransactionIds) {
   const row = transactionTableRowMap.get(id);
   if (!row) continue;
   const code = row.currencyCode || '';
   const existing = byCurrency.get(code) ?? { code, symbol: row.currencySymbol || '', total: 0 };
   existing.total += row.amount;
   byCurrency.set(code, existing);
  }
  return [...byCurrency.values()].sort((a, b) => a.code.localeCompare(b.code));
 }, [selectedTransactionIds, transactionTableRowMap]);

 // Sum-mode running total, grouped per currency so clicking amounts across different
 // currencies shows one box each instead of adding incompatible currencies together.
 const txSumByCurrency = useMemo(() => {
  const byCurrency = new Map<string, { code: string; symbol: string; total: number; count: number }>();
  for (const entry of txSumSelection.values()) {
   const code = entry.currencyCode || '';
   const existing = byCurrency.get(code) ?? { code, symbol: entry.currencySymbol || '', total: 0, count: 0 };
   existing.total += entry.amount;
   existing.count += 1;
   byCurrency.set(code, existing);
  }
  return [...byCurrency.values()].sort((a, b) => a.code.localeCompare(b.code));
 }, [txSumSelection]);
 const selectedOrganizationClients = useMemo(
  () => (selectedOrganizationForClients ? clients.filter((client) => client.organizationId === selectedOrganizationForClients.id) : []),
  [clients, selectedOrganizationForClients],
 );

 const isAdjustmentTransaction = section !== 'archive' && transactionForm.type === 'adjustment';
 const transactionSelectedCurrencyCode = transactionForm.currencyId ? currencyMap.get(transactionForm.currencyId)?.code : undefined;
 const transactionAccountFromCurrencyCode = transactionForm.accountFromId ? clientAccountMap.get(transactionForm.accountFromId)?.currencyCode : undefined;
 const transactionAccountToCurrencyCode = transactionForm.accountToId ? clientAccountMap.get(transactionForm.accountToId)?.currencyCode : undefined;
 const showExchangeRateFrom = !(transactionSelectedCurrencyCode && transactionAccountFromCurrencyCode && transactionSelectedCurrencyCode === transactionAccountFromCurrencyCode);
 const showExchangeRateTo = !(transactionSelectedCurrencyCode && transactionAccountToCurrencyCode && transactionSelectedCurrencyCode === transactionAccountToCurrencyCode);

 const chargesCurrencyCode = transactionForm.chargesCurrencyId ? currencyMap.get(transactionForm.chargesCurrencyId)?.code : undefined;
 const chargesPayerAccountCurrencyCode =
  transactionForm.chargesPayer === 'from' ? transactionAccountFromCurrencyCode : transactionForm.chargesPayer === 'to' ? transactionAccountToCurrencyCode : undefined;
 const showChargesExchangeRate = !!(chargesCurrencyCode && chargesPayerAccountCurrencyCode && chargesCurrencyCode !== chargesPayerAccountCurrencyCode);

 const updateTransactionTableSettings = (updater: (current: TransactionTableSettings) => TransactionTableSettings) => {
  setTransactionTableSettings((current) => {
   const next = updater(current);
   saveTransactionTableSettings(next);
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
  saveTransactionTableSettings(transactionTableSettingsDraft);
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

 // Builds the rows/headers for the transactions export, honouring the date range
 // and the currently visible columns so the export matches what the user sees.
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

 const visibleTransactionColumnCount = Object.values(transactionTableSettings.columns).filter(Boolean).length + 2; // +1 actions col, +1 checkbox col

 const selectedClientLedgers: ClientAccountLedger[] = useMemo(
  () => computeClientLedgers({ selectedClientForLedger, section, pdfExportModal, clientAccounts, transactions, adjustments, reconciliations, clientAccountMap, currencyMap }),
  [adjustments, reconciliations, clientAccounts, clientAccountMap, currencyMap, pdfExportModal, section, selectedClientForLedger, transactions],
 );

 const renderLedgerCurrencySuffix = (currencySymbol: string, currencyCode: string) => {
  if (!showLedgerCurrencySymbol) {
   return '';
  }

  return ` ${currencySymbol || currencyCode}`;
 };

 const selectedClientTransactionCount = useMemo(() => selectedClientLedgers.reduce((sum, ledger) => sum + ledger.transactionCount, 0), [selectedClientLedgers]);

 const ledgerColumnOptions: Array<{ key: LedgerColumnKey; label: string }> = [
  { key: 'created', label: t('created') },
  { key: 'counterparty', label: t('counterparty') },
  { key: 'direction', label: t('direction') },
  { key: 'type', label: t('transaction_type') },
  { key: 'amount', label: t('transaction_amount') },
  { key: 'currency', label: t('currency') },
  { key: 'exchangeRate', label: t('transaction_exchange_rate') },
  { key: 'commission', label: t('commission') },
  { key: 'netChange', label: t('net_change') },
  { key: 'runningBalance', label: t('running_balance') },
  { key: 'description', label: t('transaction_description') },
 ];
 const orderedLedgerColumnOptions = ledgerColumnOrder
  .map((key) => ledgerColumnOptions.find((column) => column.key === key))
  .filter((column): column is { key: LedgerColumnKey; label: string } => Boolean(column));

 const transactionsPager = (() => {
  if (transactionTableRows.length === 0) return null;
  const clampedPage = Math.max(1, Math.min(transactionsPage, totalTransactionPages));
  // Derive the displayed row-range in "oldest-first" numbering:
  // page 1 = oldest chunk, page N = newest chunk.
  const reversedPage = totalTransactionPages - clampedPage + 1;
  const chunkStart = (reversedPage - 1) * transactionsPageSize; // 0-indexed into newest-first array
  const chunkEnd = Math.min(displayedTransactionRows.length, chunkStart + transactionsPageSize);
  const totalRows = displayedTransactionRows.length;
  // Row numbers in oldest-first order:
  const fromRow = totalRows - chunkEnd + 1;
  const toRow = totalRows - chunkStart;
  return (
   <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
    <div className="text-xs text-slate-600">
     {fromRow}–{toRow} {t('pagination_of')} {totalRows}
    </div>
    <div className="flex flex-wrap items-center gap-1.5">
     <span className="text-xs text-slate-500">{t('pagination_per_page')}</span>
     <select
      value={transactionsPageSize}
      onChange={(event) => {
       const nextSize = Number(event.target.value);
       setTransactionsPageSize(nextSize);
       setTransactionsPage(99999);
      }}
      className="rounded border border-slate-300 px-1.5 py-1 text-xs outline-none ring-blue-300 focus:ring"
     >
      <option value={50}>50</option>
      <option value={100}>100</option>
      <option value={250}>250</option>
     </select>
     <button
      type="button"
      onClick={() => setTransactionsPage((current) => Math.max(1, Math.min(current, totalTransactionPages) - 1))}
      disabled={clampedPage <= 1}
      className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
     >
      {t('pagination_prev')}
     </button>
     <input
      key={clampedPage}
      type="number"
      min={1}
      max={totalTransactionPages}
      defaultValue={clampedPage}
      onBlur={(event) => {
       const n = parseInt(event.target.value, 10);
       if (n >= 1 && n <= totalTransactionPages) setTransactionsPage(n);
       else event.target.value = String(clampedPage);
      }}
      onKeyDown={(event) => {
       if (event.key === 'Enter') event.currentTarget.blur();
      }}
      className="w-14 rounded border border-slate-300 px-1.5 py-1 text-center text-xs outline-none ring-blue-300 focus:ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
     />
     <span className="text-xs text-slate-500">/ {totalTransactionPages}</span>
     <button
      type="button"
      onClick={() => setTransactionsPage((current) => Math.min(totalTransactionPages, Math.min(current, totalTransactionPages) + 1))}
      disabled={clampedPage >= totalTransactionPages}
      className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
     >
      {t('pagination_next')}
     </button>
    </div>
   </div>
  );
 })();
 const sectionMeta: Record<Section, { title: string; description: string; accent: string }> = {
  overview: {
   title: t('nav_overview'),
   description: t('overview_description'),
   accent: `${enabledCurrencies.length} ${t('overview_currencies')}`,
  },
  settings: {
   title: t('settings_title'),
   description: t('settings_description'),
   accent: settingsTabs.find((item) => item.key === settingsTab)?.label ?? t('settings_title'),
  },
  organizations: {
   title: t('organizations_title'),
   description: t('organizations_description'),
   accent: `${organizations.length} ${t('nav_organizations')}`,
  },
  'organization-clients': {
   title: selectedOrganizationForClients?.name ?? t('organization_page_title'),
   description: selectedOrganizationForClients ? t('organization_page_description') : t('organization_page_no_organization'),
   accent: `${selectedOrganizationClients.length} ${t('overview_clients')}`,
  },
  clients: {
   title: t('clients_title'),
   description: t('clients_description'),
   accent: `${clients.length} ${t('nav_clients')}`,
  },
  'client-ledger': {
   title: selectedClientForLedger?.name ?? t('client_page_title'),
   description: selectedClientForLedger ? t('client_page_description') : t('client_page_no_client'),
   accent: `${selectedClientTransactionCount} ${t('client_page_transaction_count')}`,
  },
  currencies: {
   title: t('currencies_title'),
   description: t('currencies_description'),
   accent: `${enabledCurrencies.length} ${t('nav_currencies')}`,
  },
  transactions: {
   title: t('transactions_title'),
   description: t('transactions_description'),
   accent: `${transactions.length} ${t('nav_transactions')}`,
  },
  archive: {
   title: t('archive_title'),
   description: t('archive_description'),
   accent: `${transactions.filter((tx) => tx.isArchived || !tx.accountFromId || !tx.accountToId).length} ${t('nav_archive')}`,
  },
  'live-rates': {
   title: t('live_rates_title'),
   description: t('live_rates_description'),
   accent: t('nav_live_rates'),
  },
 };

 const activeSectionMeta = sectionMeta[section];

 const shellMetrics = [
  { label: t('overview_clients'), value: clients.length },
  { label: t('overview_transactions'), value: transactions.length },
  { label: t('overview_currencies'), value: enabledCurrencies.length },
 ];

 // The sidebar always shows the main navigation. The Settings entry expands its
 // sub-tabs in place (rendered after this list) rather than replacing the whole sidebar.
 const sidebarItems: Array<{ id: string; label: string; icon: IconName; isActive: boolean; onClick: () => void }> = navItems.map((item) => ({
  id: item.key,
  label: item.label,
  icon: item.icon,
  isActive: section === item.key,
  onClick: () => navigateToSection(item.key),
 }));


 const pdfAllColumns: { key: LedgerColumnKey; label: string }[] = [
  { key: 'created', label: t('date') },
  { key: 'counterparty', label: t('counterparty') },
  { key: 'direction', label: t('direction') },
  { key: 'type', label: t('transaction_type') },
  { key: 'amount', label: t('amount') },
  { key: 'currency', label: t('currency') },
  { key: 'exchangeRate', label: t('exchange_rate') },
  { key: 'commission', label: t('commission') },
  { key: 'netChange', label: t('net_change') },
  { key: 'runningBalance', label: t('running_balance') },
  { key: 'description', label: t('transaction_description') },
 ];

 const clientSortHeader = (key: 'name' | 'organization', label: string) => {
  const active = clientSort.key === key;
  return (
   <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>
    <button
     type="button"
     onClick={() => toggleClientSort(key)}
     title={t('sort_by', { field: label })}
     className={`inline-flex items-center gap-1.5 font-semibold transition hover:text-blue-700 ${active ? 'text-blue-700' : 'text-slate-700'}`}
    >
     <span>{label}</span>
     {active ? (
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
       {clientSort.dir === 'asc' ? <polyline points="6 15 12 9 18 15" /> : <polyline points="6 9 12 15 18 9" />}
      </svg>
     ) : (
      <svg
       width="13"
       height="13"
       viewBox="0 0 24 24"
       fill="none"
       stroke="currentColor"
       strokeWidth="2"
       strokeLinecap="round"
       strokeLinejoin="round"
       className="text-slate-300"
       aria-hidden
      >
       <polyline points="8 9 12 5 16 9" />
       <polyline points="16 15 12 19 8 15" />
      </svg>
     )}
    </button>
   </th>
  );
 };

 // The account editor is shown for the client currently open in the update form.
 const accountsClient = clientForm.id ? (clients.find((c) => c.id === clientForm.id) ?? null) : null;




 const settingsSection = (
  <section className="flex flex-col gap-0">
   {/* Settings section header */}
   <div className="border-b-2 border-blue-800 bg-white px-5 py-4">
    <div className="flex items-center gap-3">
     <span className="inline-flex h-8 w-8 items-center justify-center rounded bg-blue-800 text-white">{renderIcon('settings', 'h-4 w-4')}</span>
     <div>
      <h2 className="text-base font-bold text-gray-900">{t('settings_title')}</h2>
      <p className="text-xs text-gray-500">{t('settings_description')}</p>
     </div>
    </div>
    {/* Tab strip */}
    <div className="mt-4 flex flex-wrap gap-0 border-b border-gray-200 -mb-px">
     {settingsTabs.map((tab) => {
      const isActive = settingsTab === tab.key;
      return (
       <button
        key={tab.key}
        type="button"
        onClick={() => setSettingsTab(tab.key)}
        className={`inline-flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition ${
         isActive ? 'border-blue-700 text-blue-700' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
        }`}
       >
        {renderIcon(tab.icon, 'h-4 w-4')}
        {tab.label}
       </button>
      );
     })}
    </div>
   </div>
   {/* Active tab content */}
   <div className="flex flex-col gap-4 p-4">
    {error ? <div className="rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div> : null}
    {importSummary ? (
     <div className="flex items-start justify-between gap-3 rounded border border-green-300 bg-green-50 px-4 py-2 text-sm text-green-800">
      <span>{importSummary}</span>
      <button
       type="button"
       onClick={() => setImportSummary('')}
       aria-label={t('close')}
       title={t('close')}
       className="-mr-1 shrink-0 rounded p-0.5 text-green-700 transition hover:bg-green-100 hover:text-green-900"
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
        <path d="M18 6 6 18M6 6l12 12" />
       </svg>
      </button>
     </div>
    ) : null}
    {settingsTab === 'account' ? <AccountSettings hideSubscription={isEditorRole} /> : null}
    {settingsTab === 'team' ? (
     <div className="flex flex-col gap-6">
      <TeamSettings />
      {isWorkspaceOwner ? (
       <div className={panelClassName}>
        <div className="flex items-start justify-between gap-4">
         <div>
          <h3 className="text-lg font-semibold">{t('shared_settings_title')}</h3>
          <p className="mt-1 text-sm text-slate-600">{t('shared_settings_description')}</p>
         </div>
         <button
          type="button"
          role="switch"
          aria-checked={sharedSettingsEnabled}
          onClick={() => setWorkspaceSharedSettingsEnabled(!sharedSettingsEnabled)}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${sharedSettingsEnabled ? 'bg-blue-600' : 'bg-slate-300'}`}
         >
          <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${sharedSettingsEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
         </button>
        </div>
        {sharedSettingsEnabled ? <p className="mt-3 text-xs text-slate-500">{t('shared_settings_active_hint')}</p> : null}
       </div>
      ) : null}
     </div>
    ) : null}
    {settingsTab === 'database' ? (
     <DatabaseSettings
      isBackingUp={isBackingUp}
      isRestoringBackup={isRestoringBackup}
      backupRestoreInputRef={backupRestoreInputRef}
      lastBackupAt={lastBackupAt}
      lastBackupLabel={lastBackupLabel}
      onDownloadBackup={onDownloadBackup}
      onRestoreBackupFile={onRestoreBackupFile}
     />
    ) : null}
    {settingsTab === 'language' ? <LanguageSettings /> : null}
    {settingsTab === 'pdf' ? <PdfSettingsTab /> : null}
    {settingsTab === 'danger' && !isEditorRole ? (
     <DangerZone
      transactionCount={transactions.length}
      clientCount={clients.length}
      onDeleteAllTransactions={onDeleteAllTransactions}
      onDeleteAllClients={onDeleteAllClients}
     />
    ) : null}
    {settingsTab === 'clients' ? (
     <ClientsSection
      clients={clients}
      organizations={organizations}
      clientAccounts={clientAccounts}
      enabledCurrencies={enabledCurrencies}
      sortedClients={sortedClients}
      paginatedClients={paginatedClients}
      clampedClientsPage={clampedClientsPage}
      totalClientPages={totalClientPages}
      accountsClient={accountsClient}
      clientSortHeader={clientSortHeader}
      onClientSubmit={onClientSubmit}
      isSubmittingClient={isSubmittingClient}
      onDeleteClient={onDeleteClient}
      onAddClientAccount={onAddClientAccount}
      onDeleteClientAccount={onDeleteClientAccount}
      onMoveAccountTransactions={onMoveAccountTransactions}
      onSaveEditAccount={onSaveEditAccount}
      openClientLedger={openClientLedger}
      setShowCreateOrgDialog={setShowCreateOrgDialog}
      setOrganizationForm={setOrganizationForm}
     />
    ) : null}
    {settingsTab === 'organizations' ? (
     <OrganizationsSection
      organizations={organizations}
      organizationForm={organizationForm}
      setOrganizationForm={setOrganizationForm}
      onOrganizationSubmit={onOrganizationSubmit}
      onDeleteOrganization={onDeleteOrganization}
      openOrganizationClientsPage={openOrganizationClientsPage}
     />
    ) : null}
    {settingsTab === 'currencies' ? (
     <CurrenciesSection
      localizedCurrencies={localizedCurrencies}
      enabledCurrencies={enabledCurrencies}
      clientAccounts={clientAccounts}
      transactions={transactions}
     />
    ) : null}
   </div>
  </section>
 );

 return (
  <div className={`min-h-screen flex bg-gray-100 text-gray-900 ${isRTL ? 'rtl' : 'ltr'}`}>
   <main className="flex w-full">
    {/* Classic sidebar - desktop only */}
    <Sidebar
     sidebarItems={sidebarItems}
     isSidebarCollapsed={isSidebarCollapsed}
     setIsSidebarCollapsed={setIsSidebarCollapsed}
     userWorkspaces={userWorkspaces}
     activeWorkspaceId={activeWorkspaceId}
     onSwitchWorkspace={onSwitchWorkspace}
     navigateToSection={navigateToSection}
     settingsTab={settingsTab}
     setSettingsTab={setSettingsTab}
     settingsTabs={settingsTabs}
     section={section}
    />

    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
     <AppHeader sidebarItems={sidebarItems} section={section} navigateToSection={navigateToSection} activeSectionMeta={activeSectionMeta} shellMetrics={shellMetrics} />

     {showSubscriptionBanner ? (
      <div className="flex items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800">
       <span>
        {subscriptionDaysLeft !== null && subscriptionDaysLeft <= 0
         ? t('subscription_banner_expired')
         : t('subscription_banner_expiring', { days: subscriptionDaysLeft ?? 0 })}
       </span>
       <div className="flex shrink-0 items-center gap-3">
        <button
         type="button"
         onClick={() => {
          setSettingsTab('account');
          navigateToSection('settings');
         }}
         className="rounded border border-amber-400 bg-white px-3 py-1 text-xs font-semibold text-amber-800 transition hover:bg-amber-100"
        >
         {t('subscription_banner_renew')}
        </button>
        <button
         type="button"
         onClick={dismissSubscriptionBanner}
         aria-label={t('close')}
         title={t('close')}
         className="rounded p-0.5 text-amber-700 transition hover:bg-amber-100 hover:text-amber-900"
        >
         <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M18 6 6 18M6 6l12 12" />
         </svg>
        </button>
       </div>
      </div>
     ) : null}

     {/* Settings: full-width, no outer padding */}
     {section === 'settings' ? settingsSection : null}

     {section !== 'settings' ? (
      <div className="flex flex-col gap-4 p-4">
       {error ? (
        <div className="flex items-start justify-between gap-3 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
         <span>{error}</span>
         <button
          type="button"
          onClick={() => setError('')}
          aria-label={t('close')}
          title={t('close')}
          className="-mr-1 shrink-0 rounded p-0.5 text-red-600 transition hover:bg-red-100 hover:text-red-900"
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
           <path d="M18 6 6 18M6 6l12 12" />
          </svg>
         </button>
        </div>
       ) : null}
       {importSummary ? (
        <div className="flex items-start justify-between gap-3 rounded border border-green-300 bg-green-50 px-4 py-2 text-sm text-green-800">
         <span>{importSummary}</span>
         <button
          type="button"
          onClick={() => setImportSummary('')}
          aria-label={t('close')}
          title={t('close')}
          className="-mr-1 shrink-0 rounded p-0.5 text-green-700 transition hover:bg-green-100 hover:text-green-900"
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
           <path d="M18 6 6 18M6 6l12 12" />
          </svg>
         </button>
        </div>
       ) : null}

       {/* Daily archived-count notice (no dismiss button): resets each day and only
           shows while there are transactions archived on the current day. */}
       {section === 'archive' || section === 'transactions'
        ? (() => {
           const today = new Date().toISOString().slice(0, 10);
           const archivedToday = transactions.filter((tx) => tx.isArchived && tx.createdAt.slice(0, 10) === today).length;
           if (archivedToday === 0) return null;
           return (
            <div className="flex items-center gap-2 rounded border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800">
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
             {t('archive_today_notice', { count: archivedToday })}
            </div>
           );
          })()
        : null}

       {section === 'overview' ? (
        <OverviewSection
         organizations={organizations}
         clients={clients}
         clientAccounts={clientAccounts}
         currencies={currencies}
         transactions={transactions}
         adjustments={adjustments}
         isLoading={isLoading}
         navigateToSection={navigateToSection}
         onExportOverviewPdf={onExportOverviewPdf}
        />
       ) : null}

       {section === 'organizations' && isLoading ? (
        <div className={panelClassName}>
         <div className="mb-4 flex items-center justify-between gap-4">
          <SkBar
           w="w-44"
           h="h-6"
          />
          <SkBar
           w="w-28"
           h="h-8"
          />
         </div>
         <div className="flex flex-col gap-2 mt-2">
          {Array.from({ length: 5 }, (_, i) => (
           <div
            key={i}
            className="flex items-center gap-3 py-2"
           >
            <SkBar
             w="w-40"
             h="h-4"
            />
            <SkBar
             w="w-12"
             h="h-4"
            />
           </div>
          ))}
         </div>
        </div>
       ) : null}
       {section === 'organizations' && !isLoading ? (
        <OrganizationsReadOnly
         organizations={organizations}
         clients={clients}
         clientAccounts={clientAccounts}
         transactions={transactions}
         adjustments={adjustments}
         currencies={currencies}
         openOrganizationClientsPage={openOrganizationClientsPage}
         onOpenSettings={() => {
          setSettingsTab('organizations');
          navigateToSection('settings');
         }}
        />
       ) : null}

       {section === 'organization-clients' && isLoading ? (
        <div className={panelClassName}>
         <div className="mb-4 flex items-center justify-between gap-4">
          <SkBar
           w="w-52"
           h="h-6"
          />
          <SkBar
           w="w-28"
           h="h-8"
          />
         </div>
         <SkTablePanel
          panelClassName=""
          tableWrapClassName="border border-gray-200"
          cols={SK_CLIENTS}
          rows={6}
         />
        </div>
       ) : null}
       {section === 'organization-clients' && !isLoading ? (
        <section className="flex flex-col gap-6">
         <div className={panelClassName}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
           <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">{t('organization_page_title')}</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">{selectedOrganizationForClients?.name ?? t('organizations_title')}</h2>
            <p className="mt-2 text-sm text-slate-600">{selectedOrganizationForClients ? t('organization_page_description') : t('organization_page_no_organization')}</p>
           </div>

           <div className="flex shrink-0 gap-2">
            {selectedOrganizationForClients ? (
             <button
              type="button"
              onClick={() => openAddClientForOrganization(selectedOrganizationForClients)}
              className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
             >
              {t('organization_add_client')}
             </button>
            ) : null}
            <button
             type="button"
             onClick={() => navigateToSection('organizations')}
             className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
             {t('organization_page_back')}
            </button>
           </div>
          </div>

          {selectedOrganizationForClients ? (
           <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className={mutedPanelClassName}>
             <p className="text-sm text-slate-500">{t('organizations_title')}</p>
             <p className="mt-2 text-lg font-semibold text-slate-900">{selectedOrganizationForClients.name}</p>
            </div>
            <div className={mutedPanelClassName}>
             <p className="text-sm text-slate-500">{t('overview_clients')}</p>
             <p className="mt-2 text-lg font-semibold text-slate-900">{selectedOrganizationClients.length}</p>
            </div>
            <div className={mutedPanelClassName}>
             <p className="text-sm text-slate-500">{t('client_accounts')}</p>
             <p className="mt-2 text-lg font-semibold text-slate-900">{selectedOrganizationClients.reduce((sum, client) => sum + client.accountCount, 0)}</p>
            </div>
           </div>
          ) : null}
         </div>

         {!selectedOrganizationForClients ? (
          <div className={`${panelClassName} text-sm text-slate-600`}>{t('organization_page_no_organization')}</div>
         ) : selectedOrganizationClients.length === 0 ? (
          <div className={`${panelClassName} text-sm text-slate-600`}>{t('organization_page_no_clients')}</div>
         ) : (
          <div className={panelClassName}>
           <h3 className="text-xl font-semibold text-slate-900">{t('organization_clients_title')}</h3>
           <div className={tableWrapClassName}>
            <table className="w-full text-sm">
             <thead className="bg-slate-100 text-slate-700">
              <tr>
               <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('name')}</th>
               <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('client_accounts')}</th>
               <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('balance')}</th>
              </tr>
             </thead>
             <tbody>
              {selectedOrganizationClients.map((client) => (
               <tr
                key={client.id}
                className="border-t border-slate-200 align-top"
               >
                <td className="px-4 py-3 font-medium text-slate-900">
                 <a
                  href={`/clients/${client.id}`}
                  onClick={(e) => {
                   if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
                   e.preventDefault();
                   openClientLedger(client, 'organization-clients');
                  }}
                  className="cursor-pointer text-left text-slate-900 transition hover:text-blue-700"
                 >
                  {client.name}
                 </a>
                </td>
                <td className="px-4 py-3 text-slate-600">{client.accountCount}</td>
                <td className="px-4 py-3">
                 <div className="flex flex-wrap gap-1">
                  {(clientPageBalances.get(client.id) ?? []).map((entry) => (
                   <span
                    key={entry.accountId}
                    className={`rounded px-1.5 py-0.5 font-mono text-xs font-semibold ${entry.balance >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}
                   >
                    {entry.currencySymbol || entry.currencyCode} {entry.balance.toLocaleString(numLocale, { maximumFractionDigits: 0 })}
                   </span>
                  ))}
                 </div>
                </td>
               </tr>
              ))}
             </tbody>
            </table>
           </div>
          </div>
         )}
        </section>
       ) : null}

       {section === 'clients' && isLoading ? (
        <SkTablePanel
         panelClassName={panelClassName}
         tableWrapClassName={tableWrapClassName}
         cols={SK_CLIENTS}
         titleWidth="w-32"
         rows={8}
        />
       ) : null}
       {section === 'clients' && !isLoading ? (
        <ClientsReadOnly
         clients={clients}
         clientAccounts={clientAccounts}
         sortedClients={sortedClients}
         clientsByOrganization={clientsByOrganization}
         clientPageBalances={clientPageBalances}
         clientSortHeader={clientSortHeader}
         openClientLedger={openClientLedger}
         onClientsOrgDrop={onClientsOrgDrop}
         navigateToSection={navigateToSection}
         setSettingsTab={setSettingsTab}
         selectedClientForAccounts={selectedClientForAccounts}
         setSelectedClientForAccounts={setSelectedClientForAccounts}
         onWriteOffBalance={onWriteOffBalance}
        />
       ) : null}

       {section === 'client-ledger' ? (
        <LedgerSection
         isLoading={isLoading}
         clients={clients}
         clientAccounts={clientAccounts}
         currencyMap={currencyMap}
         enabledCurrencies={enabledCurrencies}
         organizations={organizations}
         selectedClientForLedger={selectedClientForLedger}
         selectedLedgerAccountId={selectedLedgerAccountId}
         setSelectedLedgerAccountId={setSelectedLedgerAccountId}
         selectedOrganizationForClients={selectedOrganizationForClients}
         selectedClientLedgers={selectedClientLedgers}
         orderedLedgerColumnOptions={orderedLedgerColumnOptions}
         ledgerHistory={ledgerHistory}
         getClientLedgerDraft={getClientLedgerDraft}
         updateLedgerTransactionDraft={updateLedgerTransactionDraft}
         renderLedgerCurrencySuffix={renderLedgerCurrencySuffix}
         onCancelAllLedger={onCancelAllLedger}
         onDeleteLedgerEntry={onDeleteLedgerEntry}
         onReconcileLedgerEntry={onReconcileLedgerEntry}
         onRemoveReconciliation={onRemoveReconciliation}
         onWriteOffLedgerRow={onWriteOffLedgerRow}
         onDeleteSelectedLedgerEntries={onDeleteSelectedLedgerEntries}
         onEditAllLedger={onEditAllLedger}
         onLedgerColumnDrop={onLedgerColumnDrop}
         onLedgerEditFieldArrowKey={onLedgerEditFieldArrowKey}
         onLedgerRowDrop={onLedgerRowDrop}
         onSaveAllLedger={onSaveAllLedger}
         onSaveLedgerRow={onSaveLedgerRow}
         onToggleLedgerEntrySelection={onToggleLedgerEntrySelection}
         openAdjustmentModal={openAdjustmentModal}
         openClientLedger={openClientLedger}
         openLedgerRowForEdit={openLedgerRowForEdit}
         openOrganizationClientsPage={openOrganizationClientsPage}
         navigateToSection={navigateToSection}
         loadData={loadData}
         setSection={setSection}
         setClientAccounts={setClientAccounts}
         setLedgerRowClickMode={setLedgerRowClickMode}
         toggleLedgerRowHighlight={toggleLedgerRowHighlight}
        />
       ) : null}

       {section === 'currencies' && isLoading ? (
        <SkTablePanel
         panelClassName={panelClassName}
         tableWrapClassName={tableWrapClassName}
         cols={SK_CURRENCIES}
         titleWidth="w-36"
         rows={8}
        />
       ) : null}
       {section === 'currencies' && !isLoading ? (
        <CurrenciesReadOnly
         enabledCurrencies={enabledCurrencies}
         onOpenSettings={() => {
          setSettingsTab('currencies');
          navigateToSection('settings');
         }}
        />
       ) : null}

       {section === 'live-rates' ? <LiveRatesSection /> : null}

       {section === 'transactions' || section === 'archive' ? (
        <TransactionsSection
         isLoading={isLoading}
         section={section}
         clients={clients}
         clientAccounts={clientAccounts}
         enabledCurrencies={enabledCurrencies}
         transactions={transactions}
         clientAccountMap={clientAccountMap}
         currencyMap={currencyMap}
         displayedTransactionRows={displayedTransactionRows}
         paginatedTransactions={paginatedTransactions}
         transactionsPager={transactionsPager}
         txFilterClientOptions={txFilterClientOptions}
         visibleTransactionColumnCount={visibleTransactionColumnCount}
         selectedTransactionSums={selectedTransactionSums}
         archiveCurrencyTotals={archiveCurrencyTotals}
         showChargesExchangeRate={showChargesExchangeRate}
         showExchangeRateFrom={showExchangeRateFrom}
         showExchangeRateTo={showExchangeRateTo}
         transactionAccountFromCurrencyCode={transactionAccountFromCurrencyCode}
         transactionAccountToCurrencyCode={transactionAccountToCurrencyCode}
         transactionSelectedCurrencyCode={transactionSelectedCurrencyCode}
         getTransactionTableDraft={getTransactionTableDraft}
         updateTransactionTableDraft={updateTransactionTableDraft}
         txTableHistory={txTableHistory}
         highlightedTxRows={highlightedTxRows}
         txRowClickHighlight={txRowClickHighlight}
         txRowClickActive={txRowClickActive}
         txSumMode={txSumMode}
         txSumSelection={txSumSelection}
         txSumByCurrency={txSumByCurrency}
         transactionsImportInputRef={transactionsImportInputRef}
         onCancelAllTransactions={onCancelAllTransactions}
         onCopySelectedTransaction={onCopySelectedTransaction}
         onDeleteSelectedTransactions={onDeleteSelectedTransactions}
         onDeleteTransactionTableRow={onDeleteTransactionTableRow}
         onDuplicateTransactionRow={onDuplicateTransactionRow}
         onEditAllTransactions={onEditAllTransactions}
         onExportArchivePdf={onExportArchivePdf}
         onImportTransactionsFile={onImportTransactionsFile}
         onPasteCopiedTransaction={onPasteCopiedTransaction}
         onSaveAllTransactions={onSaveAllTransactions}
         onSaveTransactionTableRow={onSaveTransactionTableRow}
         onToggleSelectAllTransactions={onToggleSelectAllTransactions}
         onToggleTransactionSelection={onToggleTransactionSelection}
         onTransactionRowDrop={onTransactionRowDrop}
         onTransactionSubmit={onTransactionSubmit}
         openClientLedger={openClientLedger}
         openTransactionExportModal={openTransactionExportModal}
         openTransactionTableSettingsModal={openTransactionTableSettingsModal}
         setTxRowClickMode={setTxRowClickMode}
         toggleTxRowHighlight={toggleTxRowHighlight}
         toggleTxSumMode={toggleTxSumMode}
         toggleTxSumEntry={toggleTxSumEntry}
        />
       ) : null}
      </div>
     ) : null}
    </div>
   </main>

   {showTransactionExportModal ? (
    <TransactionExportModal onExportTransactionsPdf={onExportTransactionsPdf} onExportTransactionsExcel={onExportTransactionsExcel} closeTransactionExportModal={closeTransactionExportModal} buildTransactionExportData={buildTransactionExportData} />
   ) : null}

   {showTransactionTableSettingsModal ? (
    <TransactionTableSettingsModal closeTransactionTableSettingsModal={closeTransactionTableSettingsModal} saveTransactionTableSettingsModal={saveTransactionTableSettingsModal} txRowHighlightColor={txRowHighlightColor} updateTxRowHighlightColor={updateTxRowHighlightColor} />
   ) : null}

   {section === 'transactions' || section === 'archive' ? (
    <ImportWizard
     clients={clients}
     clientAccounts={clientAccounts}
     enabledCurrencies={enabledCurrencies}
     currencies={currencies}
     organizations={organizations}
     allowOneSided={section === 'archive'}
     onPrepareImportReview={onPrepareImportReview}
     onCancelImportTransactions={onCancelImportTransactions}
     onConfirmImportTransactions={onConfirmImportTransactions}
     updateImportReviewEntry={updateImportReviewEntry}
     updateImportRowOverride={updateImportRowOverride}
     setOrgDialogTargetReviewKey={setOrgDialogTargetReviewKey}
     setOrganizationForm={setOrganizationForm}
     setShowCreateOrgDialog={setShowCreateOrgDialog}
    />
   ) : null}

   <AdjustmentModal selectedClientLedgers={selectedClientLedgers} selectedClientForLedger={selectedClientForLedger} localizedCurrencies={localizedCurrencies} clientAccounts={clientAccounts} currencyMap={currencyMap} enabledCurrencies={enabledCurrencies} adjustments={adjustments} onSubmitAdjustment={onSubmitAdjustment} onDeleteAdjustment={onDeleteAdjustment} />

   <PdfExportModal selectedClientLedgers={selectedClientLedgers} selectedClientForLedger={selectedClientForLedger} pdfAllColumns={pdfAllColumns} onExportLedgerPdf={onExportLedgerPdf} onExportLedgerExcel={onExportLedgerExcel} />

   {showLedgerSettingsModal ? (
    <LedgerSettingsModal
     orderedLedgerColumnOptions={orderedLedgerColumnOptions}
     persistLedgerSettings={persistLedgerSettings}
     updateLedgerDecimals={updateLedgerDecimals}
     updateLedgerDateFormat={updateLedgerDateFormat}
     updateLedgerRowHighlightColor={updateLedgerRowHighlightColor}
     updateLedgerNetChangeHighlightColor={updateLedgerNetChangeHighlightColor}
     toggleLedgerCurrencySymbol={toggleLedgerCurrencySymbol}
     toggleLedgerHighlightNetChange={toggleLedgerHighlightNetChange}
     toggleLedgerColumn={toggleLedgerColumn}
    />
   ) : null}

   <ToastHost />

   {/* Create Organization dialog */}
   {showCreateOrgDialog ? (
    <CreateOrgDialog
     organizationForm={organizationForm}
     setOrganizationForm={setOrganizationForm}
     onCreateOrgFromDialog={onCreateOrgFromDialog}
     isSavingOrg={isSavingOrg}
     orgDialogError={orgDialogError}
     setOrgDialogError={setOrgDialogError}
     setShowCreateOrgDialog={setShowCreateOrgDialog}
     setOrgDialogTargetReviewKey={setOrgDialogTargetReviewKey}
    />
   ) : null}
  </div>
 );
}

// Searchable account picker: type to filter accounts by client name / currency,
// matching the searchable client dropdown used in the new-transaction form. Each
// instance keeps its own open/query state so it can be reused per table row.
// Undo/redo history for an edit-drafts map. `record()` is called right before a
// change is applied; consecutive changes within 500ms collapse into one undo step
// (so typing a value is a single undo, not one per keystroke).


export default function Home() {
 const { status } = useSession();

 if (status === 'loading') {
  return null;
 }

 if (status !== 'authenticated') {
  return <HomePage />;
 }

 return <AuthenticatedHome />;
}
