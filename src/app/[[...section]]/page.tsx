'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useStableSession } from '@/hooks/useStableSession';
import { useLanguage } from '@/contexts/LanguageContext';
import HomePage from '@/components/marketing/HomePage';
import { useTranslation } from '@/hooks/useTranslation';
import { accountingApi } from '@/lib/accountingApi';

import type {
 Organization,
 OrganizationForm,
 Client,
 ClientAccount,
 Currency,
 Transaction,
 TransactionTableRow,
 TransactionUpdateInput,
 ClientAdjustment,
 ClientAccountLedger,
 Reconciliation,
 ImportClientReview,
 LedgerColumnKey,
 StoredLedgerSettings,
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
 getStoredTransactionTableSettings,
 getStoredArchiveTableSettings,
 getStoredLedgerColumnOrder,
 ledgerColumnVisibilityStorageKeyPrefix,
 ledgerSettingsStorageKeyPrefix,
 ledgerHighlightsStorageKeyPrefix,
 txHighlightsStorageKey,
 txRowSettingsStorageKey,
} from '@/shared/lib/localStorage';
import { normalizeDecimalInput } from '@/shared/utils/decimal';
import { getSectionFromPath } from '@/shared/utils/section';
import { SkBar, SkTablePanel, SK_CLIENTS, SK_CURRENCIES } from '@/shared/components/skeletons/Skeletons';
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
import { panelClassName, tableWrapClassName } from '@/shared/styles';
import OverviewSection from '@/features/overview/components/OverviewSection';
import LiveRatesSection from '@/features/live-rates/components/LiveRatesSection';
import TreasurySection from '@/features/treasury/components/TreasurySection';
import CurrenciesReadOnly from '@/features/currencies/components/CurrenciesReadOnly';
import OrganizationsReadOnly from '@/features/organizations/components/OrganizationsReadOnly';
import OrganizationClientsSection from '@/features/organizations/components/OrganizationClientsSection';
import PendingPricingModal from '@/features/organizations/components/PendingPricingModal';
import { useReconciliationLocks } from '@/features/ledger/hooks/useReconciliationLocks';
import SettingsSection from '@/features/settings/components/SettingsSection';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { useAppStatusStore } from '@/shared/store/appStatusStore';
import { generateOverviewCardsHtml, type OverviewPdfCard } from '@/features/pdf/pdfExport';
import { computeClientLedgers } from '@/features/ledger/utils/ledgerBalances';
import { buildTransactionTableRows, filterDisplayedTransactionRows } from '@/features/transactions/utils/transactionRows';
import { computeClientPageBalances, computeClientPendingPricingCounts, computeClientPendingPricingEntries, type PendingPricingEntry } from '@/features/clients/utils/clientBalances';
import { sortAndFilterClients, groupClientsByOrganization } from '@/features/clients/utils/clientsView';
import { useClientsStore } from '@/features/clients/store/clientsStore';
import { emptyClientForm, createNewClientAccountDraft } from '@/features/clients/forms';
import { emptyOrganizationForm } from '@/features/organizations/forms';
import ClientsReadOnly from '@/features/clients/components/ClientsReadOnly';
import { useTransactionsStore } from '@/features/transactions/store/transactionsStore';
import { useDraftHistory } from '@/shared/hooks/useDraftHistory';
import TransactionsSection from '@/features/transactions/components/TransactionsSection';
import { useLedgerStore } from '@/features/ledger/store/ledgerStore';
import LedgerSection from '@/features/ledger/components/LedgerSection';
import ImportWizard from '@/features/transactions/components/ImportWizard';
import CreateOrgDialog from '@/features/organizations/components/CreateOrgDialog';
import { useOrganizationActions } from '@/features/organizations/hooks/useOrganizationActions';
import { useBackupActions } from '@/features/settings/hooks/useBackupActions';
import { useClientActions } from '@/features/clients/hooks/useClientActions';
import { useLedgerActions } from '@/features/ledger/hooks/useLedgerActions';
import { useTransactionActions } from '@/features/transactions/hooks/useTransactionActions';
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
 const { data: authSession } = useStableSession();
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
 const ledgerFilterWholeWord = useLedgerStore((s) => s.ledgerFilterWholeWord);
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
 // Clicking an amount while it's on adds its id to txSumSelection; clicking again removes it.
 // The total (txSumByCurrency) looks up each id's CURRENT amount live rather than a snapshot,
 // so editing a summed row's amount afterward updates the total instead of it going stale.
 const [txSumMode, setTxSumMode] = useState(false);
 const [txSumSelection, setTxSumSelection] = useState<Set<number>>(new Set());
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
 const transactionTableSettingsStore = useTransactionsStore((s) => s.transactionTableSettings);
 const setTransactionTableSettingsStore = useTransactionsStore((s) => s.setTransactionTableSettings);
 const transactionTableSettingsDraftStore = useTransactionsStore((s) => s.transactionTableSettingsDraft);
 const setTransactionTableSettingsDraftStore = useTransactionsStore((s) => s.setTransactionTableSettingsDraft);
 // Archive is a distinct table from Transactions (different rows, own "more info" column),
 // so its column visibility/date-format is a separate slice — hiding a column in one must
 // not affect the other. Both this component and TransactionsSection.tsx resolve which
 // slice is "active" the same way: by the current section.
 const archiveTableSettings = useTransactionsStore((s) => s.archiveTableSettings);
 const setArchiveTableSettings = useTransactionsStore((s) => s.setArchiveTableSettings);
 const archiveTableSettingsDraft = useTransactionsStore((s) => s.archiveTableSettingsDraft);
 const setArchiveTableSettingsDraft = useTransactionsStore((s) => s.setArchiveTableSettingsDraft);
 const transactionTableSettings = section === 'archive' ? archiveTableSettings : transactionTableSettingsStore;
 const setTransactionTableSettings = section === 'archive' ? setArchiveTableSettings : setTransactionTableSettingsStore;
 const transactionTableSettingsDraft = section === 'archive' ? archiveTableSettingsDraft : transactionTableSettingsDraftStore;
 const setTransactionTableSettingsDraft = section === 'archive' ? setArchiveTableSettingsDraft : setTransactionTableSettingsDraftStore;
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
 const txFilterWholeWord = useTransactionsStore((s) => s.txFilterWholeWord);
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
 const error = useAppStatusStore((s) => s.error);
 const setError = useAppStatusStore((s) => s.setError);
 const [importSummary, setImportSummary] = useState('');
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
 // Polled periodically (not just on mount) so a tab left open across the expiry
 // moment still gets signed out instead of only catching it on the next reload.
 useEffect(() => {
  if (!sessionUserId) return;
  let mounted = true;
  const check = () => {
   fetch('/api/account/subscription')
    .then((res) => (res.ok ? (res.json() as Promise<{ subscriptionEndsAt: string | null }>) : null))
    .then((data) => {
     if (mounted && data) setSubscriptionEndsAt(data.subscriptionEndsAt ?? null);
    })
    .catch(() => {
     /* non-fatal */
    });
  };
  check();
  const interval = setInterval(check, 5 * 60 * 1000);
  return () => {
   mounted = false;
   clearInterval(interval);
  };
 }, [sessionUserId]);

 const subscriptionDaysLeft = subscriptionEndsAt ? Math.ceil((new Date(subscriptionEndsAt).getTime() - Date.now()) / 86_400_000) : null;
 // Keyed by the day count (not just the end date) so dismissing today's "5 days
 // left" warning doesn't suppress tomorrow's "4 days left" one — each day's
 // warning has to be dismissed on its own.
 const subscriptionBannerDismissKey = subscriptionEndsAt ? `arkam:subscription-banner-dismissed:${subscriptionEndsAt}:${subscriptionDaysLeft}` : '';
 const showSubscriptionBanner = subscriptionDaysLeft !== null && subscriptionDaysLeft <= 5 && subscriptionDaysLeft > 0 && !subscriptionBannerDismissed;

 // Once the subscription/trial has actually lapsed, force a sign-out instead of just
 // warning — the user lands back on /login, whose SUBSCRIPTION_EXPIRED gate (checked
 // again server-side on the next login attempt) explains why and offers to renew.
 useEffect(() => {
  if (subscriptionDaysLeft === null || subscriptionDaysLeft > 0) return;
  const email = authSession?.user?.email;
  void signOut({ redirect: false }).then(() => {
   window.location.href = `/login?authError=SUBSCRIPTION_EXPIRED${email ? `&authEmail=${encodeURIComponent(email)}` : ''}`;
  });
 }, [subscriptionDaysLeft, authSession]);

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
  setTransactionTableSettingsStore(getStoredTransactionTableSettings());
  setArchiveTableSettings(getStoredArchiveTableSettings());
 }, [workspaceSettingsQuery.data, hydrateLedgerPrefsFromStorage, setTransactionTableSettingsStore, setArchiveTableSettings]);

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
   setTransactionTableSettingsStore(getStoredTransactionTableSettings());
   setArchiveTableSettings(getStoredArchiveTableSettings());
  }
  lastPushedUserSnapshot.current = serializeSnapshot(snapshotSharedSettings());
 }, [userTableSettingsQuery.data, hydrateLedgerPrefsFromStorage, setTransactionTableSettingsStore, setArchiveTableSettings]);

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
  () => filterDisplayedTransactionRows({ transactionTableRows, manualRowOrder, section, txFilterSearch, txFilterWholeWord, txFilterClient, txFilterDateFrom, txFilterDateTo, txFilterHideExpenses }),
  [transactionTableRows, manualRowOrder, section, txFilterSearch, txFilterWholeWord, txFilterClient, txFilterDateFrom, txFilterDateTo, txFilterHideExpenses],
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
 }, [txFilterSearch, txFilterWholeWord, txFilterClient, txFilterDateFrom, txFilterDateTo, txFilterHideExpenses]);

 useEffect(() => {
  setLedgerPageState({});
 }, [ledgerFilterSearch, ledgerFilterWholeWord, ledgerFilterCounterparty, ledgerFilterDateFrom, ledgerFilterDateTo]);

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
  setLedgerSumSelection(new Set());
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
   if (on) setTxSumSelection(new Set());
   return !on;
  });
 }

 // Toggle a row's id into (or out of) the running total.
 function toggleTxSumEntry(id: number) {
  setTxSumSelection((prev) => {
   const next = new Set(prev);
   if (next.has(id)) next.delete(id);
   else next.add(id);
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














 // Returns whether the save actually succeeded, so callers only exit edit mode /
 // discard the draft on success — otherwise a validation or API failure would be
 // silently swallowed and the row would revert as if nothing had been typed.






 // Mobile floating save/cancel button: saves or cancels every ledger row currently being
 // edited, across however many accounts' ledgers are open at once (covers both a single
 // pencil-edited row and full "edit all" ledgers).


 // Puts a single ledger row into inline-edit mode (builds its draft + seeds the
 // reversed-rate flag). Shared by the row's Edit (pencil) button and the arrow-key
 // "save and move to next row" flow below.

 // Arrow left/right while editing a row's amount / exchange rate / commission: move to the
 // neighbouring editable cell in the same row, in the currently visible column order. Only
 // triggers at the start (left) or end (right) of the field's text so the caret can still be
 // moved within the value normally. The fields themselves are always dir="ltr" (numeric), so
 // the caret's start/end doesn't flip in RTL — but the column layout is visually mirrored, so
 // which physical key ("→") maps to "next column" does flip.

 // Arrow up/down while editing a row's amount / exchange rate / commission: move to the
 // adjacent row in the same field. If that row isn't being edited yet (single-row edit),
 // save the current row first and open the neighbour for editing; if it's already open
 // (e.g. "edit all" mode) just move the caret. `pagedEntries` is the exact rendered order.


 // Marks one ledger row as reconciled with the client at its running balance. The
 // captured balance + row (createdAt, id) become a lock line protecting earlier rows.

 // useOrganizationActions and useLedgerActions each need a handler the other produces
 // (a client-import-created org needs updateImportReviewEntry from useTransactionActions;
 // a ledger-entry delete needs onDeleteAdjustment from useLedgerActions itself is fine, but
 // useTransactionActions's row-delete needs onDeleteAdjustment from useLedgerActions, which
 // is called later). These stable indirections let every hook be called in any order —
 // each just forwards to whichever real implementation was wired in by the end of render.
 let updateImportReviewEntryImpl: ((key: string, patch: Partial<ImportClientReview>) => void) | null = null;
 const updateImportReviewEntry = (key: string, patch: Partial<ImportClientReview>) => updateImportReviewEntryImpl?.(key, patch);
 let onDeleteAdjustmentImpl: ((id: number, opts?: { offerUndo?: boolean }) => Promise<void>) | null = null;
 const onDeleteAdjustment = (id: number, opts?: { offerUndo?: boolean }) => onDeleteAdjustmentImpl?.(id, opts) ?? Promise.resolve();

  const { onOrganizationSubmit, onCreateOrgFromDialog, onDeleteOrganization } = useOrganizationActions({
   organizationForm,
   setOrganizationForm,
   selectedOrganizationForClients,
   setSelectedOrganizationForClients,
   navigateToSection,
   setOrgDialogError,
   setIsSavingOrg,
   setShowCreateOrgDialog,
   orgDialogTargetReviewKey,
   setOrgDialogTargetReviewKey,
   updateImportReviewEntry,
   clientForm,
   setClientForm,
  });





  const { onDownloadBackup, onRestoreBackupFile, lastBackupLabel } = useBackupActions({
   setIsBackingUp,
   setIsRestoringBackup,
   lastBackupAt,
   setLastBackupAt,
   lastBackupDevice,
   setLastBackupDevice,
   backupRestoreInputRef,
   setImportSummary,
   setSelectedClientForAccounts,
   setSelectedClientForLedger,
   setSelectedLedgerAccountId,
  });



 // Builds the per-client review list from the mapped sheet so the user can
 // rename clients and assign organizations before anything is created.







 // Reverses a delete by recreating the row from its captured snapshot, on the exact
 // same createdAt so it lands back in the same spot. New DB id (hard delete leaves
 // nothing to restore by id); a reconciliation mark on the old id would not carry over.


 // Shared field mapping from a stored transaction/table-row to a createTransaction
 // payload (same shape createTransaction expects) — used by both duplicate and undo,
 // which differ only in which createdAt they pass in.

 // One-click zero-out for a small (negligible) account balance: creates a single
 // adjustment for the exact remaining amount, in the account's own currency, so no
 // exchange rate is needed. Direction is the inverse of the balance's sign since a
 // positive balance means the client owes us (needs a debit adjustment to net to 0).

 // Mid-table write-off: zeroes the running balance AT a specific ledger row by inserting a
 // write-off adjustment immediately after it (later rows then continue from zero). Same
 // mechanism as onWriteOffBalance, but the amount is this row's running balance and the
 // adjustment is time-placed to land right after the row instead of at the account's end.





















 // Excel counterpart to onExportLedgerPdf: same selected-range/column logic, but each
 // entry's already-computed `runningBalance` is the correct absolute balance at that row
 // (computeClientLedgers accumulates it across the whole ledger), so no pre-balance
 // recomputation is needed here — unlike the PDF, which recomputes it to show as a
 // separate pre-balance line above the table.


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
  { key: 'treasury', label: t('nav_treasury'), icon: 'treasury' },
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

 // Jump back to the first page whenever the result set changes (search / sort / page size).
 useEffect(() => {
  setClientsPage(1);
 }, [clientSearch, clientSort, clientsPageSize]);
 const toggleClientSort = useCallback((key: 'name' | 'organization') => {
  setClientSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
 }, []);
 const clientAccountMap = useMemo(() => new Map(clientAccounts.map((account) => [account.id, account])), [clientAccounts]);

 const {
  onClientSubmit,
  onDeleteClient,
  onDeleteAllClients,
  onWriteOffBalance,
  onAddClientAccount,
  onSaveEditAccount,
  onDeleteClientAccount,
  onMoveAccountTransactions,
  onClientsOrgDrop,
 } = useClientActions({
  clients,
  clientAccounts,
  transactions,
  adjustments,
  numLocale,
  selectedClientForAccounts,
  setSelectedClientForAccounts,
  selectedClientForLedger,
  setSelectedClientForLedger,
  setSelectedLedgerAccountId,
  navigateToSection,
  currencyMap,
  clientAccountMap,
  clientsByOrganization,
 });

 // Per-client balances for the clients list/group view. Keyed by clientId, each value is
 // an array of { accountId, currencyCode, currencySymbol, balance } — one entry per account.
 const clientPageBalances = useMemo(
  () => computeClientPageBalances({ clientAccounts, transactions, adjustments }),
  [clientAccounts, transactions, adjustments],
 );

 // Per-client count of transactions/adjustments awaiting a manually-entered exchange rate
 // (excluded from clientPageBalances above until set). Shown on the organization page.
 const clientPendingPricingCounts = useMemo(
  () => computeClientPendingPricingCounts({ clientAccounts, transactions, adjustments }),
  [clientAccounts, transactions, adjustments],
 );
 // The actual pending rows behind those counts, keyed by client — drives the
 // org page's "waiting for pricing" popup (opened by clicking the count).
 const clientPendingPricingEntries = useMemo(
  () => computeClientPendingPricingEntries({ clientAccounts, transactions, adjustments }),
  [clientAccounts, transactions, adjustments],
 );
 const [pendingPricingModalClientId, setPendingPricingModalClientId] = useState<number | null>(null);

 // Lock guards for pricing a pending row from the org-page popup — pricing shifts the
 // account's balance from that date forward, so it must respect reconciliation locks the
 // same way the ledger/transaction edit paths do.
 const { confirmIfTransactionEditLocked, confirmIfEditLocked } = useReconciliationLocks({ reconciliations, clientAccountMap });

 // Sets the exchange rate on one "waiting for pricing" entry directly from the org page,
 // reusing the same update endpoints the ledger edit uses. The rate multiplies the entry's
 // amount into its account currency (1 <entry currency> = rate <account currency>). Only the
 // pending side's rate is touched; every other field is preserved from the stored record.
 const onSavePendingPricingRate = useCallback(
  async (entry: PendingPricingEntry, rateInput: string): Promise<boolean> => {
   const rate = parseFloat(normalizeDecimalInput(rateInput));
   if (!Number.isFinite(rate) || rate <= 0) {
    setError(t('pending_pricing_invalid_rate'));
    return false;
   }
   try {
    if (entry.kind === 'adjustment' && entry.adjustmentId != null) {
     const adj = adjustments.find((a) => a.id === entry.adjustmentId);
     if (!adj) return false;
     if (!(await confirmIfEditLocked([adj.accountId], adj.createdAt, [adj.accountId], adj.createdAt, adj.id))) {
      return false;
     }
     await accountingApi.updateClientAdjustment({ ...adj, exchangeRate: rate, exchangeRateReversed: false });
    } else if (entry.kind === 'transaction' && entry.transactionId != null) {
     const tx = transactions.find((x) => x.id === entry.transactionId);
     if (!tx) return false;
     const payload: TransactionUpdateInput = {
      id: tx.id,
      accountFromId: tx.accountFromId,
      accountToId: tx.accountToId,
      currencyId: tx.currencyId,
      amount: tx.amount,
      type: tx.type,
      exchangeRateFrom: entry.side === 'from' ? rate : tx.exchangeRateFrom,
      commissionFrom: tx.commissionFrom,
      exchangeRateTo: entry.side === 'to' ? rate : tx.exchangeRateTo,
      commissionTo: tx.commissionTo,
      exchangeRateFromReversed: entry.side === 'from' ? 0 : tx.exchangeRateFromReversed,
      exchangeRateToReversed: entry.side === 'to' ? 0 : tx.exchangeRateToReversed,
      charges: tx.charges,
      chargesCurrencyId: tx.chargesCurrencyId,
      chargesPayer: tx.chargesPayer,
      chargesExchangeRate: tx.chargesExchangeRate,
      chargesDescription: tx.chargesDescription,
      description: tx.description,
      archiveNote: tx.archiveNote,
      createdAt: tx.createdAt,
     };
     if (!(await confirmIfTransactionEditLocked(tx, payload))) {
      return false;
     }
     await accountingApi.updateTransaction(payload);
    } else {
     return false;
    }
    setError('');
    await loadData();
    return true;
   } catch (e) {
    setError(e instanceof Error ? e.message : t('error_failed_update'));
    return false;
   }
  },
  [adjustments, transactions, confirmIfEditLocked, confirmIfTransactionEditLocked, loadData, setError, t],
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
 // currencies shows one box each instead of adding incompatible currencies together. Looks up
 // each selected id's CURRENT row from transactionTableRowMap on every render (rather than a
 // snapshot captured at click time), so editing a summed row's amount afterward is reflected
 // instead of going stale.
 const txSumByCurrency = useMemo(() => {
  const byCurrency = new Map<string, { code: string; symbol: string; total: number; count: number }>();
  for (const id of txSumSelection) {
   const row = transactionTableRowMap.get(id);
   if (!row) continue;
   const code = row.currencyCode || '';
   const existing = byCurrency.get(code) ?? { code, symbol: row.currencySymbol || '', total: 0, count: 0 };
   existing.total += row.amount;
   existing.count += 1;
   byCurrency.set(code, existing);
  }
  return [...byCurrency.values()].sort((a, b) => a.code.localeCompare(b.code));
 }, [txSumSelection, transactionTableRowMap]);
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
  const {
   getTransactionTableDraft,
   updateTransactionTableDraft,
   onDeleteAllTransactions,
   onTransactionSubmit,
   onImportTransactionsFile,
   onPrepareImportReview,
   updateImportReviewEntry: updateImportReviewEntryFromTx,
   updateImportRowOverride,
   onConfirmImportTransactions,
   onCancelImportTransactions,
   onDeleteTransaction,
   onDeleteTransactionTableRow,
   onToggleTransactionSelection,
   onToggleSelectAllTransactions,
   onCopyTransactionRow,
   onPasteCopiedTransaction,
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
  } = useTransactionActions({
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
  });
 updateImportReviewEntryImpl = updateImportReviewEntryFromTx;


 const chargesCurrencyCode = transactionForm.chargesCurrencyId ? currencyMap.get(transactionForm.chargesCurrencyId)?.code : undefined;
 const chargesPayerAccountCurrencyCode =
  transactionForm.chargesPayer === 'from' ? transactionAccountFromCurrencyCode : transactionForm.chargesPayer === 'to' ? transactionAccountToCurrencyCode : undefined;
 const showChargesExchangeRate = !!(chargesCurrencyCode && chargesPayerAccountCurrencyCode && chargesCurrencyCode !== chargesPayerAccountCurrencyCode);







 // Builds the rows/headers for the transactions export, honouring the date range
 // and the currently visible columns so the export matches what the user sees.





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

  const {
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
   onSubmitAdjustment,
   onDeleteAdjustment: onDeleteAdjustmentFromLedger,
   onWriteOffLedgerRow,
   onLedgerRowDrop,
   onExportLedgerPdf,
   onExportLedgerExcel,
  } = useLedgerActions({
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
  });
  onDeleteAdjustmentImpl = onDeleteAdjustmentFromLedger;

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
   <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
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
  treasury: {
   title: t('treasury_title'),
   description: t('treasury_description'),
   accent: t('coming_soon_badge'),
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
  <SettingsSection
   settingsTabs={settingsTabs}
   settingsTab={settingsTab}
   setSettingsTab={setSettingsTab}
   error={error}
   importSummary={importSummary}
   setImportSummary={setImportSummary}
   isEditorRole={isEditorRole}
   isWorkspaceOwner={isWorkspaceOwner}
   sharedSettingsEnabled={sharedSettingsEnabled}
   setWorkspaceSharedSettingsEnabled={setWorkspaceSharedSettingsEnabled}
   isBackingUp={isBackingUp}
   isRestoringBackup={isRestoringBackup}
   backupRestoreInputRef={backupRestoreInputRef}
   lastBackupAt={lastBackupAt}
   lastBackupLabel={lastBackupLabel}
   onDownloadBackup={onDownloadBackup}
   onRestoreBackupFile={onRestoreBackupFile}
   transactions={transactions}
   clients={clients}
   onDeleteAllTransactions={onDeleteAllTransactions}
   onDeleteAllClients={onDeleteAllClients}
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
   organizationForm={organizationForm}
   onOrganizationSubmit={onOrganizationSubmit}
   onDeleteOrganization={onDeleteOrganization}
   openOrganizationClientsPage={openOrganizationClientsPage}
   localizedCurrencies={localizedCurrencies}
  />
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
       {/* subscriptionDaysLeft is guaranteed 1-5 here — showSubscriptionBanner excludes
           <= 0, since an actually-expired subscription now force-signs the user out
           (see the effect above) instead of just showing a dismissible warning. */}
       <span>{t('subscription_banner_expiring', { days: subscriptionDaysLeft ?? 0 })}</span>
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

      <OrganizationClientsSection
       section={section}
       isLoading={isLoading}
       selectedOrganizationForClients={selectedOrganizationForClients}
       selectedOrganizationClients={selectedOrganizationClients}
       clientPageBalances={clientPageBalances}
       clientPendingPricingCounts={clientPendingPricingCounts}
       numLocale={numLocale}
       isRTL={isRTL}
       openAddClientForOrganization={openAddClientForOrganization}
       navigateToSection={navigateToSection}
       openClientLedger={openClientLedger}
       setPendingPricingModalClientId={setPendingPricingModalClientId}
      />

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
         onSaveAllEditingLedgerRows={onSaveAllEditingLedgerRows}
         onCancelAllEditingLedgerRows={onCancelAllEditingLedgerRows}
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
       {section === 'treasury' ? <TreasurySection /> : null}

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
         onCopyTransactionRow={onCopyTransactionRow}
         onDeleteSelectedTransactions={onDeleteSelectedTransactions}
         onDeleteTransactionTableRow={onDeleteTransactionTableRow}
         onEditAllTransactions={onEditAllTransactions}
         onExportArchivePdf={onExportArchivePdf}
         openArchiveExportModal={openArchiveExportModal}
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
    <TransactionTableSettingsModal
     section={section}
     closeTransactionTableSettingsModal={closeTransactionTableSettingsModal}
     saveTransactionTableSettingsModal={saveTransactionTableSettingsModal}
     txRowHighlightColor={txRowHighlightColor}
     updateTxRowHighlightColor={updateTxRowHighlightColor}
    />
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

   {/* Org page: "waiting for pricing" entries popup for a client (opened by clicking the count).
       Lists each pending row (date, counterparty, description, amount) with an inline rate
       field so the pricing can be done right here, not only in the client ledger. */}
   {pendingPricingModalClientId != null ? (
    <PendingPricingModal
     clientName={clients.find((c) => c.id === pendingPricingModalClientId)?.name ?? null}
     entries={clientPendingPricingEntries.get(pendingPricingModalClientId) ?? []}
     numLocale={numLocale}
     ledgerDecimals={ledgerDecimals}
     ledgerDateFormat={ledgerDateFormat}
     onClose={() => setPendingPricingModalClientId(null)}
     onSaveRate={onSavePendingPricingRate}
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
 const { status } = useStableSession();

 if (status === 'loading') {
  return null;
 }

 if (status !== 'authenticated') {
  return <HomePage />;
 }

 return <AuthenticatedHome />;
}
