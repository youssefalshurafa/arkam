'use client';

import { ChangeEvent, DragEvent, Fragment, FormEvent, type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useLanguage } from '@/contexts/LanguageContext';
import HomePage from '@/components/marketing/HomePage';
import AccountSettings from '@/components/account/AccountSettings';
import TeamSettings from '@/components/account/TeamSettings';
import { useTranslation } from '@/hooks/useTranslation';
import { confirmDialog } from '@/components/ui/AppDialog';
import { Spinner } from '@/components/ui/Spinner';
import { accountingApi, type BackupInfo } from '@/lib/accountingApi';

import type {
 Organization,
 OrganizationForm,
 Client,
 ClientForm,
 NewClientAccountDraft,
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
 getStoredClientsOrgOrder,
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
import { ledgerFieldWidth, ledgerSelectWidth, HIGHLIGHT_PEN_CURSOR } from '@/shared/utils/format';
import { formatDateValue } from '@/shared/utils/date';
import { getCommissionAmount, chargeShowsInLedger } from '@/shared/utils/commission';
import { renderIcon } from '@/shared/utils/icons';
import { getSectionFromPath } from '@/shared/utils/section';
import { getDeviceLabel } from '@/shared/utils/device';
import { ledgerEntryKey } from '@/features/ledger/utils/ledgerEntries';
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
import { useQueryClient } from '@tanstack/react-query';
import { ensureCacheOwner } from '@/shared/lib/cacheOwner';
import { panelClassName, mutedPanelClassName, tableWrapClassName } from '@/shared/styles';
import OverviewSection from '@/features/overview/components/OverviewSection';
import CurrenciesSection from '@/features/currencies/components/CurrenciesSection';
import CurrenciesReadOnly from '@/features/currencies/components/CurrenciesReadOnly';
import LanguageSettings from '@/features/settings/components/LanguageSettings';
import DangerZone from '@/features/settings/components/DangerZone';
import PdfSettingsTab from '@/features/settings/components/PdfSettings';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { useAppStatusStore } from '@/shared/store/appStatusStore';

const emptyOrganizationForm = (): OrganizationForm => ({
 name: '',
});

const emptyClientForm = (): ClientForm => ({
 organizationId: null,
 name: '',
 email: '',
 phone: '',
 address: '',
});

const createNewClientAccountDraft = (): NewClientAccountDraft => ({
 currencyId: null,
 startingBalance: '0',
 balanceType: 'debit',
});

const emptyTransactionForm = (): TransactionForm => ({
 accountFromId: null,
 accountToId: null,
 currencyId: null,
 amount: '',
 type: 'transfer',
 adjustmentDirection: 'debit',
 exchangeRateFrom: '1.00',
 commissionFrom: '0.00',
 exchangeRateTo: '1.00',
 commissionTo: '0.00',
 charges: '0',
 chargesCurrencyId: null,
 chargesPayer: '',
 chargesExchangeRate: '1.00',
 chargesDescription: '',
 description: '',
 descriptionFrom: '',
 descriptionTo: '',
});

// Stable empty arrays so the derived server-data views keep a constant identity
// while the workspace query is still loading (avoids needless downstream re-memos).
const EMPTY_ORGANIZATIONS: Organization[] = [];
const EMPTY_CLIENTS: Client[] = [];
const EMPTY_CURRENCIES: Currency[] = [];
const EMPTY_TRANSACTIONS: Transaction[] = [];
const EMPTY_ADJUSTMENTS: ClientAdjustment[] = [];
const EMPTY_CLIENT_ACCOUNTS: ClientAccount[] = [];

function AuthenticatedHome() {
 const router = useRouter();
 const pathname = usePathname();
 const { language, setLanguage, isRTL } = useLanguage();
 const numLocale = language === 'fr' ? 'fr-FR' : language;
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
 const [activeWorkspaceId, setActiveWorkspaceIdState] = useState<string | null>(null);
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
 const workspaceQuery = useWorkspaceData(sessionUserId);
 const workspaceData = workspaceQuery.data;
 const { invalidate: invalidateWorkspace, setters: workspaceSetters } = useWorkspaceCache(sessionUserId);
 const { setOrganizations, setClients, setCurrencies, setTransactions, setAdjustments, setClientAccounts } = workspaceSetters;
 const isLoading = workspaceQuery.isPending;
 const organizations = workspaceData?.organizations ?? EMPTY_ORGANIZATIONS;
 const clients = workspaceData?.clients ?? EMPTY_CLIENTS;
 const [clientSort, setClientSort] = useState<{ key: 'name' | 'organization'; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' });
 const [clientSearch, setClientSearch] = useState('');
 const [clientsPage, setClientsPage] = useState(1);
 const [clientsPageSize, setClientsPageSize] = useState(25);
 const [clientsGroupByOrg, setClientsGroupByOrg] = useState(true);
 const [clientsOrgOrder, setClientsOrgOrder] = useState<string[]>(() => getStoredClientsOrgOrder());
 const [draggedOrgKey, setDraggedOrgKey] = useState<string | null>(null);
 const [dragOverOrgKey, setDragOverOrgKey] = useState<string | null>(null);
 const currencies = workspaceData?.currencies ?? EMPTY_CURRENCIES;
 const transactions = workspaceData?.transactions ?? EMPTY_TRANSACTIONS;
 const adjustments = workspaceData?.adjustments ?? EMPTY_ADJUSTMENTS;
 const clientAccounts = workspaceData?.clientAccounts ?? EMPTY_CLIENT_ACCOUNTS;
 const [selectedClientForAccounts, setSelectedClientForAccounts] = useState<Client | null>(null);
 const [selectedClientForLedger, setSelectedClientForLedger] = useState<Client | null>(null);
 const [clientLedgerBackSection, setClientLedgerBackSection] = useState<'clients' | 'organization-clients'>('clients');
 const [editingLedgerRowKeys, setEditingLedgerRowKeys] = useState<Set<string>>(new Set());
 const [editAllLedgerAccountIds, setEditAllLedgerAccountIds] = useState<Set<number>>(new Set());
 const [selectedLedgerEntryKeys, setSelectedLedgerEntryKeys] = useState<Set<string>>(new Set());
 const [showLedgerSettingsModal, setShowLedgerSettingsModal] = useState(false);
 const [ledgerFilterOpen, setLedgerFilterOpen] = useState(false);
 const [ledgerFilterSearch, setLedgerFilterSearch] = useState('');
 const [ledgerFilterCounterparty, setLedgerFilterCounterparty] = useState('');
 const [ledgerFilterDateFrom, setLedgerFilterDateFrom] = useState('');
 const [ledgerFilterDateTo, setLedgerFilterDateTo] = useState('');
 const [ledgerDecimals, setLedgerDecimals] = useState(2);
 const [ledgerDateFormat, setLedgerDateFormat] = useState<PdfSettings['dateFormat']>('full');
 const [ledgerHighlightNetChange, setLedgerHighlightNetChange] = useState(true);
 const [ledgerNetChangeHighlightColor, setLedgerNetChangeHighlightColor] = useState('#eff6ff');
 const [ledgerRowHighlightColor, setLedgerRowHighlightColor] = useState('#fde68a');
 const [ledgerRowClickHighlight, setLedgerRowClickHighlight] = useState(true);
 const [highlightedLedgerRows, setHighlightedLedgerRows] = useState<Map<string, string>>(new Map());
 const [txRowClickHighlight, setTxRowClickHighlight] = useState<boolean>(() => getStoredTxRowSettings().rowClickHighlight);
 const [highlightedTxRows, setHighlightedTxRows] = useState<Map<number, string>>(() => getStoredTxHighlights());
 const [txRowHighlightColor, setTxRowHighlightColor] = useState<string>(() => getStoredTxRowSettings().rowHighlightColor);
 const [ledgerStartingBalanceDrafts, setLedgerStartingBalanceDrafts] = useState<Record<number, string>>({});
 const [editingStartingBalanceIds, setEditingStartingBalanceIds] = useState<Set<number>>(new Set());
 const [selectedLedgerAccountId, setSelectedLedgerAccountId] = useState<number | null>(null);
 const [isTransactionsEditMode, setIsTransactionsEditMode] = useState(false);
 const [selectedTransactionIds, setSelectedTransactionIds] = useState<Set<number>>(new Set());
 const [editingRowIds, setEditingRowIds] = useState<Set<number>>(new Set());
 const [isEditAllTransactions, setIsEditAllTransactions] = useState(false);
 const [dragRowId, setDragRowId] = useState<number | null>(null);
 const [dragOverRowId, setDragOverRowId] = useState<number | null>(null);
 const [dragOverHalf, setDragOverHalf] = useState<'top' | 'bottom'>('bottom');
 const [manualRowOrder, setManualRowOrder] = useState<number[] | null>(null);
 const dragFromHandle = useRef(false);
 const [transactionsPage, setTransactionsPage] = useState(99999);
 const [transactionsPageSize, setTransactionsPageSize] = useState(100);
 const [ledgerPageState, setLedgerPageState] = useState<Record<number, number>>({});
 const [ledgerPageSize, setLedgerPageSize] = useState<number>(() => {
  if (typeof window === 'undefined') return 50;
  const stored = parseInt(window.localStorage.getItem('arkam:ledger-page-size') ?? '', 10);
  return [25, 50, 100].includes(stored) ? stored : 50;
 });
 const [showTransactionTableSettingsModal, setShowTransactionTableSettingsModal] = useState(false);
 const [transactionTableSettings, setTransactionTableSettings] = useState<TransactionTableSettings>(() => getStoredTransactionTableSettings());
 const [transactionTableSettingsDraft, setTransactionTableSettingsDraft] = useState<TransactionTableSettings>(() => getStoredTransactionTableSettings());
 const [showTransactionExportModal, setShowTransactionExportModal] = useState(false);
 const [transactionExportFrom, setTransactionExportFrom] = useState('');
 const [transactionExportTo, setTransactionExportTo] = useState('');
 const [isExportingTransactions, setIsExportingTransactions] = useState(false);
 const [txSortDir, setTxSortDir] = useState<'desc' | 'asc'>('desc');
 const [txFilterOpen, setTxFilterOpen] = useState(false);
 const [txFilterSearch, setTxFilterSearch] = useState('');
 const [txFilterClient, setTxFilterClient] = useState('');
 const [txFilterDateFrom, setTxFilterDateFrom] = useState('');
 const [txFilterDateTo, setTxFilterDateTo] = useState('');
 const [commissionExpandedTxns, setCommissionExpandedTxns] = useState<Set<number>>(new Set());
 const [expensesExpandedTxns, setExpensesExpandedTxns] = useState<Set<number>>(new Set());
 const [ledgerExpensesExpandedKeys, setLedgerExpensesExpandedKeys] = useState<Set<string>>(new Set());
 const [isNewTransactionSectionOpen, setIsNewTransactionSectionOpen] = useState(false);
 const [isNewTransactionExpensesOpen, setIsNewTransactionExpensesOpen] = useState(false);
 const [showLedgerCurrencySymbol, setShowLedgerCurrencySymbol] = useState(true);
 const [draggedLedgerColumn, setDraggedLedgerColumn] = useState<LedgerColumnKey | null>(null);
 const [dragLedgerRowKey, setDragLedgerRowKey] = useState<string | null>(null);
 const [dragOverLedgerRowKey, setDragOverLedgerRowKey] = useState<string | null>(null);
 const [dragOverLedgerHalf, setDragOverLedgerHalf] = useState<'top' | 'bottom'>('bottom');
 const dragLedgerFromHandle = useRef(false);
 const [ledgerColumnOrder, setLedgerColumnOrder] = useState<LedgerColumnKey[]>(defaultLedgerColumnOrder);
 const [ledgerColumnVisibility, setLedgerColumnVisibility] = useState<Record<LedgerColumnKey, boolean>>({ ...defaultLedgerColumnVisibility });
 const [ledgerTransactionDrafts, setLedgerTransactionDrafts] = useState<Record<string, LedgerTransactionDraft>>({});
 const [transactionTableDrafts, setTransactionTableDrafts] = useState<Record<number, TransactionTableDraft>>({});
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
 const [newAccountCurrencyId, setNewAccountCurrencyId] = useState<number | null>(null);
 const [newAccountStartingBalance, setNewAccountStartingBalance] = useState<string>('0');
 const [newAccountBalanceType, setNewAccountBalanceType] = useState<'debit' | 'credit'>('debit');
 const [showAddAccountForm, setShowAddAccountForm] = useState(false);
 const [showCreateOrgDialog, setShowCreateOrgDialog] = useState(false);
 const [isSavingOrg, setIsSavingOrg] = useState(false);
 const [orgDialogError, setOrgDialogError] = useState('');
 // When the create-organization popup is opened from an import-review row, this
 // holds that row's key so the new org is assigned back to it (not the client form).
 const [orgDialogTargetReviewKey, setOrgDialogTargetReviewKey] = useState<string | null>(null);
 const [editingAccountId, setEditingAccountId] = useState<number | null>(null);
 const [editingAccountCurrencyId, setEditingAccountCurrencyId] = useState<number | null>(null);
 const [editingAccountBalance, setEditingAccountBalance] = useState<string>('0');
 const [editingAccountBalanceType, setEditingAccountBalanceType] = useState<'debit' | 'credit'>('debit');
 // "Move all transactions to another account" picker, scoped to the account being edited.
 const [moveTargetAccountId, setMoveTargetAccountId] = useState<number | null>(null);
 const [isMovingAccount, setIsMovingAccount] = useState(false);
 const [pdfExportModal, setPdfExportModal] = useState<{
  accountId: number;
  fromDate: string;
  toDate: string;
  fromEntryKey: string | null;
  toEntryKey: string | null;
  cols: PdfColVisibility;
 } | null>(null);
 const [adjustmentModal, setAdjustmentModal] = useState<{
  accountId: number;
  editingId: number | null;
  amount: string;
  direction: 'debit' | 'credit';
  currencyId: number | null;
  exchangeRate: string;
  exchangeRateReversed: boolean;
  description: string;
  date: string;
 } | null>(null);
 const pdfSettings = useSettingsStore((s) => s.pdfSettings);
 const [organizationForm, setOrganizationForm] = useState<OrganizationForm>(emptyOrganizationForm);
 const [clientForm, setClientForm] = useState<ClientForm>(emptyClientForm);
 const [openAccountOnCreate, setOpenAccountOnCreate] = useState(true);
 const [newClientAccountDrafts, setNewClientAccountDrafts] = useState<NewClientAccountDraft[]>([createNewClientAccountDraft()]);
 const [transactionForm, setTransactionForm] = useState<TransactionForm>(emptyTransactionForm);
 // Disables the submit button while a new transaction/adjustment is being created, so a
 // double-click can't create a duplicate. The ref is the synchronous guard (state hasn't
 // re-rendered yet on a rapid second click); the state drives the disabled UI.
 const [isSubmittingTransaction, setIsSubmittingTransaction] = useState(false);
 const transactionSubmitLock = useRef(false);
 // When enabled, the sender and receiver ledgers each get their own description override.
 const [txSplitDescription, setTxSplitDescription] = useState(false);
 const [newTransactionDate, setNewTransactionDate] = useState(() => new Date().toISOString().slice(0, 10));
 const [copiedTransaction, setCopiedTransaction] = useState<TransactionTableRow | null>(null);
 const [txFromQuery, setTxFromQuery] = useState('');
 const [txFromOpen, setTxFromOpen] = useState(false);
 const [txFromExpandedClient, setTxFromExpandedClient] = useState<number | null>(null);
 const [txToQuery, setTxToQuery] = useState('');
 const [txToOpen, setTxToOpen] = useState(false);
 const [txToExpandedClient, setTxToExpandedClient] = useState<number | null>(null);
 const [ledgerCounterpartyOpen, setLedgerCounterpartyOpen] = useState<string | null>(null);
 const [ledgerCounterpartyQuery, setLedgerCounterpartyQuery] = useState('');
 const [ledgerCounterpartyExpandedClient, setLedgerCounterpartyExpandedClient] = useState<number | null>(null);
 const [descriptionSuggestOpen, setDescriptionSuggestOpen] = useState(false);
 const [txFromRateReversed, setTxFromRateReversed] = useState(false);
 const [txToRateReversed, setTxToRateReversed] = useState(false);
 const [ledgerRateReversed, setLedgerRateReversed] = useState<Record<string, boolean>>({});
 const [ledgerDisplayRateReversed, setLedgerDisplayRateReversed] = useState<Record<string, boolean>>({});
 const [tableRateFromReversed, setTableRateFromReversed] = useState<Record<number, boolean>>({});
 const [tableRateToReversed, setTableRateToReversed] = useState<Record<number, boolean>>({});
 const error = useAppStatusStore((s) => s.error);
 const setError = useAppStatusStore((s) => s.setError);
 const [importSummary, setImportSummary] = useState('');
 const toast = useAppStatusStore((s) => s.toast);
 const toastPos = useAppStatusStore((s) => s.toastPos);
 const [isImportingTransactions, setIsImportingTransactions] = useState(false);
 const [pendingImportData, setPendingImportData] = useState<PendingImportData | null>(null);
 const [importMapping, setImportMapping] = useState<ImportMappingState>({
  dateColumn: null,
  fromColumn: null,
  toColumn: null,
  amountColumn: null,
  descriptionColumn: null,
  currencyId: null,
 });
 const [importReview, setImportReview] = useState<ImportClientReview[] | null>(null);
 // The parsed sheet rows backing the current review, plus per-row overrides for
 // rows that involve an expense-marked name (expense vs. real transaction).
 const [importParsedRows, setImportParsedRows] = useState<ImportedTransactionRow[]>([]);
 const [importRowOverrides, setImportRowOverrides] = useState<Record<number, ImportRowOverride>>({});
 // Currencies the "apply to all clients" control will open for every client.
 const transactionsImportInputRef = useRef<HTMLInputElement | null>(null);
 const [isBackingUp, setIsBackingUp] = useState(false);
 const [isRestoringBackup, setIsRestoringBackup] = useState(false);
 const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
 const [lastBackupDevice, setLastBackupDevice] = useState<string | null>(null);
 const backupRestoreInputRef = useRef<HTMLInputElement | null>(null);
 const lastInitializedSubIdRef = useRef<string>('');

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

 // Load ALL per-client ledger preferences whenever the open client changes.
 useEffect(() => {
  setLedgerColumnVisibility(getStoredLedgerColumnVisibility(selectedClientForLedger?.id));
  setLedgerColumnOrder(getStoredLedgerColumnOrder(selectedClientForLedger?.id));
  const settings = getStoredLedgerSettings(selectedClientForLedger?.id);
  setLedgerDecimals(settings.decimals);
  setShowLedgerCurrencySymbol(settings.showCurrencySymbol);
  setLedgerDateFormat(settings.dateFormat);
  setLedgerHighlightNetChange(settings.highlightNetChange);
  setLedgerNetChangeHighlightColor(settings.netChangeHighlightColor);
  setLedgerRowHighlightColor(settings.rowHighlightColor);
  setLedgerRowClickHighlight(settings.rowClickHighlight);
  setHighlightedLedgerRows(getStoredLedgerHighlights(selectedClientForLedger?.id));
 }, [selectedClientForLedger?.id]);

 const transactionTableRows = useMemo<TransactionTableRow[]>(() => {
  const adjustmentRows = adjustments.map((adjustment) => {
   const account = clientAccounts.find((currentAccount) => currentAccount.id === adjustment.accountId);

   return {
    id: -adjustment.id,
    adjustmentId: adjustment.id,
    isAdjustment: true,
    adjustmentDirection: adjustment.direction,
    accountFromId: adjustment.accountId,
    clientFromName: account?.clientName || '',
    accountFromCurrencyCode: account?.currencyCode || '',
    accountFromCurrencySymbol: account?.currencySymbol || '',
    accountToId: 0,
    clientToName: '',
    accountToCurrencyCode: '',
    accountToCurrencySymbol: '',
    currencyId: adjustment.currencyId ?? account?.currencyId ?? 0,
    currencyCode: adjustment.currencyCode || account?.currencyCode || '',
    currencySymbol: adjustment.currencySymbol || account?.currencySymbol || '',
    amount: adjustment.amount,
    type: 'adjustment',
    exchangeRateFrom: adjustment.exchangeRate || 1,
    commissionFrom: 0,
    exchangeRateTo: 1,
    commissionTo: 0,
    exchangeRateFromReversed: adjustment.exchangeRateReversed ? 1 : 0,
    exchangeRateToReversed: 0,
    charges: 0,
    chargesCurrencyId: null,
    chargesCurrencyCode: null,
    chargesCurrencySymbol: null,
    chargesPayer: '',
    chargesExchangeRate: 1,
    chargesDescription: '',
    description: adjustment.description,
    archiveNote: '',
    isArchived: 0,
    createdAt: adjustment.createdAt,
   };
  });

  return ([...transactions, ...adjustmentRows] as TransactionTableRow[]).sort((left, right) => {
   const dateDiff = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
   if (dateDiff !== 0) return txSortDir === 'desc' ? dateDiff : -dateDiff;
   // Stable tiebreaker: higher DB id = inserted later = shown first within the same date
   const leftId = left.isAdjustment ? (left.adjustmentId ?? 0) : left.id;
   const rightId = right.isAdjustment ? (right.adjustmentId ?? 0) : right.id;
   return txSortDir === 'desc' ? rightId - leftId : leftId - rightId;
  });
 }, [adjustments, clientAccounts, transactions, txSortDir]);

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
 const displayedTransactionRows = useMemo<TransactionTableRow[]>(() => {
  const ordered = (() => {
   if (!manualRowOrder) return transactionTableRows;
   const rowMap = new Map(transactionTableRows.map((r) => [r.id, r]));
   return manualRowOrder.flatMap((id) => {
    const row = rowMap.get(id);
    return row ? [row] : [];
   });
  })();
  let filtered =
   section === 'archive' ? ordered.filter((row) => row.isArchived || (!row.isAdjustment && (!row.accountFromId || !row.accountToId))) : ordered.filter((row) => !row.isArchived);
  if (txFilterSearch) {
   const q = txFilterSearch.toLowerCase();
   // Amount matching ignores thousands separators/spaces, so "500,000" and
   // "500000" both match the stored numeric amount.
   const amountQ = q.replace(/[,\s]/g, '');
   filtered = filtered.filter(
    (row) =>
     row.clientFromName.toLowerCase().includes(q) ||
     row.clientToName.toLowerCase().includes(q) ||
     row.description.toLowerCase().includes(q) ||
     (amountQ !== '' && String(row.amount).includes(amountQ)),
   );
  }
  if (txFilterClient) {
   filtered = filtered.filter((row) => row.clientFromName === txFilterClient || row.clientToName === txFilterClient);
  }
  if (txFilterDateFrom) {
   filtered = filtered.filter((row) => row.createdAt.slice(0, 10) >= txFilterDateFrom);
  }
  if (txFilterDateTo) {
   filtered = filtered.filter((row) => row.createdAt.slice(0, 10) <= txFilterDateTo);
  }
  return filtered;
 }, [transactionTableRows, manualRowOrder, section, txFilterSearch, txFilterClient, txFilterDateFrom, txFilterDateTo]);

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
 }, [txFilterSearch, txFilterClient, txFilterDateFrom, txFilterDateTo]);

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

 function openClientLedger(client: Client, origin: 'clients' | 'organization-clients' = 'clients', accountId?: number | null) {
  setClientLedgerBackSection(origin);
  setLedgerTransactionDrafts({});
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

 // Explicit mode setters for the highlight / copy toggle pair shown above the table.
 function setLedgerRowClickMode(highlight: boolean) {
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

 function toggleTxRowClickHighlight() {
  const next = !txRowClickHighlight;
  setTxRowClickHighlight(next);
  try {
   const stored = JSON.parse(window.localStorage.getItem(txRowSettingsStorageKey) ?? '{}') as Record<string, unknown>;
   window.localStorage.setItem(txRowSettingsStorageKey, JSON.stringify({ ...stored, rowClickHighlight: next }));
  } catch {
   /* ignore */
  }
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
 }

 function onLedgerColumnDragStart(event: DragEvent<HTMLElement>, column: LedgerColumnKey) {
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', column);
  setDraggedLedgerColumn(column);
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
 }

 function formatRateValue(value: number): string {
  if (!Number.isFinite(value)) {
   return '1.00';
  }
  const trimmed = parseFloat(value.toFixed(6));
  // Always show at least 2 decimal places
  const str = trimmed.toString();
  const dotIdx = str.indexOf('.');
  if (dotIdx === -1) return str + '.00';
  const decimals = str.length - dotIdx - 1;
  if (decimals < 2) return str + '0'.repeat(2 - decimals);
  return str;
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

 function getLedgerTransactionDraftKey(transactionId: number, ledgerAccountId: number) {
  return `${transactionId}:${ledgerAccountId}`;
 }

 function updateLedgerTransactionDraft(transactionId: number, ledgerAccountId: number, nextValues: Partial<LedgerTransactionDraft>) {
  ledgerHistory.record();
  setLedgerTransactionDrafts((current) => {
   const draftKey = getLedgerTransactionDraftKey(transactionId, ledgerAccountId);
   const existingDraft = current[draftKey];
   if (!existingDraft) {
    return current;
   }

   return {
    ...current,
    [draftKey]: {
     ...existingDraft,
     ...nextValues,
    },
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

   return {
    ...current,
    [transactionId]: {
     ...existingDraft,
     ...nextValues,
    },
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
    await onDeleteAdjustment(entry.adjustmentId);
   } else {
    await onDeleteTransaction(entry.transactionId);
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

  const exact = new Date(lastBackupAt).toLocaleString(numLocale, {
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

  if (importMapping.fromColumn == null || importMapping.toColumn == null || importMapping.amountColumn == null) {
   setError(t('import_err_mapping'));
   return;
  }

  // The import currency is optional. When chosen it drives every row's currency
  // (unchanged behaviour); when left blank, each row's currency is derived from
  // the account the user picks for the client in the review step.
  const selectedCurrency = importMapping.currencyId ? (currencies.find((currency) => currency.id === importMapping.currencyId) ?? null) : null;

  try {
   const importedRows = parseTransactionRowsFromMappedSheet(pendingImportData.rows, importMapping, selectedCurrency);
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

  if (importMapping.fromColumn == null || importMapping.toColumn == null || importMapping.amountColumn == null) {
   setError(t('import_err_mapping'));
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
   const importedRows = parseTransactionRowsFromMappedSheet(pendingImportData.rows, importMapping, selectedCurrency);

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

    // Transfer between two clients.
    if (!fromEntry || !toEntry) continue;
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
   currencyId: null,
  });
 }

 async function onSaveAllTransactionDrafts() {
  if (!accountingApi) {
   setError(t('error_bridge'));
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

 async function onDeleteTransaction(id: number) {
  if (!accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  if (!(await confirmDialog({ message: t('transaction_delete_confirm'), confirmText: t('delete'), tone: 'danger' }))) {
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

 async function onDeleteAdjustment(id: number) {
  if (!accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  if (!(await confirmDialog({ message: t('adjustment_delete_confirm'), confirmText: t('delete'), tone: 'danger' }))) {
   return;
  }

  try {
   await accountingApi.deleteClientAdjustment(id);
   setError('');
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_delete'));
  }
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

 function onCopySelectedTransaction(e: React.MouseEvent) {
  const ids = [...selectedTransactionIds];
  if (ids.length !== 1) return;
  const row = transactionTableRowMap.get(ids[0]);
  if (row) {
   setCopiedTransaction(row);
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

  const confirmed = await confirmDialog({
   message: t('transactions_delete_selected_confirm', { count: idsToDelete.length }),
   confirmText: t('delete'),
   tone: 'danger',
  });
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

  setManualRowOrder(next);

  // Determine date-zone changes for each dragged row
  const rowMap = new Map(displayedTransactionRows.map((r) => [r.id, r]));
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
   createdAt: resolveCreatedAt(draft.createdDate, transaction.createdAt),
  };

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

 function generateLedgerHtml(
  ledger: ClientAccountLedger,
  fromDate: string,
  toDate: string,
  colVisibility: PdfColVisibility,
  fromEntryKey?: string | null,
  toEntryKey?: string | null,
 ): string {
  const esc = (value: string) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string);
  // Candidates are the entries within the chosen date range; the start/end transaction
  // pickers then narrow the exact boundaries (handy when a day has many transactions).
  const candidates = ledger.entries.filter((e) => {
   const d = e.createdAt.slice(0, 10);
   return d >= fromDate && d <= toDate;
  });
  const startIdx = fromEntryKey
   ? Math.max(
      0,
      candidates.findIndex((e) => ledgerEntryKey(e) === fromEntryKey),
     )
   : 0;
  const endIdxRaw = toEntryKey ? candidates.findIndex((e) => ledgerEntryKey(e) === toEntryKey) : -1;
  const endIdx = endIdxRaw === -1 ? candidates.length - 1 : endIdxRaw;
  const filteredEntries = startIdx <= endIdx ? candidates.slice(startIdx, endIdx + 1) : [];

  // Pre-balance includes everything chronologically before the first selected entry
  // (entries before the date range, plus same-range entries skipped by the start picker).
  const firstSelected = filteredEntries[0];
  const cutoffIndex = firstSelected ? ledger.entries.findIndex((e) => ledgerEntryKey(e) === ledgerEntryKey(firstSelected)) : ledger.entries.length;
  const preBalance = ledger.startingBalance + ledger.entries.slice(0, cutoffIndex < 0 ? 0 : cutoffIndex).reduce((sum, e) => sum + e.netChange, 0);

  // Build column definitions respecting user visibility; running_balance is always included
  type ColDef = { key: LedgerColumnKey; header: string; isNum?: boolean; cell: (e: ClientLedgerEntry, runBal: number) => string };
  const allCols: ColDef[] = [
   {
    key: 'created',
    header: t('date'),
    cell: (e) => {
     const iso = e.createdAt.slice(0, 10); // yyyy-mm-dd
     const [y, m, d] = iso.split('-');
     switch (pdfSettings.dateFormat) {
      case 'day-month':
       return `${d}/${m}`;
      case 'month-year':
       return `${m}/${y}`;
      case 'day-month-year-2':
       return `${d}/${m}/${y.slice(2)}`;
      case 'month-day':
       return `${m}/${d}`;
      default:
       return iso; // full yyyy-mm-dd
     }
    },
   },
   { key: 'counterparty', header: t('counterparty'), cell: (e) => e.counterpartyName },
   {
    key: 'direction',
    header: t('direction'),
    cell: (e) =>
     e.isAdjustment ? t(e.direction === 'outgoing' ? 'adjustment_direction_credit' : 'adjustment_direction_debit') : t(e.direction === 'outgoing' ? 'outgoing' : 'incoming'),
   },
   {
    key: 'type',
    header: t('transaction_type'),
    cell: (e) => (e.isAdjustment ? t('adjustment_label') : t(e.type === 'transfer' ? 'transaction_type_transfer' : 'transaction_type_exchange')),
   },
   {
    key: 'amount',
    header: t('amount'),
    isNum: true,
    cell: (e) =>
     `<span class="${e.direction === 'outgoing' ? 'pos' : 'neg'}">${e.amount.toLocaleString(numLocale, { maximumFractionDigits: pdfSettings.decimals })}${pdfSettings.showCurrencySymbol ? ` ${e.currencySymbol || e.currencyCode}` : ''}</span>`,
   },
   {
    key: 'exchangeRate',
    header: t('exchange_rate'),
    isNum: true,
    cell: (e) => {
     if (e.pendingRate) {
      return '-';
     }
     if (e.isAdjustment) {
      // Show the actual rate (including 1), matching the on-screen ledger. Only a genuinely
      // unset cross-currency rate (pendingRate, handled above) renders as a dash.
      return formatRateValue(e.exchangeRateReversed ? 1 / e.exchangeRate : e.exchangeRate);
     }
     return formatRateValue(e.exchangeRate);
    },
   },
   { key: 'commission', header: t('commission'), isNum: true, cell: (e) => (e.isAdjustment ? '-' : formatRateValue(e.commission)) },
   {
    key: 'netChange',
    header: t('net_change'),
    isNum: true,
    cell: (e) =>
     e.pendingRate ? '-' : `<span class="${e.netChange >= 0 ? 'pos' : 'neg'}">${e.netChange.toLocaleString(numLocale, { maximumFractionDigits: pdfSettings.decimals })}</span>`,
   },
   {
    key: 'runningBalance',
    header: t('running_balance'),
    isNum: true,
    cell: (_e, runBal) => `<span class="${runBal >= 0 ? 'pos' : 'neg'}">${runBal.toLocaleString(numLocale, { maximumFractionDigits: pdfSettings.decimals })}</span>`,
   },
   { key: 'currency', header: t('currency'), cell: (e) => e.currencyCode },
   { key: 'description', header: t('transaction_description'), cell: (e) => e.description ?? '' },
  ];
  const visibleCols = ledgerColumnOrder
   .map((key) => allCols.find((col) => col.key === key))
   .filter((col): col is ColDef => Boolean(col))
   .filter((col) => col.key === 'runningBalance' || colVisibility[col.key]);
  // Ensure runningBalance is always present (append if somehow missing from order)
  if (!visibleCols.some((col) => col.key === 'runningBalance')) {
   const rbCol = allCols.find((col) => col.key === 'runningBalance');
   if (rbCol) visibleCols.push(rbCol);
  }
  // Insert charges column before runningBalance when any entry has charges
  const hasCharges = filteredEntries.some((e) => !e.isAdjustment && e.charges > 0 && chargeShowsInLedger(e.chargesPayer));
  if (hasCharges) {
   const chargesCol: ColDef = {
    key: 'charges' as unknown as LedgerColumnKey,
    header: t('charges'),
    isNum: true,
    cell: (e) => {
     if (e.isAdjustment || e.charges <= 0 || !chargeShowsInLedger(e.chargesPayer)) return '';
     const sign = e.isChargesPayerThisAccount ? '−' : '+';
     const cls = e.isChargesPayerThisAccount ? 'neg' : 'pos';
     const val = e.charges.toLocaleString(numLocale, { maximumFractionDigits: pdfSettings.decimals });
     const desc = e.chargesDescription ? `<div class="charges-desc">${esc(e.chargesDescription)}</div>` : '';
     return `<span class="${cls}">${sign}${val}</span>${desc}`;
    },
   };
   const amtIdx = visibleCols.findIndex((col) => col.key === 'amount');
   if (amtIdx === -1) visibleCols.push(chargesCol);
   else visibleCols.splice(amtIdx + 1, 0, chargesCol);
  }
  const colCount = visibleCols.length;

  let runningBal = preBalance;
  const rows = filteredEntries
   .map((e) => {
    runningBal += e.netChange;
    const cells = visibleCols
     .map((col) => {
      const classes = [col.isNum ? 'num' : '', col.key === 'netChange' && pdfSettings.highlightNetChange ? 'hl' : ''].filter(Boolean).join(' ');
      return `<td${classes ? ` class="${classes}"` : ''}>${col.cell(e, runningBal)}</td>`;
     })
     .join('');
    return `<tr>${cells}</tr>`;
   })
   .join('');

  const headerCells = visibleCols.map((col) => `<th${col.isNum ? ' class="num"' : ''}>${col.header}</th>`).join('');

  const dir = isRTL ? 'rtl' : 'ltr';
  const logoUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/logo/arkam-logo.png`;
  const clientName = selectedClientForLedger?.name ?? '';
  const exportDate = new Date().toLocaleDateString(language);

  const metaCards = [
   pdfSettings.showMetaClient ? `<div class="meta-card"><div class="label">${t('client')}</div><div class="value">${clientName}</div></div>` : '',
   pdfSettings.showMetaCurrency
    ? `<div class="meta-card"><div class="label">${t('currency')}</div><div class="value">${ledger.currencyName} (${ledger.currencySymbol || ledger.currencyCode})</div></div>`
    : '',
   pdfSettings.showMetaPeriod
    ? `<div class="meta-card"><div class="label">${t('export_period')}</div><div class="value" style="font-size:12px">${fromDate} &rarr; ${toDate}</div></div>`
    : '',
  ].filter(Boolean);
  const metaColCount = metaCards.length;

  return `<!DOCTYPE html>
<html lang="${language}" dir="${dir}">
<head>
<meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap">
<style>
 * { box-sizing: border-box; margin: 0; padding: 0; }
 body { font-family: ${pdfSettings.fontFamily}; font-size: ${pdfSettings.fontSize}px; color: #1e293b; padding: 32px; }
 .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1e293b; padding-bottom: 12px; margin-bottom: 20px; }
 .header-left { display: flex; align-items: center; gap: 14px; }
 .brand-logo { height: 54px; width: auto; }
 .header-left h1 { font-size: calc(${pdfSettings.fontSize}px + 8px); font-weight: bold; }
 .header-left p { font-size: calc(${pdfSettings.fontSize}px - 1px); color: #64748b; margin-top: 2px; }
 .header-right { text-align: ${isRTL ? 'left' : 'right'}; font-size: calc(${pdfSettings.fontSize}px - 1px); color: #64748b; }
 .meta { display: grid; grid-template-columns: repeat(${metaColCount || 1}, 1fr); gap: 12px; margin-bottom: 20px; }
 .meta-card { border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 14px; background: #f8fafc; }
 .meta-card .label { font-size: calc(${pdfSettings.fontSize}px - 2px); text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; }
 .meta-card .value { font-size: calc(${pdfSettings.fontSize}px + 2px); font-weight: bold; margin-top: 4px; }
 .pos { color: #059669; }
 .neg { color: #dc2626; }
 .pre-balance { display: flex; justify-content: flex-start; align-items: center; gap: 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 14px; border-bottom-left-radius: 0; border-bottom-right-radius: 0; border-bottom: none; }
 .pre-balance .pb-label { font-size: calc(${pdfSettings.fontSize}px - 1px); text-transform: uppercase; letter-spacing: 0.05em; color: #475569; font-weight: 600; }
 .pre-balance .pb-value { font-size: calc(${pdfSettings.fontSize}px + 2px); font-weight: bold; font-variant-numeric: tabular-nums; }
 table { width: 100%; border-collapse: collapse; margin-top: 8px; }
 thead tr { background: #e2e8f0; }
 th { padding: 8px 10px; font-size: ${pdfSettings.headFontSize}px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #1e293b; text-align: center; border-bottom: 2px solid #94a3b8; }
 td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; text-align: center; }
 tbody tr:nth-child(odd) { background: #f8fafc; }
 tbody tr:nth-child(even) { background: #ffffff; }
 td.num { font-variant-numeric: tabular-nums; }
 th.num { }
 td.hl { background: #eff6ff; }
 tr:last-child td { border-bottom: none; }
 .final-balance { display: flex; justify-content: center; align-items: center; gap: 16px; margin-top: 16px; padding: 12px 20px; border: 2px solid #1e293b; border-radius: 6px; background: #f8fafc; }
 .final-balance .fb-label { font-size: calc(${pdfSettings.fontSize}px + 1px); font-weight: 700; color: #1e293b; }
 .final-balance .fb-value { font-size: calc(${pdfSettings.fontSize}px + 2px); font-weight: 700; font-variant-numeric: tabular-nums; }
 .footer { margin-top: 24px; font-size: calc(${pdfSettings.fontSize}px - 2px); color: #94a3b8; text-align: center; }
 .charges-line { font-size: calc(${pdfSettings.fontSize}px - 1px); font-weight: 600; margin-top: 2px; }
 .charges-desc { font-weight: 400; font-style: italic; color: #94a3b8; }
</style>
</head>
<body>
<div class="header">
 <div class="header-left">
  <img class="brand-logo" src="${logoUrl}" alt="Arkam" />
  <div>
   <p>${t('client_ledger_statement')}</p>
  </div>
 </div>
 ${pdfSettings.showGeneratedOn ? `<div class="header-right"><div>${t('export_generated_on')}: ${exportDate}</div></div>` : ''}
</div>
${metaColCount > 0 ? `<div class="meta">${metaCards.join('')}</div>` : ''}
${pdfSettings.showPreBalance ? `<div class="pre-balance"><span class="pb-label">${t('export_pre_balance')}</span><span class="pb-value ${preBalance >= 0 ? 'pos' : 'neg'}">${preBalance.toLocaleString(numLocale, { maximumFractionDigits: pdfSettings.decimals })}${pdfSettings.showCurrencySymbol ? ` ${ledger.currencySymbol || ledger.currencyCode}` : ''}</span></div>` : ''}
<table${pdfSettings.showPreBalance ? ' style="margin-top:0;border-top:1px solid #e2e8f0"' : ''}>
 <thead>
  <tr>${headerCells}</tr>
 </thead>
 <tbody>
  ${rows}
 </tbody>
</table>
<div class="final-balance">
 <span class="fb-value ${runningBal >= 0 ? 'pos' : 'neg'}">${Math.abs(runningBal).toLocaleString(numLocale, { minimumFractionDigits: pdfSettings.decimals, maximumFractionDigits: pdfSettings.decimals })}${pdfSettings.showCurrencySymbol ? ` ${ledger.currencySymbol || ledger.currencyCode}` : ''}</span>
 <span class="fb-label">${runningBal === 0 ? t('pdf_balance_zero') : runningBal < 0 ? t('pdf_balance_ours') : t('pdf_balance_theirs')}</span>
</div>
${pdfSettings.showFooter ? `<div class="footer">${t('export_generated_on')} ${exportDate}</div>` : ''}
</body>
</html>`;
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
   const html = generateLedgerHtml(ledger, fromDate, toDate, colVisibility, fromEntryKey, toEntryKey);
   const clientName = (selectedClientForLedger?.name ?? 'client').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '');
   const defaultFileName = `${clientName}_${ledger.currencyCode}_${fromDate}_${toDate}.pdf`;
   const result = await accountingApi.exportLedgerPdf({ html, defaultFileName });
   if (result.ok) setPdfExportModal(null);
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_save'));
  }
 }

 function generateArchiveHtml(): string {
  const esc = (value: string) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string);

  const archived = transactions
   .filter((tx) => tx.isArchived || !tx.accountFromId || !tx.accountToId)
   .slice()
   .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const headers = [t('date'), t('transaction_account_from'), t('transaction_account_to'), t('amount'), t('archive_more_info'), t('transaction_description')];
  const headerCells = headers.map((header, index) => `<th${index === 3 ? ' class="num"' : ''}>${esc(header)}</th>`).join('');

  const rows = archived
   .map((tx) => {
    const from = tx.accountFromId
     ? `${esc(tx.clientFromName)} <span style="color:#64748b">${esc(tx.accountFromCurrencyCode)}</span>`
     : `<span class="muted">${esc(t('archive_no_sender'))}</span>`;
    const to = tx.accountToId
     ? `${esc(tx.clientToName)} <span style="color:#64748b">${esc(tx.accountToCurrencyCode)}</span>`
     : `<span class="muted">${esc(t('archive_no_receiver'))}</span>`;
    const amount = tx.amount
     ? `${tx.amount.toLocaleString(numLocale, { maximumFractionDigits: pdfSettings.decimals })}${pdfSettings.showCurrencySymbol ? ` ${esc(tx.currencySymbol || tx.currencyCode)}` : ''}`
     : '-';
    return `<tr><td>${formatDateValue(tx.createdAt, pdfSettings.dateFormat)}</td><td>${from}</td><td>${to}</td><td class="num">${amount}</td><td>${esc(tx.archiveNote)}</td><td>${esc(tx.description)}</td></tr>`;
   })
   .join('');

  const totals = new Map<string, { code: string; symbol: string; total: number }>();
  for (const tx of archived) {
   if (!tx.amount) continue;
   const key = tx.currencyCode || String(tx.currencyId);
   const existing = totals.get(key);
   if (existing) existing.total += tx.amount;
   else totals.set(key, { code: tx.currencyCode, symbol: tx.currencySymbol, total: tx.amount });
  }
  const totalsHtml = [...totals.values()]
   .map(
    (total) =>
     `<span class="total-item">${total.total.toLocaleString(numLocale, { maximumFractionDigits: pdfSettings.decimals })}${pdfSettings.showCurrencySymbol ? ` <span style="color:#64748b">${esc(total.symbol || total.code)}</span>` : ''}</span>`,
   )
   .join('');

  const dir = isRTL ? 'rtl' : 'ltr';
  const logoUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/logo/arkam-logo.png`;
  const exportDate = new Date().toLocaleDateString(language);

  return `<!DOCTYPE html>
<html lang="${language}" dir="${dir}">
<head>
<meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap">
<style>
 * { box-sizing: border-box; margin: 0; padding: 0; }
 body { font-family: ${pdfSettings.fontFamily}; font-size: ${pdfSettings.fontSize}px; color: #1e293b; padding: 32px; }
 .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1e293b; padding-bottom: 12px; margin-bottom: 20px; }
 .header-left { display: flex; align-items: center; gap: 14px; }
 .brand-logo { height: 54px; width: auto; }
 .header-left h1 { font-size: calc(${pdfSettings.fontSize}px + 8px); font-weight: bold; }
 .header-left p { font-size: calc(${pdfSettings.fontSize}px - 1px); color: #64748b; margin-top: 2px; }
 .header-right { text-align: ${isRTL ? 'left' : 'right'}; font-size: calc(${pdfSettings.fontSize}px - 1px); color: #64748b; }
 table { width: 100%; border-collapse: collapse; margin-top: 8px; }
 thead tr { background: #e2e8f0; }
 th { padding: 8px 10px; font-size: ${pdfSettings.headFontSize}px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #1e293b; text-align: center; border-bottom: 2px solid #94a3b8; }
 td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; text-align: center; }
 tbody tr:nth-child(odd) { background: #f8fafc; }
 tbody tr:nth-child(even) { background: #ffffff; }
 td.num { font-variant-numeric: tabular-nums; }
 .muted { color: #94a3b8; font-style: italic; }
 .totals { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 20px; margin-top: 16px; padding: 12px 16px; border: 1px solid #e2e8f0; border-radius: 6px; background: #f8fafc; }
 .totals .totals-label { font-size: calc(${pdfSettings.fontSize}px - 2px); text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-weight: 600; }
 .totals .total-item { font-weight: 700; font-variant-numeric: tabular-nums; }
 .footer { margin-top: 24px; font-size: calc(${pdfSettings.fontSize}px - 2px); color: #94a3b8; text-align: center; }
 .empty { margin-top: 24px; text-align: center; color: #94a3b8; }
</style>
</head>
<body>
<div class="header">
 <div class="header-left">
  <img class="brand-logo" src="${logoUrl}" alt="Arkam" />
  <div>
   <p>${esc(t('archive_title'))}</p>
  </div>
 </div>
 ${pdfSettings.showGeneratedOn ? `<div class="header-right"><div>${t('export_generated_on')}: ${exportDate}</div></div>` : ''}
</div>
${
 archived.length > 0
  ? `<table>
 <thead>
  <tr>${headerCells}</tr>
 </thead>
 <tbody>
  ${rows}
 </tbody>
</table>
${totalsHtml ? `<div class="totals"><span class="totals-label">${esc(t('archive_totals'))}</span>${totalsHtml}</div>` : ''}`
  : `<div class="empty">${esc(t('archive_empty'))}</div>`
}
${pdfSettings.showFooter ? `<div class="footer">${t('export_generated_on')} ${exportDate}</div>` : ''}
</body>
</html>`;
 }

 async function onExportArchivePdf() {
  if (!accountingApi) return;
  try {
   const html = generateArchiveHtml();
   const exportDate = new Date().toISOString().slice(0, 10);
   const result = await accountingApi.exportLedgerPdf({ html, defaultFileName: `archive_${exportDate}.pdf` });
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
 const clientMap = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);
 const sortedClients = useMemo(() => {
  const factor = clientSort.dir === 'asc' ? 1 : -1;
  const sorted = [...clients].sort((a, b) => {
   const aVal = clientSort.key === 'organization' ? a.organizationName || '' : a.name;
   const bVal = clientSort.key === 'organization' ? b.organizationName || '' : b.name;
   return aVal.localeCompare(bVal, language, { sensitivity: 'base' }) * factor;
  });
  const q = clientSearch.trim().toLowerCase();
  if (!q) return sorted;
  return sorted.filter((c) => c.name.toLowerCase().includes(q) || (c.organizationName ?? '').toLowerCase().includes(q));
 }, [clients, clientSort, clientSearch, language]);
 const totalClientPages = Math.max(1, Math.ceil(sortedClients.length / clientsPageSize));
 const clampedClientsPage = Math.min(clientsPage, totalClientPages);
 const paginatedClients = useMemo(() => {
  const start = (clampedClientsPage - 1) * clientsPageSize;
  return sortedClients.slice(start, start + clientsPageSize);
 }, [sortedClients, clampedClientsPage, clientsPageSize]);
 // Clients grouped per organization for the card view; respects the active
 // search/sort (built from sortedClients) and lists clients with no organization last.
 const clientsByOrganization = useMemo(() => {
  const groups = new Map<string, { id: number | null; name: string; clients: Client[] }>();
  for (const client of sortedClients) {
   const key = client.organizationId == null ? '__unassigned__' : String(client.organizationId);
   let group = groups.get(key);
   if (!group) {
    group = { id: client.organizationId, name: client.organizationName || t('unassigned'), clients: [] };
    groups.set(key, group);
   }
   group.clients.push(client);
  }
  const keyOf = (g: { id: number | null }) => (g.id == null ? '__unassigned__' : String(g.id));
  return Array.from(groups.values()).sort((a, b) => {
   // Honour the user's drag-arranged order first; groups without a saved
   // position fall back to alphabetical with "unassigned" last.
   const ia = clientsOrgOrder.indexOf(keyOf(a));
   const ib = clientsOrgOrder.indexOf(keyOf(b));
   if (ia !== -1 && ib !== -1) return ia - ib;
   if (ia !== -1) return -1;
   if (ib !== -1) return 1;
   if (a.id == null) return 1;
   if (b.id == null) return -1;
   return a.name.localeCompare(b.name, language, { sensitivity: 'base' });
  });
 }, [sortedClients, language, t, clientsOrgOrder]);

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

 // Per-client balances for the clients list/group view. Keyed by clientId, each value is
 // an array of { currencyCode, currencySymbol, balance } — one entry per account.
 const clientPageBalances = useMemo((): Map<number, { currencyCode: string; currencySymbol: string; balance: number }[]> => {
  const balanceByAccount = new Map<number, number>();
  for (const account of clientAccounts) {
   balanceByAccount.set(account.id, account.startingBalance ?? 0);
  }
  for (const transaction of transactions) {
   if (transaction.isArchived) continue;
   if (transaction.accountFromId != null && balanceByAccount.has(transaction.accountFromId)) {
    const account = clientAccountMap.get(transaction.accountFromId);
    if (account) {
     const pending = transaction.currencyId !== account.currencyId && transaction.exchangeRateFrom === 0;
     const netChange = pending
      ? 0
      : transaction.amount * transaction.exchangeRateFrom + getCommissionAmount(transaction.amount * transaction.exchangeRateFrom, transaction.commissionFrom);
     balanceByAccount.set(transaction.accountFromId, (balanceByAccount.get(transaction.accountFromId) ?? 0) + netChange);
    }
   }
   if (transaction.accountToId != null && balanceByAccount.has(transaction.accountToId)) {
    const account = clientAccountMap.get(transaction.accountToId);
    if (account) {
     const pending = transaction.currencyId !== account.currencyId && transaction.exchangeRateTo === 0;
     const netChange = pending
      ? 0
      : -(transaction.amount * transaction.exchangeRateTo - getCommissionAmount(transaction.amount * transaction.exchangeRateTo, transaction.commissionTo));
     balanceByAccount.set(transaction.accountToId, (balanceByAccount.get(transaction.accountToId) ?? 0) + netChange);
    }
   }
  }
  for (const adj of adjustments) {
   if (!balanceByAccount.has(adj.accountId)) continue;
   const account = clientAccountMap.get(adj.accountId);
   if (!account) continue;
   const pending = adj.currencyId != null && adj.currencyId !== account.currencyId && (adj.exchangeRate ?? 0) === 0;
   const netChange = pending ? 0 : (adj.direction === 'credit' ? 1 : -1) * adj.amount * (adj.exchangeRate || 1);
   balanceByAccount.set(adj.accountId, (balanceByAccount.get(adj.accountId) ?? 0) + netChange);
  }
  const result = new Map<number, { currencyCode: string; currencySymbol: string; balance: number }[]>();
  for (const account of clientAccounts) {
   const balance = balanceByAccount.get(account.id) ?? 0;
   const arr = result.get(account.clientId) ?? [];
   arr.push({ currencyCode: account.currencyCode, currencySymbol: account.currencySymbol, balance });
   result.set(account.clientId, arr);
  }
  return result;
 }, [clientAccounts, transactions, adjustments, clientAccountMap]);

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

 function generateTransactionsExportHtml(headers: string[], rows: string[][]): string {
  const esc = (value: string) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string);
  const dir = isRTL ? 'rtl' : 'ltr';
  const logoUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/logo/arkam-logo.png`;
  const exportDate = new Date().toLocaleDateString(language);
  const rangeLabel = [transactionExportFrom, transactionExportTo].filter(Boolean).join(' → ');
  const headerCells = headers.map((header) => `<th>${esc(header)}</th>`).join('');
  const bodyRows = rows.map((cells) => `<tr>${cells.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('');

  return `<!DOCTYPE html>
<html lang="${language}" dir="${dir}">
<head>
<meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap">
<style>
 * { box-sizing: border-box; margin: 0; padding: 0; }
 body { font-family: ${pdfSettings.fontFamily}; font-size: ${pdfSettings.fontSize}px; color: #1e293b; padding: 32px; }
 .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1e293b; padding-bottom: 12px; margin-bottom: 20px; }
 .header-left { display: flex; align-items: center; gap: 14px; }
 .brand-logo { height: 54px; width: auto; }
 .header-left h1 { font-size: calc(${pdfSettings.fontSize}px + 8px); font-weight: bold; }
 .header-left p { font-size: calc(${pdfSettings.fontSize}px - 1px); color: #64748b; margin-top: 2px; }
 .header-right { text-align: ${isRTL ? 'left' : 'right'}; font-size: calc(${pdfSettings.fontSize}px - 1px); color: #64748b; }
 table { width: 100%; border-collapse: collapse; margin-top: 8px; }
 thead tr { background: #e2e8f0; }
 th { padding: 8px 10px; font-size: ${pdfSettings.headFontSize}px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #1e293b; text-align: center; border-bottom: 2px solid #94a3b8; }
 td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; text-align: center; }
 tbody tr:nth-child(odd) { background: #f8fafc; }
 tbody tr:nth-child(even) { background: #ffffff; }
 .footer { margin-top: 24px; font-size: calc(${pdfSettings.fontSize}px - 2px); color: #94a3b8; text-align: center; }
 .empty { margin-top: 24px; text-align: center; color: #94a3b8; }
</style>
</head>
<body>
<div class="header">
 <div class="header-left">
  <img class="brand-logo" src="${logoUrl}" alt="Arkam" />
  <div>
   <p>${esc(section === 'archive' ? t('archive_title') : t('transactions_title'))}${rangeLabel ? ` — ${esc(rangeLabel)}` : ''}</p>
  </div>
 </div>
 ${pdfSettings.showGeneratedOn ? `<div class="header-right"><div>${t('export_generated_on')}: ${exportDate}</div></div>` : ''}
</div>
${
 rows.length > 0
  ? `<table>
 <thead>
  <tr>${headerCells}</tr>
 </thead>
 <tbody>
  ${bodyRows}
 </tbody>
</table>`
  : `<div class="empty">${esc(t('transactions_export_empty'))}</div>`
}
${pdfSettings.showFooter ? `<div class="footer">${t('export_generated_on')} ${exportDate}</div>` : ''}
</body>
</html>`;
 }

 async function onExportTransactionsPdf() {
  if (!accountingApi) return;
  setIsExportingTransactions(true);
  try {
   const { headers, rows } = buildTransactionExportData(transactionExportFrom, transactionExportTo);
   const html = generateTransactionsExportHtml(headers, rows);
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

 const selectedClientLedgers: ClientAccountLedger[] = useMemo(() => {
  // Skip expensive ledger computations unless the ledger view/modal is active.
  if (!selectedClientForLedger || (section !== 'client-ledger' && !pdfExportModal)) {
   return [];
  }

  return clientAccounts
   .filter((account) => account.clientId === selectedClientForLedger.id)
   .map((account) => {
    const entries = transactions
     .flatMap<ClientLedgerEntry>((transaction) => {
      // Archive-only records are historical and never affect a client's ledger/balance.
      if (transaction.isArchived) return [];
      if (transaction.accountFromId === account.id) {
       const counterparty = clientAccountMap.get(transaction.accountToId ?? -1);
       // Cross-currency with no exchange rate set yet (0) is pending: shown as a dash and
       // excluded from the balance until the user enters a rate. An explicit rate (incl. 1) counts.
       const pendingRate = transaction.currencyId !== account.currencyId && transaction.exchangeRateFrom === 0;
       return [
        {
         transactionId: transaction.id,
         createdAt: transaction.createdAt,
         counterpartyName: counterparty?.clientName || '-',
         counterpartyClientId: counterparty?.clientId ?? null,
         direction: 'outgoing' as const,
         type: transaction.type,
         amount: transaction.amount,
         currencyCode: transaction.currencyCode,
         currencySymbol: transaction.currencySymbol,
         exchangeRate: transaction.exchangeRateFrom,
         exchangeRateReversed: !!transaction.exchangeRateFromReversed,
         pendingRate,
         commission: transaction.commissionFrom,
         // "Paid by me"/"paid to me" charges are settled directly with the org and never touch a
         // counterparty's ledger; every other payer (incl. the counterparty itself or an unset value) does.
         netChange: pendingRate
          ? 0
          : transaction.amount * transaction.exchangeRateFrom +
            getCommissionAmount(transaction.amount * transaction.exchangeRateFrom, transaction.commissionFrom) +
            (transaction.charges > 0 && chargeShowsInLedger(transaction.chargesPayer)
             ? transaction.chargesPayer === 'from'
               ? -(transaction.charges * transaction.chargesExchangeRate)
               : transaction.charges * transaction.chargesExchangeRate
             : 0),
         runningBalance: 0,
         description: transaction.descriptionFrom?.trim() || transaction.description,
         charges: transaction.charges,
         chargesCurrencyCode: transaction.chargesCurrencyCode,
         chargesPayer: transaction.chargesPayer,
         chargesExchangeRate: transaction.chargesExchangeRate,
         chargesDescription: transaction.chargesDescription,
         isChargesPayerThisAccount: transaction.chargesPayer === 'from',
        },
       ];
      }

      if (transaction.accountToId === account.id) {
       const counterparty = clientAccountMap.get(transaction.accountFromId ?? -1);
       // Cross-currency with no exchange rate set yet (0) is pending (see note above).
       const pendingRate = transaction.currencyId !== account.currencyId && transaction.exchangeRateTo === 0;
       return [
        {
         transactionId: transaction.id,
         createdAt: transaction.createdAt,
         counterpartyName: counterparty?.clientName || '-',
         counterpartyClientId: counterparty?.clientId ?? null,
         direction: 'incoming' as const,
         type: transaction.type,
         amount: transaction.amount,
         currencyCode: transaction.currencyCode,
         currencySymbol: transaction.currencySymbol,
         exchangeRate: transaction.exchangeRateTo,
         exchangeRateReversed: !!transaction.exchangeRateToReversed,
         pendingRate,
         commission: transaction.commissionTo,
         netChange: pendingRate
          ? 0
          : -(transaction.amount * transaction.exchangeRateTo - getCommissionAmount(transaction.amount * transaction.exchangeRateTo, transaction.commissionTo)) +
            (transaction.charges > 0 && chargeShowsInLedger(transaction.chargesPayer)
             ? transaction.chargesPayer === 'to'
               ? -(transaction.charges * transaction.chargesExchangeRate)
               : transaction.charges * transaction.chargesExchangeRate
             : 0),
         runningBalance: 0,
         description: transaction.descriptionTo?.trim() || transaction.description,
         charges: transaction.charges,
         chargesCurrencyCode: transaction.chargesCurrencyCode,
         chargesPayer: transaction.chargesPayer,
         chargesExchangeRate: transaction.chargesExchangeRate,
         chargesDescription: transaction.chargesDescription,
         isChargesPayerThisAccount: transaction.chargesPayer === 'to',
        },
       ];
      }

      return [];
     })
     .concat(
      adjustments
       .filter((adj) => adj.accountId === account.id)
       .map((adj) => ({
        transactionId: -adj.id,
        adjustmentId: adj.id,
        isAdjustment: true as const,
        createdAt: adj.createdAt,
        counterpartyName: '',
        counterpartyClientId: null,
        // debit: client owes us (e.g. gas money) ? balance moves in our favor (negative)
        // credit: we owe the client (e.g. iPhone) ? balance moves in their favor (positive)
        direction: (adj.direction === 'credit' ? 'outgoing' : 'incoming') as 'incoming' | 'outgoing',
        type: 'adjustment',
        amount: adj.amount,
        currencyCode: adj.currencyCode || account.currencyCode,
        currencySymbol: adj.currencySymbol || account.currencySymbol,
        exchangeRate: adj.exchangeRate || 1,
        exchangeRateReversed: !!adj.exchangeRateReversed,
        pendingRate: adj.currencyId != null && adj.currencyId !== account.currencyId && (adj.exchangeRate ?? 0) === 0,
        commission: 0,
        // amount is in the adjustment's own currency; convert to account currency via exchangeRate.
        // A cross-currency adjustment with no rate set (0) is pending and excluded from the balance.
        netChange:
         adj.currencyId != null && adj.currencyId !== account.currencyId && (adj.exchangeRate ?? 0) === 0
          ? 0
          : (adj.direction === 'credit' ? 1 : -1) * adj.amount * (adj.exchangeRate || 1),
        runningBalance: 0,
        description: adj.description,
        charges: 0,
        chargesCurrencyCode: null,
        chargesPayer: '',
        chargesExchangeRate: 1,
        chargesDescription: '',
        isChargesPayerThisAccount: false,
       })),
     )
     .sort((left, right) => {
      const dateDiff = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      if (dateDiff !== 0) return dateDiff;
      const leftId = left.isAdjustment ? (left.adjustmentId ?? 0) : left.transactionId;
      const rightId = right.isAdjustment ? (right.adjustmentId ?? 0) : right.transactionId;
      return leftId - rightId;
     });

    // Entries are ordered purely by createdAt (drag-to-reorder persists the order by
    // rewriting timestamps), so a running balance accumulated in this order is durable.
    let runningBalance = account.startingBalance ?? 0;
    const entriesWithBalance = entries.map((entry) => {
     runningBalance += entry.netChange;
     return {
      ...entry,
      runningBalance,
     };
    });

    return {
     accountId: account.id,
     currencyName: currencyMap.get(account.currencyId)?.name || account.currencyCode,
     currencyCode: account.currencyCode,
     currencySymbol: account.currencySymbol,
     startingBalance: account.startingBalance ?? 0,
     currentBalance: runningBalance,
     transactionCount: entriesWithBalance.length,
     entries: entriesWithBalance,
    };
   })
   .sort((left, right) => left.currencyCode.localeCompare(right.currencyCode));
 }, [adjustments, clientAccounts, clientAccountMap, currencyMap, pdfExportModal, section, selectedClientForLedger, transactions]);

 // Totals for the rows the user has checkbox-selected in the ledger, shown next to the
 // "Delete (N)" action: sum of the entry amounts and sum of their net change.
 const selectedLedgerSummary = useMemo(() => {
  if (selectedLedgerEntryKeys.size === 0) return null;
  const entryByKey = new Map<string, ClientLedgerEntry>();
  for (const ledger of selectedClientLedgers) {
   for (const entry of ledger.entries) {
    entryByKey.set(getLedgerTransactionDraftKey(entry.transactionId, ledger.accountId), entry);
   }
  }
  let amountSum = 0;
  let netChangeSum = 0;
  let count = 0;
  const currencyCodes = new Set<string>();
  for (const key of selectedLedgerEntryKeys) {
   const entry = entryByKey.get(key);
   if (!entry) continue;
   amountSum += entry.amount;
   netChangeSum += entry.netChange;
   currencyCodes.add(entry.currencyCode);
   count += 1;
  }
  // Net change is always expressed in the account's currency.
  const accountCurrency = selectedClientLedgers.find((l) => l.accountId === selectedLedgerAccountId) ?? selectedClientLedgers[0];
  return {
   count,
   amountSum,
   netChangeSum,
   amountCurrencyCode: currencyCodes.size === 1 ? [...currencyCodes][0] : '',
   netCurrencyCode: accountCurrency?.currencyCode ?? '',
  };
 }, [selectedLedgerEntryKeys, selectedClientLedgers, selectedLedgerAccountId]);

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
 const databaseSection = (
  <section className="flex flex-col gap-6">
   <div className={panelClassName}>
    <h2 className="text-2xl font-semibold">{t('backup_title')}</h2>
    <p className="mt-2 text-sm text-slate-600">{t('backup_description')}</p>

    <input
     ref={backupRestoreInputRef}
     type="file"
     accept=".json,application/json"
     onChange={onRestoreBackupFile}
     className="hidden"
    />

    <div className="mt-6 grid gap-4 md:grid-cols-2">
     <div className="rounded border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">{t('backup_download_title')}</h3>
      <p className="mt-1 text-sm text-slate-600">{t('backup_download_hint')}</p>
      <button
       type="button"
       onClick={() => void onDownloadBackup()}
       disabled={isBackingUp || isRestoringBackup}
       className="mt-4 inline-flex items-center gap-2 rounded border border-blue-600 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
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
       {isBackingUp ? t('backup_download_loading') : t('backup_download_button')}
      </button>
      <p className={`mt-3 text-xs ${lastBackupAt ? 'text-slate-500' : 'text-amber-600'}`}>{lastBackupLabel()}</p>
     </div>

     <div className="rounded border border-amber-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">{t('backup_restore_title')}</h3>
      <p className="mt-1 text-sm text-slate-600">{t('backup_restore_hint')}</p>
      <button
       type="button"
       onClick={() => backupRestoreInputRef.current?.click()}
       disabled={isBackingUp || isRestoringBackup}
       className="mt-4 inline-flex items-center gap-2 rounded border border-amber-600 bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
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
        <polyline points="17 8 12 3 7 8" />
        <line
         x1="12"
         y1="3"
         x2="12"
         y2="15"
        />
       </svg>
       {isRestoringBackup ? t('backup_restore_loading') : t('backup_restore_button')}
      </button>
     </div>
    </div>
   </div>
  </section>
 );
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

 const organizationsSection = (
  <section className="grid gap-6 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
   <div className={panelClassName}>
    <h2 className="text-xl font-semibold">{organizationForm.id ? t('update_organization') : t('new_organization')}</h2>
    <p className="mt-1 text-sm text-slate-600">{t('organizations_description')}</p>

    <form
     onSubmit={(event) => void onOrganizationSubmit(event)}
     className="mt-5"
    >
     <label className="block text-sm font-medium">{t('organization_name')}</label>
     <input
      type="text"
      value={organizationForm.name}
      onChange={(event) => setOrganizationForm((current) => ({ ...current, name: event.target.value }))}
      placeholder={t('organization_name_placeholder')}
      className="mt-2 w-full rounded border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
      required
     />

     <button
      type="submit"
      className="mt-6 w-full rounded bg-blue-700 px-4 py-2 font-medium text-white transition hover:bg-blue-800"
     >
      {organizationForm.id ? t('update_organization') : t('save_organization')}
     </button>
    </form>
   </div>

   <div className={panelClassName}>
    <h2 className="text-xl font-semibold">{t('organizations_title')}</h2>
    <div className={tableWrapClassName}>
     <table className="w-full text-sm">
      <thead className="bg-slate-100 text-slate-700">
       <tr>
        <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('name')}</th>
        <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('actions')}</th>
       </tr>
      </thead>
      <tbody>
       {organizations.map((organization) => (
        <tr
         key={organization.id}
         className="border-t border-slate-200 align-top"
        >
         <td className="px-4 py-3 font-medium text-slate-900">
          <a
           href={`/organizations/${organization.id}`}
           onClick={(e) => {
            if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
            e.preventDefault();
            openOrganizationClientsPage(organization);
           }}
           className="cursor-pointer text-left text-slate-900 transition hover:text-blue-700"
          >
           {organization.name}
          </a>
         </td>
         <td className="px-4 py-3">
          <div className="flex flex-wrap gap-2">
           <a
            href={`/organizations/${organization.id}`}
            onClick={(e) => {
             if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
             e.preventDefault();
             openOrganizationClientsPage(organization);
            }}
            className="cursor-pointer rounded border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
           >
            {t('organization_page_open')}
           </a>
           <button
            type="button"
            onClick={() =>
             setOrganizationForm({
              id: organization.id,
              name: organization.name,
             })
            }
            className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
           >
            {t('edit')}
           </button>
           <button
            type="button"
            onClick={() => onDeleteOrganization(organization.id)}
            className="rounded border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
           >
            {t('delete')}
           </button>
          </div>
         </td>
        </tr>
       ))}
       {organizations.length === 0 ? (
        <tr>
         <td
          className="px-4 py-6 text-slate-500"
          colSpan={2}
         >
          {t('no_organizations')}
         </td>
        </tr>
       ) : null}
      </tbody>
     </table>
    </div>
   </div>
  </section>
 );

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

 const clientsSection = (
  <section className="grid gap-6 xl:grid-cols-[380px_1fr]">
   <div className="flex flex-col gap-6">
    <form
     onSubmit={onClientSubmit}
     className={panelClassName}
    >
     <div className="flex items-center justify-between gap-3">
      <div>
       <h2 className="text-xl font-semibold">{clientForm.id ? t('update_client') : t('new_client')}</h2>
       <p className="mt-1 text-sm text-slate-600">{t('clients_description')}</p>
      </div>
      {clientForm.id ? (
       <button
        type="button"
        onClick={() => {
         setClientForm(emptyClientForm());
         setOpenAccountOnCreate(true);
         setNewClientAccountDrafts([createNewClientAccountDraft()]);
        }}
        className="rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
       >
        {t('cancel')}
       </button>
      ) : null}
     </div>

     <label className="mt-5 block text-sm font-medium">{t('client_name')}</label>
     <input
      value={clientForm.name}
      onChange={(event) => setClientForm((current) => ({ ...current, name: event.target.value }))}
      className="mt-2 w-full rounded border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
      placeholder={t('client_name_placeholder')}
      required
     />

     <label className="mt-4 block text-sm font-medium">{t('client_organization')}</label>
     <select
      value={clientForm.organizationId ?? ''}
      onChange={(event) => {
       if (event.target.value === '__create__') {
        setOrganizationForm(emptyOrganizationForm());
        setShowCreateOrgDialog(true);
        return;
       }
       setClientForm((current) => ({
        ...current,
        organizationId: event.target.value ? Number(event.target.value) : null,
       }));
      }}
      className="mt-2 w-full rounded border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
     >
      <option value="">{t('client_organization_placeholder')}</option>
      {organizations.map((organization) => (
       <option
        key={organization.id}
        value={organization.id}
       >
        {organization.name}
       </option>
      ))}
      <option value="__create__">{t('client_organization_create')}</option>
     </select>

     <label className="mt-4 block text-sm font-medium">{t('client_email')}</label>
     <input
      value={clientForm.email}
      onChange={(event) => setClientForm((current) => ({ ...current, email: event.target.value }))}
      className="mt-2 w-full rounded border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
      placeholder={t('client_email_placeholder')}
     />

     <label className="mt-4 block text-sm font-medium">{t('client_phone')}</label>
     <input
      value={clientForm.phone}
      onChange={(event) => setClientForm((current) => ({ ...current, phone: event.target.value }))}
      className="mt-2 w-full rounded border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
      placeholder={t('client_phone_placeholder')}
     />

     <label className="mt-4 block text-sm font-medium">{t('client_address')}</label>
     <textarea
      value={clientForm.address}
      onChange={(event) => setClientForm((current) => ({ ...current, address: event.target.value }))}
      className="mt-2 min-h-28 w-full rounded border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
      placeholder={t('client_address_placeholder')}
     />

     {!clientForm.id ? (
      <div className="mt-4 rounded border border-slate-200/70 bg-slate-50/85 p-4">
       <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
        <input
         type="checkbox"
         checked={openAccountOnCreate}
         onChange={(event) => {
          const checked = event.target.checked;
          setOpenAccountOnCreate(checked);
          if (!checked) {
           setNewClientAccountDrafts([createNewClientAccountDraft()]);
          }
         }}
         className="h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-400"
        />
        {t('client_account_open')}
       </label>

       {openAccountOnCreate ? (
        <div className="mt-3 space-y-2">
         {newClientAccountDrafts.map((draft, index) => (
          <div
           key={`new-client-account-${index}`}
           className="rounded border border-slate-200/70 bg-white/90 p-3"
          >
           <div className="flex flex-col gap-2 sm:flex-row">
            <select
             value={draft.currencyId ?? ''}
             onChange={(event) => {
              const currencyId = event.target.value ? Number(event.target.value) : null;
              setNewClientAccountDrafts((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, currencyId } : row)));
             }}
             className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
            >
             <option value="">{t('client_account_currency_placeholder')}</option>
             {enabledCurrencies
              .filter((currency) => !newClientAccountDrafts.some((row, rowIndex) => rowIndex !== index && row.currencyId === currency.id))
              .map((currency) => (
               <option
                key={currency.id}
                value={currency.id}
               >
                {currency.code} - {currency.name}
               </option>
              ))}
            </select>
           </div>
           <div className="mt-2">
            <p className="text-xs font-medium text-slate-500">{t('starting_balance')}</p>
            <div className="mt-1 flex items-center gap-2">
             <div className="flex rounded border border-slate-300 overflow-hidden text-xs font-semibold">
              <button
               type="button"
               onClick={() => setNewClientAccountDrafts((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, balanceType: 'debit' } : row)))}
               className={`px-3 py-2 transition ${draft.balanceType === 'debit' ? 'bg-red-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
               {t('balance_type_debit')}
              </button>
              <button
               type="button"
               onClick={() => setNewClientAccountDrafts((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, balanceType: 'credit' } : row)))}
               className={`px-3 py-2 transition ${draft.balanceType === 'credit' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
               {t('balance_type_credit')}
              </button>
             </div>
             <input
              type="text"
              inputMode="decimal"
              value={formatAmountInput(draft.startingBalance)}
              onChange={(event) => {
               const nextBalance = normalizeDecimalInput(event.target.value);
               setNewClientAccountDrafts((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, startingBalance: nextBalance } : row)));
              }}
              placeholder="0"
              className="w-36 rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
             />
            </div>
            <p className="mt-1 text-xs text-slate-400">{t('balance_type_hint')}</p>
           </div>
           {newClientAccountDrafts.length > 1 ? (
            <button
             type="button"
             onClick={() => setNewClientAccountDrafts((current) => current.filter((_, rowIndex) => rowIndex !== index))}
             className="mt-2 inline-flex rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
            >
             {t('client_account_remove')}
            </button>
           ) : null}
          </div>
         ))}

         <button
          type="button"
          onClick={() => setNewClientAccountDrafts((current) => [...current, createNewClientAccountDraft()])}
          className="inline-flex rounded border border-blue-100 bg-blue-50/60 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
         >
          {t('client_account_open_another')}
         </button>
        </div>
       ) : null}
      </div>
     ) : null}

     <button
      type="submit"
      className="mt-6 w-full rounded bg-blue-700 px-4 py-2 font-medium text-white transition hover:bg-blue-800"
     >
      {clientForm.id ? t('update_client') : t('save_client')}
     </button>
    </form>
    {accountsClient ? (
     <div className={panelClassName}>
      <div className="flex items-center justify-between gap-3">
       <h2 className="text-lg font-semibold">
        {t('client_accounts_for')}: <span className="text-blue-700">{accountsClient.name}</span>
       </h2>
      </div>

      <div className="mt-4 space-y-2">
       {clientAccounts
        .filter((a) => a.clientId === accountsClient.id)
        .map((account) => {
         const isEditing = editingAccountId === account.id;
         return (
          <div
           key={account.id}
           className="rounded border border-slate-200 bg-white"
          >
           {/* Row · click to edit */}
           <button
            type="button"
            className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition"
            onClick={() => {
             setMoveTargetAccountId(null);
             if (isEditing) {
              setEditingAccountId(null);
             } else {
              const absBalance = Math.abs(account.startingBalance ?? 0);
              setEditingAccountId(account.id);
              setEditingAccountCurrencyId(account.currencyId);
              setEditingAccountBalance(String(absBalance));
              setEditingAccountBalanceType((account.startingBalance ?? 0) >= 0 ? 'credit' : 'debit');
              setShowAddAccountForm(false);
             }
            }}
           >
            <div className="flex items-center gap-3">
             <span className="font-mono font-semibold text-slate-800">{account.currencyCode}</span>
             <span className="text-sm text-slate-500">{account.currencySymbol || ''}</span>
            </div>
            <div className="flex items-center gap-3">
             <span className={`text-sm font-semibold ${(account.startingBalance ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {(account.startingBalance ?? 0).toLocaleString(numLocale, { maximumFractionDigits: 2 })}
             </span>
             <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`text-slate-400 transition-transform ${isEditing ? 'rotate-180' : ''}`}
             >
              <path d="m6 9 6 6 6-6" />
             </svg>
            </div>
           </button>

           {/* Inline edit form */}
           {isEditing && (
            <div className="border-t border-slate-200 bg-slate-50 px-4 py-4">
             <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">{t('client_account_edit')}</p>
             <div className="flex flex-col gap-3">
              <select
               value={editingAccountCurrencyId ?? ''}
               onChange={(event) => setEditingAccountCurrencyId(event.target.value ? Number(event.target.value) : null)}
               className="rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
              >
               <option value="">{t('client_account_currency_placeholder')}</option>
               {enabledCurrencies.map((cur) => (
                <option
                 key={cur.id}
                 value={cur.id}
                >
                 {cur.code} · {cur.name}
                </option>
               ))}
              </select>
              <div>
               <p className="text-xs font-medium text-slate-500">{t('starting_balance')}</p>
               <div className="mt-1 flex items-center gap-2">
                <div className="flex rounded border border-slate-300 overflow-hidden text-xs font-semibold">
                 <button
                  type="button"
                  onClick={() => setEditingAccountBalanceType('debit')}
                  className={`px-3 py-2 transition ${editingAccountBalanceType === 'debit' ? 'bg-red-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                 >
                  {t('balance_type_debit')}
                 </button>
                 <button
                  type="button"
                  onClick={() => setEditingAccountBalanceType('credit')}
                  className={`px-3 py-2 transition ${editingAccountBalanceType === 'credit' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                 >
                  {t('balance_type_credit')}
                 </button>
                </div>
                <input
                 type="text"
                 inputMode="decimal"
                 value={editingAccountBalance}
                 onChange={(event) => setEditingAccountBalance(event.target.value.replace(/,/g, ''))}
                 onKeyDown={(event) => {
                  if (event.key === 'Enter' && editingAccountCurrencyId) void onSaveEditAccount();
                 }}
                 placeholder="0"
                 className="w-36 rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                />
               </div>
               <p className="mt-1 text-xs text-slate-400">{t('balance_type_hint')}</p>
              </div>
              <div className="flex gap-2">
               <button
                type="button"
                onClick={() => void onSaveEditAccount()}
                disabled={!editingAccountCurrencyId}
                className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:opacity-40"
               >
                {t('client_account_save')}
               </button>
               <button
                type="button"
                onClick={() => onDeleteClientAccount(account.id)}
                className="rounded border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 transition"
               >
                {t('delete')}
               </button>
               <button
                type="button"
                onClick={() => setEditingAccountId(null)}
                className="rounded border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 transition"
               >
                {t('cancel')}
               </button>
              </div>

              {(() => {
               // Transactions can only be migrated between accounts of the SAME client
               // (e.g. Youssef EUR → Youssef USD), never to another client's account.
               const moveTargets = clientAccounts.filter((a) => a.id !== account.id && a.clientId === account.clientId);
               return (
                <div className="mt-4 border-t border-slate-200 pt-4">
                 <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('client_account_move_title')}</p>
                 <p className="mt-1 text-xs text-slate-400">{t('client_account_move_hint')}</p>
                 {moveTargets.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500">{t('client_account_move_no_targets')}</p>
                 ) : (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                   <select
                    value={moveTargetAccountId ?? ''}
                    onChange={(event) => setMoveTargetAccountId(event.target.value ? Number(event.target.value) : null)}
                    className="min-w-48 flex-1 rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                   >
                    <option value="">{t('client_account_move_select_placeholder')}</option>
                    {moveTargets.map((target) => (
                     <option
                      key={target.id}
                      value={target.id}
                     >
                      {target.currencyCode}
                      {target.currencySymbol ? ` (${target.currencySymbol})` : ''}
                     </option>
                    ))}
                   </select>
                   <button
                    type="button"
                    onClick={() => void onMoveAccountTransactions(account.id)}
                    disabled={!moveTargetAccountId || isMovingAccount}
                    className="rounded border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40"
                   >
                    {t('client_account_move_action')}
                   </button>
                  </div>
                 )}
                </div>
               );
              })()}
             </div>
            </div>
           )}
          </div>
         );
        })}
       {clientAccounts.filter((a) => a.clientId === accountsClient.id).length === 0 ? <p className="text-sm text-slate-500">{t('no_client_accounts')}</p> : null}
      </div>

      {/* Add account */}
      {!showAddAccountForm ? (
       <button
        type="button"
        onClick={() => {
         setShowAddAccountForm(true);
         setEditingAccountId(null);
        }}
        className="mt-4 rounded border border-dashed border-blue-400 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 transition"
       >
        {t('client_account_add_new')}
       </button>
      ) : (
       <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">{t('client_account_add_new')}</p>
        <div className="flex flex-col gap-3">
         <select
          value={newAccountCurrencyId ?? ''}
          onChange={(event) => setNewAccountCurrencyId(event.target.value ? Number(event.target.value) : null)}
          className="rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
         >
          <option value="">{t('client_account_currency_placeholder')}</option>
          {enabledCurrencies
           .filter((cur) => !clientAccounts.some((a) => a.clientId === accountsClient.id && a.currencyId === cur.id))
           .map((cur) => (
            <option
             key={cur.id}
             value={cur.id}
            >
             {cur.code} · {cur.name}
            </option>
           ))}
         </select>
         <div>
          <p className="text-xs font-medium text-slate-500">{t('starting_balance')}</p>
          <div className="mt-1 flex items-center gap-2">
           <div className="flex rounded border border-slate-300 overflow-hidden text-xs font-semibold">
            <button
             type="button"
             onClick={() => setNewAccountBalanceType('debit')}
             className={`px-3 py-2 transition ${newAccountBalanceType === 'debit' ? 'bg-red-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
             {t('balance_type_debit')}
            </button>
            <button
             type="button"
             onClick={() => setNewAccountBalanceType('credit')}
             className={`px-3 py-2 transition ${newAccountBalanceType === 'credit' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
             {t('balance_type_credit')}
            </button>
           </div>
           <input
            type="text"
            inputMode="decimal"
            value={newAccountStartingBalance}
            onChange={(event) => setNewAccountStartingBalance(event.target.value.replace(/,/g, ''))}
            onKeyDown={(event) => {
             if (event.key === 'Enter' && newAccountCurrencyId && accountsClient) void onAddClientAccount(accountsClient.id);
            }}
            placeholder="0"
            className="w-36 rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
           />
          </div>
          <p className="mt-1 text-xs text-slate-400">{t('balance_type_hint')}</p>
         </div>
         <div className="flex gap-2">
          <button
           type="button"
           onClick={() => void onAddClientAccount(accountsClient.id)}
           disabled={!newAccountCurrencyId}
           className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
           {t('client_account_open')}
          </button>
          <button
           type="button"
           onClick={() => {
            setShowAddAccountForm(false);
            setNewAccountCurrencyId(null);
            setNewAccountStartingBalance('0');
            setNewAccountBalanceType('debit');
           }}
           className="rounded border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 transition"
          >
           {t('cancel')}
          </button>
         </div>
        </div>
       </div>
      )}
     </div>
    ) : null}
   </div>

   <div className="flex flex-col gap-4">
    <div className={panelClassName}>
     <div className="flex items-center justify-between gap-3">
      <h2 className="text-xl font-semibold">{t('clients_title')}</h2>
      <div className="relative">
       <svg
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
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
        <circle
         cx="11"
         cy="11"
         r="8"
        />
        <line
         x1="21"
         y1="21"
         x2="16.65"
         y2="16.65"
        />
       </svg>
       <input
        type="search"
        value={clientSearch}
        onChange={(e) => setClientSearch(e.target.value)}
        placeholder={t('search')}
        className="rounded border border-slate-300 py-2 pl-8 pr-3 text-sm outline-none ring-blue-300 focus:ring"
       />
      </div>
     </div>
     <div className={tableWrapClassName}>
      <table className="w-full text-sm">
       <thead className="bg-slate-100 text-slate-700">
        <tr>
         {clientSortHeader('name', t('name'))}
         {clientSortHeader('organization', t('client_organization'))}
         <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('client_accounts')}</th>
         <th className="px-4 py-3" />
        </tr>
       </thead>
       <tbody>
        {paginatedClients.map((client, index) => (
         <tr
          key={client.id}
          className={`border-t border-slate-200 align-top ${index % 2 === 1 ? 'bg-slate-50' : 'bg-white'} hover:bg-slate-100`}
         >
          <td className="px-4 py-3 font-medium text-slate-900">
           <a
            href={`/clients/${client.id}`}
            onClick={(e) => {
             if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
             e.preventDefault();
             openClientLedger(client, 'clients');
            }}
            className="cursor-pointer text-left text-slate-900 transition hover:text-blue-700"
           >
            {client.name}
           </a>
          </td>
          <td className="px-4 py-3 text-slate-600">{client.organizationName || t('unassigned')}</td>
          <td className="px-4 py-3">
           {(() => {
            const accts = clientAccounts.filter((a) => a.clientId === client.id);
            if (accts.length === 0) return <span className="text-xs text-slate-400">—</span>;
            return (
             <div className="flex flex-wrap items-center gap-1">
              {accts.map((a) => (
               <span
                key={a.id}
                title={a.currencyCode}
                className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full border border-slate-300 bg-slate-50 px-1.5 text-xs font-semibold text-slate-600"
               >
                {a.currencySymbol || a.currencyCode}
               </span>
              ))}
             </div>
            );
           })()}
          </td>
          <td className="px-4 py-3">
           <div className="flex items-center gap-1">
            <button
             type="button"
             title={t('edit')}
             onClick={() => {
              setClientForm({
               id: client.id,
               organizationId: client.organizationId,
               name: client.name,
               email: client.email,
               phone: client.phone,
               address: client.address,
              });
              setOpenAccountOnCreate(false);
              setNewClientAccountDrafts([createNewClientAccountDraft()]);
             }}
             className="cursor-pointer rounded p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
            >
             <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4"
             >
              <path d="M5.433 13.917l1.262-3.155A4 4 0 017.58 9.42l6.92-6.918a2.121 2.121 0 013 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 01-.65-.65z" />
              <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0010 3H4.75A2.75 2.75 0 002 5.75v9.5A2.75 2.75 0 004.75 18h9.5A2.75 2.75 0 0017 15.25V10a.75.75 0 00-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5z" />
             </svg>
            </button>
            <button
             type="button"
             title={t('delete')}
             onClick={() => onDeleteClient(client.id)}
             className="cursor-pointer rounded p-1.5 text-red-400 transition hover:bg-red-50 hover:text-red-600"
            >
             <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4"
             >
              <path
               fillRule="evenodd"
               d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
               clipRule="evenodd"
              />
             </svg>
            </button>
           </div>
          </td>
         </tr>
        ))}
        {clients.length === 0 ? (
         <tr>
          <td
           className="px-4 py-6 text-slate-500"
           colSpan={4}
          >
           {t('no_clients')}
          </td>
         </tr>
        ) : sortedClients.length === 0 ? (
         <tr>
          <td
           className="px-4 py-6 text-slate-500"
           colSpan={4}
          >
           {t('no_search_results')}
          </td>
         </tr>
        ) : null}
       </tbody>
      </table>
     </div>
     {sortedClients.length > clientsPageSize ? (
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
       <div className="text-xs text-slate-600">
        {(clampedClientsPage - 1) * clientsPageSize + 1}–{Math.min(sortedClients.length, clampedClientsPage * clientsPageSize)} {t('pagination_of')} {sortedClients.length}
       </div>
       <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-slate-500">{t('pagination_per_page')}</span>
        <select
         value={clientsPageSize}
         onChange={(event) => setClientsPageSize(Number(event.target.value))}
         className="rounded border border-slate-300 px-1.5 py-1 text-xs outline-none ring-blue-300 focus:ring"
        >
         <option value={25}>25</option>
         <option value={50}>50</option>
         <option value={100}>100</option>
        </select>
        <button
         type="button"
         onClick={() => setClientsPage((current) => Math.max(1, Math.min(current, totalClientPages) - 1))}
         disabled={clampedClientsPage <= 1}
         className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
         {t('pagination_prev')}
        </button>
        <input
         key={clampedClientsPage}
         type="number"
         min={1}
         max={totalClientPages}
         defaultValue={clampedClientsPage}
         onBlur={(event) => {
          const n = parseInt(event.target.value, 10);
          if (n >= 1 && n <= totalClientPages) setClientsPage(n);
          else event.target.value = String(clampedClientsPage);
         }}
         onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
         }}
         className="w-14 rounded border border-slate-300 px-1.5 py-1 text-center text-xs outline-none ring-blue-300 focus:ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <span className="text-xs text-slate-500">/ {totalClientPages}</span>
        <button
         type="button"
         onClick={() => setClientsPage((current) => Math.min(totalClientPages, Math.min(current, totalClientPages) + 1))}
         disabled={clampedClientsPage >= totalClientPages}
         className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
         {t('pagination_next')}
        </button>
       </div>
      </div>
     ) : null}
    </div>
   </div>
  </section>
 );

 const organizationsReadOnlySection = (
  <section className={panelClassName}>
   <div className="flex items-start justify-between gap-4">
    <div>
     <h2 className="text-xl font-semibold">{t('organizations_title')}</h2>
    </div>
    <button
     type="button"
     onClick={() => {
      setSettingsTab('organizations');
      navigateToSection('settings');
     }}
     className="rounded border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
    >
     {t('open_in_settings')}
    </button>
   </div>

   <div className={tableWrapClassName}>
    <table className="w-full text-sm">
     <thead className="bg-slate-100 text-slate-700">
      <tr>
       <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('name')}</th>
       <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('overview_clients')}</th>
      </tr>
     </thead>
     <tbody>
      {organizations.map((organization) => (
       <tr
        key={organization.id}
        className="border-t border-slate-200 align-top"
       >
        <td className="px-4 py-3 font-medium text-slate-900">
         <a
          href={`/organizations/${organization.id}`}
          onClick={(e) => {
           if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
           e.preventDefault();
           openOrganizationClientsPage(organization);
          }}
          className="cursor-pointer text-left text-slate-900 transition hover:text-blue-700"
         >
          {organization.name}
         </a>
        </td>
        <td className="px-4 py-3 text-slate-600">{clients.filter((client) => client.organizationId === organization.id).length}</td>
       </tr>
      ))}
      {organizations.length === 0 ? (
       <tr>
        <td
         className="px-4 py-6 text-slate-500"
         colSpan={2}
        >
         {t('no_organizations')}
        </td>
       </tr>
      ) : null}
     </tbody>
    </table>
   </div>
  </section>
 );

 const clientsReadOnlySection = (
  <section className="flex flex-col gap-4">
   <div className={panelClassName}>
    <div className="mb-4 flex items-start justify-between gap-4">
     <div>
      <h2 className="text-xl font-semibold">{t('clients_title')}</h2>
     </div>
     <div className="flex items-center gap-2">
      <div className="relative">
       <svg
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
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
        <circle
         cx="11"
         cy="11"
         r="8"
        />
        <line
         x1="21"
         y1="21"
         x2="16.65"
         y2="16.65"
        />
       </svg>
       <input
        type="search"
        value={clientSearch}
        onChange={(e) => setClientSearch(e.target.value)}
        placeholder={t('search')}
        className="rounded border border-slate-300 py-2 pl-8 pr-3 text-sm outline-none ring-blue-300 focus:ring"
       />
      </div>
      <button
       type="button"
       onClick={() => setClientsGroupByOrg((current) => !current)}
       className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
      >
       {clientsGroupByOrg ? t('clients_view_as_list') : t('clients_group_by_org')}
      </button>
      <button
       type="button"
       onClick={() => {
        setSettingsTab('clients');
        navigateToSection('settings');
       }}
       className="rounded border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
      >
       {t('open_in_settings')}
      </button>
     </div>
    </div>

    {clients.length === 0 ? (
     <p className="px-1 py-6 text-slate-500">{t('no_clients')}</p>
    ) : sortedClients.length === 0 ? (
     <p className="px-1 py-6 text-slate-500">{t('no_search_results')}</p>
    ) : clientsGroupByOrg ? (
     <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {clientsByOrganization.map((group) => {
       const orgKey = group.id == null ? '__unassigned__' : String(group.id);
       return (
        <div
         key={orgKey}
         draggable
         onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          setDraggedOrgKey(orgKey);
         }}
         onDragOver={(event) => {
          event.preventDefault();
          setDragOverOrgKey(orgKey);
         }}
         onDragLeave={() => setDragOverOrgKey((prev) => (prev === orgKey ? null : prev))}
         onDrop={() => onClientsOrgDrop(orgKey)}
         onDragEnd={() => {
          setDraggedOrgKey(null);
          setDragOverOrgKey(null);
         }}
         className={`flex flex-col overflow-hidden rounded border bg-white transition ${
          dragOverOrgKey === orgKey && draggedOrgKey !== orgKey ? 'border-blue-500 ring-2 ring-blue-300' : 'border-slate-200'
         } ${draggedOrgKey === orgKey ? 'opacity-50' : ''}`}
        >
         <div
          className="flex cursor-move items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5"
          title={t('clients_drag_org_hint')}
         >
          <span className="flex min-w-0 items-center gap-1.5">
           <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden
            className="shrink-0 text-slate-400"
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
           <h3 className="truncate font-semibold text-slate-800">{group.name}</h3>
          </span>
          <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">{group.clients.length}</span>
         </div>
         <ul className="divide-y divide-slate-100">
          {group.clients.map((client) => (
           <li
            key={client.id}
            className="flex items-center justify-between gap-2 px-4 py-2.5"
           >
            <a
             href={`/clients/${client.id}`}
             onClick={(e) => {
              if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
              e.preventDefault();
              openClientLedger(client, 'clients');
             }}
             className="min-w-0 flex-1 truncate text-left font-medium text-slate-900 transition hover:text-blue-700"
            >
             {client.name}
            </a>
            <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
             {(clientPageBalances.get(client.id) ?? []).map(({ currencyCode, currencySymbol, balance }) => (
              <span
               key={currencyCode}
               className={`rounded px-1.5 py-0.5 font-mono text-xs font-semibold ${balance >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}
              >
               {currencySymbol || currencyCode} {balance.toLocaleString(numLocale, { maximumFractionDigits: 0 })}
              </span>
             ))}
            </span>
           </li>
          ))}
         </ul>
        </div>
       );
      })}
     </div>
    ) : (
     <div className={tableWrapClassName}>
      <table className="w-full text-sm">
       <thead className="bg-slate-100 text-slate-700">
        <tr>
         {clientSortHeader('name', t('name'))}
         {clientSortHeader('organization', t('client_organization'))}
         <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('client_accounts')}</th>
         <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('client_page_current_balance')}</th>
        </tr>
       </thead>
       <tbody>
        {sortedClients.map((client) => (
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
             openClientLedger(client, 'clients');
            }}
            className="cursor-pointer text-left text-slate-900 transition hover:text-blue-700"
           >
            {client.name}
           </a>
          </td>
          <td className="px-4 py-3 text-slate-600">{client.organizationName || t('unassigned')}</td>
          <td className="px-4 py-3 text-slate-600">{client.accountCount}</td>
          <td className="px-4 py-3">
           <div className="flex flex-wrap gap-1">
            {(clientPageBalances.get(client.id) ?? []).map(({ currencyCode, currencySymbol, balance }) => (
             <span
              key={currencyCode}
              className={`rounded px-1.5 py-0.5 font-mono text-xs font-semibold ${balance >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}
             >
              {currencySymbol || currencyCode} {balance.toLocaleString(numLocale, { maximumFractionDigits: 0 })}
             </span>
            ))}
           </div>
          </td>
         </tr>
        ))}
       </tbody>
      </table>
     </div>
    )}
   </div>

   {selectedClientForAccounts ? (
    <div className={panelClassName}>
     <div className="flex items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">
       {t('client_accounts_for')}: <span className="text-blue-700">{selectedClientForAccounts.name}</span>
      </h2>
      <button
       type="button"
       onClick={() => setSelectedClientForAccounts(null)}
       className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
      >
       {t('cancel')}
      </button>
     </div>

     <div className="mt-4 space-y-2">
      {clientAccounts
       .filter((a) => a.clientId === selectedClientForAccounts.id)
       .map((account) => (
        <div
         key={account.id}
         className="flex items-center justify-between rounded border border-slate-200 px-4 py-3"
        >
         <span className="font-mono font-semibold text-slate-800">{account.currencySymbol || account.currencyCode}</span>
        </div>
       ))}
      {clientAccounts.filter((a) => a.clientId === selectedClientForAccounts.id).length === 0 ? <p className="text-sm text-slate-500">{t('no_client_accounts')}</p> : null}
     </div>
    </div>
   ) : null}
  </section>
 );

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
    {settingsTab === 'team' ? <TeamSettings /> : null}
    {settingsTab === 'database' ? databaseSection : null}
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
    {settingsTab === 'clients' ? clientsSection : null}
    {settingsTab === 'organizations' ? organizationsSection : null}
    {settingsTab === 'currencies' ? (
     <CurrenciesSection
      localizedCurrencies={localizedCurrencies}
      enabledCurrencies={enabledCurrencies}
      clientAccounts={clientAccounts}
      transactions={transactions}
      setCurrencies={setCurrencies}
      onReload={loadData}
      onError={setError}
     />
    ) : null}
   </div>
  </section>
 );

 return (
  <div className={`min-h-screen flex bg-gray-100 text-gray-900 ${isRTL ? 'rtl' : 'ltr'}`}>
   <main className="flex w-full">
    {/* Classic sidebar - desktop only */}
    <aside
     className={`hidden lg:flex flex-col text-white border-r shrink-0 transition-[width,background-color] duration-200 ${
      section === 'settings' ? 'bg-[#3b2f63] border-[#2a2049]' : 'bg-[#1e3a5f] border-[#15304f]'
     } ${isSidebarCollapsed ? 'w-16' : 'w-56'}`}
     style={{ position: 'sticky', top: 0, height: '100vh', overflowY: 'auto' }}
    >
     {/* Brand */}
     <div className={`flex items-center border-b border-white/10 px-3 py-3 ${isSidebarCollapsed ? 'justify-center' : 'justify-between gap-2'}`}>
      {!isSidebarCollapsed && (
       <div className="flex min-w-0 items-center rounded-lg bg-white px-2.5 py-1.5 shadow-sm">
        <Image
         src="/logo/arkam-logo.png"
         alt="Arkam"
         width={720}
         height={876}
         priority
         className="h-9 w-auto"
        />
       </div>
      )}
      <button
       type="button"
       onClick={() =>
        setIsSidebarCollapsed((current) => {
         const next = !current;
         try {
          localStorage.setItem('arkam:sidebar-collapsed', String(next));
         } catch {}
         return next;
        })
       }
       aria-label={isSidebarCollapsed ? t('sidebar_expand') : t('sidebar_collapse')}
       title={isSidebarCollapsed ? t('sidebar_expand') : t('sidebar_collapse')}
       className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-white/20 text-blue-200 transition hover:bg-white/10 hover:text-white"
      >
       {isSidebarCollapsed ? (isRTL ? '<' : '>') : isRTL ? '>' : '<'}
      </button>
     </div>
     {/* Navigation */}
     <nav className="flex-1 py-1">
      {sidebarItems.map((item) => {
       const isActive = item.isActive;
       return (
        <button
         key={item.id}
         type="button"
         onClick={item.onClick}
         aria-pressed={isActive}
         aria-label={item.label}
         title={item.label}
         className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-sm font-medium transition ${
          isActive ? (section === 'settings' ? 'bg-purple-600 text-white' : 'bg-blue-600 text-white') : 'text-blue-100 hover:bg-white/10 hover:text-white'
         } ${isSidebarCollapsed ? 'justify-center' : ''}`}
        >
         <span className="shrink-0">{renderIcon(item.icon, 'h-4 w-4')}</span>
         {isSidebarCollapsed ? null : <span className="truncate">{item.label}</span>}
        </button>
       );
      })}

      {/* Settings entry — expands its sub-tabs in place instead of swapping the sidebar. */}
      <button
       type="button"
       onClick={() => navigateToSection('settings')}
       aria-pressed={section === 'settings'}
       aria-label={t('settings_title')}
       title={t('settings_title')}
       className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-sm font-medium transition ${
        section === 'settings' ? 'bg-purple-600 text-white' : 'text-blue-100 hover:bg-white/10 hover:text-white'
       } ${isSidebarCollapsed ? 'justify-center' : ''}`}
      >
       <span className="shrink-0">{renderIcon('settings', 'h-4 w-4')}</span>
       {isSidebarCollapsed ? null : <span className="truncate">{t('settings_title')}</span>}
      </button>
      {section === 'settings' && !isSidebarCollapsed
       ? settingsTabs.map((tab) => (
          <button
           key={tab.key}
           type="button"
           onClick={() => setSettingsTab(tab.key)}
           aria-pressed={settingsTab === tab.key}
           title={tab.label}
           className={`flex w-full items-center gap-2.5 py-2 pl-9 pr-3 text-sm transition ${
            settingsTab === tab.key ? 'bg-purple-600/70 text-white' : 'text-blue-200 hover:bg-white/10 hover:text-white'
           }`}
          >
           <span className="shrink-0">{renderIcon(tab.icon, 'h-3.5 w-3.5')}</span>
           <span className="truncate">{tab.label}</span>
          </button>
         ))
       : null}
     </nav>
     {/* Footer */}
     <div className="border-t border-white/10 py-1">
      <button
       type="button"
       onClick={() => {
        accountingApi.setActiveWorkspaceId(null);
        void signOut({ callbackUrl: '/login' });
       }}
       aria-label={t('sign_out')}
       title={t('sign_out')}
       className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-sm font-medium text-blue-100 transition hover:bg-white/10 hover:text-white ${
        isSidebarCollapsed ? 'justify-center' : ''
       }`}
      >
       <span className="shrink-0">{renderIcon('auth', 'h-4 w-4')}</span>
       {isSidebarCollapsed ? null : <span>{t('sign_out')}</span>}
      </button>
      {!isSidebarCollapsed && userWorkspaces.length > 1 ? (
       <div className="px-3 pb-1 pt-1">
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-blue-300">{t('workspace_label')}</label>
        <select
         value={activeWorkspaceId ?? ''}
         onChange={(event) => onSwitchWorkspace(event.target.value)}
         className="w-full rounded border border-white/20 bg-white/10 px-2 py-1 text-xs text-blue-100 outline-none transition focus:border-blue-300"
        >
         {userWorkspaces.map((workspace) => (
          <option
           key={workspace.id}
           value={workspace.id}
          >
           {workspace.name}
          </option>
         ))}
        </select>
       </div>
      ) : null}
      {isSidebarCollapsed ? (
       <div className="flex justify-center px-2 pb-2 pt-1">
        <select
         value={language}
         onChange={(event) => setLanguage(event.target.value as 'en' | 'ar' | 'fr')}
         title={t('select_language')}
         className="w-full rounded border border-white/20 bg-white/10 px-1 py-1 text-center text-xs text-blue-100 outline-none transition focus:border-blue-300"
        >
         <option
          value="en"
          className="bg-white text-slate-900"
         >
          EN
         </option>
         <option
          value="ar"
          className="bg-white text-slate-900"
         >
          عر
         </option>
         <option
          value="fr"
          className="bg-white text-slate-900"
         >
          FR
         </option>
        </select>
       </div>
      ) : (
       <div className="px-3 pb-2 pt-1">
        <select
         value={language}
         onChange={(event) => setLanguage(event.target.value as 'en' | 'ar' | 'fr')}
         className="w-full rounded border border-white/20 bg-white/10 px-2 py-1 text-xs text-blue-100 outline-none transition focus:border-blue-300"
        >
         <option
          value="en"
          className="bg-white text-slate-900"
         >
          {t('english')}
         </option>
         <option
          value="ar"
          className="bg-white text-slate-900"
         >
          {t('arabic')}
         </option>
         <option
          value="fr"
          className="bg-white text-slate-900"
         >
          {t('french')}
         </option>
        </select>
       </div>
      )}
     </div>
    </aside>

    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
     {/* Top bar - mobile navigation */}
     <div className="border-b border-[#15304f] bg-[#1e3a5f] px-4 py-2 lg:hidden">
      <div className="flex items-center justify-between gap-2 overflow-x-auto">
       <span className="inline-flex shrink-0 items-center rounded-md bg-white px-1.5 py-1 shadow-sm">
        <Image
         src="/logo/arkam-logo.png"
         alt="Arkam"
         width={720}
         height={876}
         className="h-7 w-auto"
        />
       </span>
       <div className="flex shrink-0 items-center gap-1">
        {sidebarItems.map((item) => {
         const isActive = item.isActive;
         return (
          <button
           key={item.id}
           type="button"
           onClick={item.onClick}
           aria-pressed={isActive}
           title={item.label}
           className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs font-medium transition ${
            isActive ? 'border-blue-400 bg-blue-600 text-white' : 'border-white/20 text-blue-100 hover:bg-white/10 hover:text-white'
           }`}
          >
           {renderIcon(item.icon, 'h-4 w-4')}
           <span className="hidden sm:inline">{item.label}</span>
          </button>
         );
        })}
        <button
         type="button"
         onClick={() => navigateToSection('settings')}
         title={t('settings_title')}
         className="inline-flex items-center gap-1.5 rounded border border-white/20 px-2 py-1 text-xs text-blue-100 transition hover:bg-white/10 hover:text-white"
        >
         {renderIcon('settings', 'h-4 w-4')}
        </button>
        <button
         type="button"
         onClick={() => {
          accountingApi.setActiveWorkspaceId(null);
          void signOut({ callbackUrl: '/login' });
         }}
         title={t('sign_out')}
         className="inline-flex items-center gap-1.5 rounded border border-white/20 px-2 py-1 text-xs text-blue-100 transition hover:bg-white/10 hover:text-white"
        >
         {renderIcon('auth', 'h-4 w-4')}
        </button>
        <select
         value={language}
         onChange={(event) => setLanguage(event.target.value as 'en' | 'ar' | 'fr')}
         className="rounded border border-white/20 bg-white/10 px-1.5 py-1 text-xs text-blue-100 outline-none"
        >
         <option
          value="en"
          className="bg-white text-slate-900"
         >
          EN
         </option>
         <option
          value="ar"
          className="bg-white text-slate-900"
         >
          عر
         </option>
         <option
          value="fr"
          className="bg-white text-slate-900"
         >
          FR
         </option>
        </select>
       </div>
      </div>
     </div>

     {/* Page title bar · hidden when in settings (settings has its own header) */}
     {section !== 'client-ledger' && section !== 'settings' ? (
      <div className="border-b border-gray-200 bg-white px-5 py-3">
       <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
         <h1 className="text-sm font-semibold text-gray-800">{activeSectionMeta.title}</h1>
         <p className="mt-0.5 text-xs text-gray-500">{activeSectionMeta.description}</p>
        </div>
        <div className="flex items-center gap-6">
         {shellMetrics.map((metric) => (
          <div
           key={metric.label}
           className="text-right"
          >
           <p className="text-xs text-gray-500">{metric.label}</p>
           <p className="text-sm font-semibold text-gray-800">{metric.value}</p>
          </div>
         ))}
        </div>
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
       {section === 'organizations' && !isLoading ? organizationsReadOnlySection : null}

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

           <button
            type="button"
            onClick={() => navigateToSection('organizations')}
            className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
           >
            {t('organization_page_back')}
           </button>
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
       {section === 'clients' && !isLoading ? clientsReadOnlySection : null}

       {section === 'client-ledger' && isLoading ? (
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
       ) : null}
       {section === 'client-ledger' && !isLoading ? (
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
                 const pendingCount = ledger.entries.filter((e) => e.pendingRate).length;
                 if (pendingCount === 0) return null;
                 return (
                  <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-amber-600">
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
                  </p>
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

               {/* Row-click mode: highlight rows, or click cells to copy their value. */}
               <div className="mt-3 flex items-center gap-1.5">
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
                             const showCharges = !draft && !entry.isAdjustment && entry.charges > 0 && chargeShowsInLedger(entry.chargesPayer);
                             return (
                              <td
                               key={column.key}
                               style={highlightNet ? { backgroundColor: ledgerNetChangeHighlightColor } : undefined}
                               className={`px-4 py-3 font-semibold ${isPending ? 'text-amber-500' : liveNetChange >= 0 ? 'text-emerald-600' : 'text-red-600'}`}
                              >
                               {isPending ? (
                                <span title={t('ledger_rate_pending')}>-</span>
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
                      // "Paid by me"/"paid to me" charges are settled with the org directly and aren't
                      // editable/visible from a counterparty's ledger; everything else is — including a
                      // charge still being added (charges <= 0) with no payer picked yet. Gate on the
                      // saved payer, not the live draft, so the section doesn't vanish mid-edit while
                      // the user is changing the dropdown.
                      const chargesBelongHere = entry.charges <= 0 || chargeShowsInLedger(entry.chargesPayer);

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
                            <option value="from">{entry.counterpartyName}</option>
                            <option value="to">{ledgerAccountName}</option>
                            <option value="me_to_from">{t('charges_payer_me_to_name', { name: entry.counterpartyName })}</option>
                            <option value="me_to_to">{t('charges_payer_me_to_name', { name: ledgerAccountName })}</option>
                            <option value="from_to_me">{t('charges_payer_name_to_me', { name: entry.counterpartyName })}</option>
                            <option value="to_to_me">{t('charges_payer_name_to_me', { name: ledgerAccountName })}</option>
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

       {(section === 'transactions' || section === 'archive') && isLoading ? (
        <section className="flex flex-col gap-6">
         <SkTablePanel
          panelClassName={panelClassName}
          tableWrapClassName={tableWrapClassName}
          cols={SK_TX}
          titleWidth="w-40"
          rows={10}
         />
        </section>
       ) : null}
       {(section === 'transactions' || section === 'archive') && !isLoading ? (
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
               className="inline-flex shrink-0 items-center gap-1.5 rounded border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
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
              className="inline-flex shrink-0 items-center justify-center rounded border border-slate-300 p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
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
           <p className="mt-1 text-sm text-slate-600">{section === 'archive' ? t('archive_new_transaction_hint') : t('transactions_description')}</p>

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
             className="mt-2 w-full rounded border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
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
             className="mt-2 w-full rounded border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
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
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                }`}
               >
                {t('adjustment_direction_debit')}
               </button>
               <button
                type="button"
                onClick={() => setTransactionForm((current) => ({ ...current, adjustmentDirection: 'credit' }))}
                className={`rounded border px-3 py-2 text-sm font-semibold transition ${
                 transactionForm.adjustmentDirection === 'credit' ? 'border-red-500 bg-red-50 text-red-700' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                }`}
               >
                {t('adjustment_direction_credit')}
               </button>
              </div>
             </div>
            ) : null}

            <label className="block text-sm font-medium">
             {isAdjustmentTransaction ? t('client') : t('transaction_account_from')}
             {isAdjustmentTransaction ? <span className="text-red-500"> *</span> : null}
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
              }}
              onFocus={() => {
               setTxFromQuery('');
               setTxFromOpen(true);
              }}
              onBlur={() => setTimeout(() => setTxFromOpen(false), 150)}
              placeholder={t('transaction_account_placeholder')}
              className={`w-full rounded border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring ${isRTL ? 'pl-9' : 'pr-9'}`}
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
               className={`absolute inset-y-0 my-auto flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 ${isRTL ? 'left-2' : 'right-2'}`}
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
              <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded border border-slate-200 bg-white shadow-lg">
               {(() => {
                const q = txFromQuery.trim().toLowerCase();
                const byClient = new Map<number, ClientAccount[]>();
                for (const a of clientAccounts) {
                 if (q && !`${a.clientName} ${a.currencyCode}`.toLowerCase().includes(q)) continue;
                 const arr = byClient.get(a.clientId) ?? [];
                 arr.push(a);
                 byClient.set(a.clientId, arr);
                }
                const groups = [...byClient.values()];
                if (groups.length === 0) {
                 return <li className="px-3 py-2 text-sm text-slate-400">{t('transaction_account_placeholder')}</li>;
                }
                const selectAccount = (id: number) => {
                 setTransactionForm((current) => ({ ...current, accountFromId: id }));
                 setTxFromQuery('');
                 setTxFromOpen(false);
                 setTxFromExpandedClient(null);
                };
                return groups.map((accts) => {
                 const clientId = accts[0].clientId;
                 // Single-account client: pick it directly.
                 if (accts.length === 1) {
                  const account = accts[0];
                  return (
                   <li
                    key={`g${clientId}`}
                    onMouseDown={() => selectAccount(account.id)}
                    className={`cursor-pointer px-3 py-2 text-sm hover:bg-blue-50 ${transactionForm.accountFromId === account.id ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-800'}`}
                   >
                    {account.clientName} · {account.currencyCode}
                   </li>
                  );
                 }
                 // Multi-account client: show the name; click to expand its accounts.
                 const expanded = !!q || txFromExpandedClient === clientId;
                 const hasSelected = accts.some((a) => a.id === transactionForm.accountFromId);
                 return (
                  <Fragment key={`g${clientId}`}>
                   <li
                    onMouseDown={(e) => {
                     e.preventDefault();
                     setTxFromExpandedClient(expanded && !q ? null : clientId);
                    }}
                    className={`flex cursor-pointer items-center justify-between px-3 py-2 text-sm hover:bg-blue-50 ${hasSelected ? 'font-medium text-blue-700' : 'text-slate-800'}`}
                   >
                    <span>
                     {accts[0].clientName} <span className="text-slate-400">({accts.length})</span>
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
                     className={`text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
                     aria-hidden
                    >
                     <path d="m6 9 6 6 6-6" />
                    </svg>
                   </li>
                   {expanded &&
                    accts.map((account) => (
                     <li
                      key={account.id}
                      onMouseDown={() => selectAccount(account.id)}
                      className={`cursor-pointer py-2 pl-8 pr-3 text-sm hover:bg-blue-50 ${transactionForm.accountFromId === account.id ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-600'}`}
                     >
                      {account.currencyCode}
                      {account.currencySymbol ? ` (${account.currencySymbol})` : ''}
                     </li>
                    ))}
                  </Fragment>
                 );
                });
               })()}
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
                }}
                onFocus={() => {
                 setTxToQuery('');
                 setTxToOpen(true);
                }}
                onBlur={() => setTimeout(() => setTxToOpen(false), 150)}
                placeholder={t('transaction_account_placeholder')}
                className={`w-full rounded border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring ${isRTL ? 'pl-9' : 'pr-9'}`}
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
                 className={`absolute inset-y-0 my-auto flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 ${isRTL ? 'left-2' : 'right-2'}`}
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
                <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded border border-slate-200 bg-white shadow-lg">
                 {(() => {
                  const q = txToQuery.trim().toLowerCase();
                  const byClient = new Map<number, ClientAccount[]>();
                  for (const a of clientAccounts) {
                   if (q && !`${a.clientName} ${a.currencyCode}`.toLowerCase().includes(q)) continue;
                   const arr = byClient.get(a.clientId) ?? [];
                   arr.push(a);
                   byClient.set(a.clientId, arr);
                  }
                  const groups = [...byClient.values()];
                  if (groups.length === 0) {
                   return <li className="px-3 py-2 text-sm text-slate-400">{t('transaction_account_placeholder')}</li>;
                  }
                  const selectAccount = (id: number) => {
                   setTransactionForm((current) => ({ ...current, accountToId: id }));
                   setTxToQuery('');
                   setTxToOpen(false);
                   setTxToExpandedClient(null);
                  };
                  return groups.map((accts) => {
                   const clientId = accts[0].clientId;
                   if (accts.length === 1) {
                    const account = accts[0];
                    return (
                     <li
                      key={`g${clientId}`}
                      onMouseDown={() => selectAccount(account.id)}
                      className={`cursor-pointer px-3 py-2 text-sm hover:bg-blue-50 ${transactionForm.accountToId === account.id ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-800'}`}
                     >
                      {account.clientName} · {account.currencyCode}
                     </li>
                    );
                   }
                   const expanded = !!q || txToExpandedClient === clientId;
                   const hasSelected = accts.some((a) => a.id === transactionForm.accountToId);
                   return (
                    <Fragment key={`g${clientId}`}>
                     <li
                      onMouseDown={(e) => {
                       e.preventDefault();
                       setTxToExpandedClient(expanded && !q ? null : clientId);
                      }}
                      className={`flex cursor-pointer items-center justify-between px-3 py-2 text-sm hover:bg-blue-50 ${hasSelected ? 'font-medium text-blue-700' : 'text-slate-800'}`}
                     >
                      <span>{accts[0].clientName}</span>
                      <span className="flex items-center gap-1 text-xs text-slate-400">
                       {accts.length}
                       <svg
                        width="12"
                        height="12"
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
                        className={`cursor-pointer py-2 pl-8 pr-3 text-sm hover:bg-blue-50 ${transactionForm.accountToId === account.id ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-600'}`}
                       >
                        {account.currencyCode}
                        {account.currencySymbol ? ` (${account.currencySymbol})` : ''}
                       </li>
                      ))}
                    </Fragment>
                   );
                  });
                 })()}
                </ul>
               )}
              </div>
             </>
            ) : null}

            <label className="mt-4 block text-sm font-medium">
             {t('transaction_amount')}
             {isAdjustmentTransaction ? <span className="text-red-500"> *</span> : null}
            </label>
            <div className="mt-2 flex gap-2">
             <input
              type="text"
              inputMode="decimal"
              dir="ltr"
              value={transactionForm.amount}
              onChange={(event) => setTransactionForm((current) => ({ ...current, amount: formatAmountInput(event.target.value) }))}
              className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
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
              className="w-28 rounded border border-slate-300 px-2 py-2 text-sm outline-none ring-blue-300 focus:ring"
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

            <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-4">
             <h3 className="text-sm font-semibold text-slate-700">{t('transaction_account_from')}</h3>
             <div className={`mt-2 grid gap-2 ${showExchangeRateFrom && !isAdjustmentTransaction ? 'sm:grid-cols-2' : ''}`}>
              {showExchangeRateFrom && (
               <div>
                <div className="flex items-center justify-between">
                 <label className="block text-xs font-medium text-slate-500">
                  {transactionSelectedCurrencyCode && transactionAccountFromCurrencyCode
                   ? txFromRateReversed
                     ? `1 ${transactionAccountFromCurrencyCode} = ? ${transactionSelectedCurrencyCode}`
                     : `1 ${transactionSelectedCurrencyCode} = ? ${transactionAccountFromCurrencyCode}`
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
                   className="ml-1 rounded p-0.5 text-slate-400 hover:text-slate-700"
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
                <input
                 type="text"
                 inputMode="decimal"
                 dir="ltr"
                 value={transactionForm.exchangeRateFrom}
                 onChange={(event) => setTransactionForm((current) => ({ ...current, exchangeRateFrom: normalizeDecimalInput(event.target.value) }))}
                 className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                 placeholder="1"
                />
               </div>
              )}
              {!isAdjustmentTransaction ? (
               <div>
                <label className="block text-xs font-medium text-slate-500">{t('transaction_commission_from')} (%)</label>
                <input
                 type="text"
                 inputMode="decimal"
                 dir="ltr"
                 value={transactionForm.commissionFrom}
                 onChange={(event) => setTransactionForm((current) => ({ ...current, commissionFrom: normalizeDecimalInput(event.target.value) }))}
                 className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                 placeholder="0"
                />
               </div>
              ) : null}
             </div>
            </div>

            {!isAdjustmentTransaction ? (
             <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-sm font-semibold text-slate-700">{t('transaction_account_to')}</h3>
              <div className={`mt-2 grid gap-2 ${showExchangeRateTo ? 'sm:grid-cols-2' : ''}`}>
               {showExchangeRateTo && (
                <div>
                 <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-slate-500">
                   {transactionSelectedCurrencyCode && transactionAccountToCurrencyCode
                    ? txToRateReversed
                      ? `1 ${transactionAccountToCurrencyCode} = ? ${transactionSelectedCurrencyCode}`
                      : `1 ${transactionSelectedCurrencyCode} = ? ${transactionAccountToCurrencyCode}`
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
                    className="ml-1 rounded p-0.5 text-slate-400 hover:text-slate-700"
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
                 <input
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  value={transactionForm.exchangeRateTo}
                  onChange={(event) => setTransactionForm((current) => ({ ...current, exchangeRateTo: normalizeDecimalInput(event.target.value) }))}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                  placeholder="1"
                 />
                </div>
               )}
               <div>
                <label className="block text-xs font-medium text-slate-500">{t('transaction_commission_to')} (%)</label>
                <input
                 type="text"
                 inputMode="decimal"
                 dir="ltr"
                 value={transactionForm.commissionTo}
                 onChange={(event) => setTransactionForm((current) => ({ ...current, commissionTo: normalizeDecimalInput(event.target.value) }))}
                 className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                 placeholder="0"
                />
               </div>
              </div>
             </div>
            ) : null}

            {!isAdjustmentTransaction ? (
             <div className="mt-4">
              <button
               type="button"
               onClick={() => setIsNewTransactionExpensesOpen((prev) => !prev)}
               className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline"
              >
               <span>{isNewTransactionExpensesOpen ? '?' : '?'}</span>
               {t('extra_expenses')}
              </button>
              {isNewTransactionExpensesOpen && (
               <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-4">
                <div className="grid gap-2 sm:grid-cols-3">
                 <input
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  value={formatAmountInput(transactionForm.charges)}
                  onChange={(event) => setTransactionForm((current) => ({ ...current, charges: normalizeDecimalInput(event.target.value) }))}
                  className="rounded border border-slate-300 bg-white px-3 py-2 outline-none ring-blue-300 focus:ring"
                  placeholder="0"
                 />
                 <select
                  value={transactionForm.chargesCurrencyId ?? ''}
                  onChange={(event) => setTransactionForm((current) => ({ ...current, chargesCurrencyId: event.target.value ? Number(event.target.value) : null }))}
                  className="rounded border border-slate-300 bg-white px-2 py-2 text-sm outline-none ring-blue-300 focus:ring"
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
                  value={transactionForm.chargesPayer}
                  onChange={(event) => setTransactionForm((current) => ({ ...current, chargesPayer: event.target.value }))}
                  className="rounded border border-slate-300 bg-white px-2 py-2 text-sm outline-none ring-blue-300 focus:ring"
                 >
                  <option value="">{t('charges_payer_placeholder')}</option>
                  <option value="from">
                   {transactionForm.accountFromId
                    ? (clientAccountMap.get(transactionForm.accountFromId)?.clientName ?? t('transaction_account_from'))
                    : t('transaction_account_from')}
                  </option>
                  <option value="to">
                   {transactionForm.accountToId ? (clientAccountMap.get(transactionForm.accountToId)?.clientName ?? t('transaction_account_to')) : t('transaction_account_to')}
                  </option>
                  <option value="me_to_from">
                   {t('charges_payer_me_to_name', {
                    name: transactionForm.accountFromId
                     ? (clientAccountMap.get(transactionForm.accountFromId)?.clientName ?? t('transaction_account_from'))
                     : t('transaction_account_from'),
                   })}
                  </option>
                  <option value="me_to_to">
                   {t('charges_payer_me_to_name', {
                    name: transactionForm.accountToId
                     ? (clientAccountMap.get(transactionForm.accountToId)?.clientName ?? t('transaction_account_to'))
                     : t('transaction_account_to'),
                   })}
                  </option>
                  <option value="from_to_me">
                   {t('charges_payer_name_to_me', {
                    name: transactionForm.accountFromId
                     ? (clientAccountMap.get(transactionForm.accountFromId)?.clientName ?? t('transaction_account_from'))
                     : t('transaction_account_from'),
                   })}
                  </option>
                  <option value="to_to_me">
                   {t('charges_payer_name_to_me', {
                    name: transactionForm.accountToId
                     ? (clientAccountMap.get(transactionForm.accountToId)?.clientName ?? t('transaction_account_to'))
                     : t('transaction_account_to'),
                   })}
                  </option>
                 </select>
                </div>
                {showChargesExchangeRate && (
                 <div className="mt-2">
                  <label className="block text-xs font-medium text-slate-500">
                   {t('charges_exchange_rate')} ({chargesCurrencyCode} → {chargesPayerAccountCurrencyCode})
                  </label>
                  <input
                   type="text"
                   inputMode="decimal"
                   dir="ltr"
                   value={transactionForm.chargesExchangeRate}
                   onChange={(event) => setTransactionForm((current) => ({ ...current, chargesExchangeRate: normalizeDecimalInput(event.target.value) }))}
                   className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 outline-none ring-blue-300 focus:ring"
                   placeholder="1"
                  />
                 </div>
                )}
                <div className="mt-2">
                 <label className="block text-xs font-medium text-slate-500">{t('charges_description')}</label>
                 <input
                  type="text"
                  value={transactionForm.chargesDescription}
                  onChange={(event) => setTransactionForm((current) => ({ ...current, chargesDescription: event.target.value }))}
                  className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
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
              className="min-h-20 w-full rounded border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
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
                 if (seen.has(key)) continue;
                 seen.add(key);
                 suggestions.push(desc);
                 if (suggestions.length >= 8) break;
                }
                if (suggestions.length >= 8) break;
               }
               if (suggestions.length === 0) return null;
               return (
                <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded border border-slate-200 bg-white shadow-lg">
                 {suggestions.map((desc) => (
                  <li
                   key={desc}
                   onMouseDown={() => {
                    setTransactionForm((current) => ({ ...current, description: desc }));
                    setDescriptionSuggestOpen(false);
                   }}
                   className="cursor-pointer truncate px-3 py-2 text-sm text-slate-700 hover:bg-blue-50"
                   title={desc}
                  >
                   {desc}
                  </li>
                 ))}
                </ul>
               );
              })()}
            </div>

            {!isAdjustmentTransaction ? (
             <div className="mt-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
               <input
                type="checkbox"
                checked={txSplitDescription}
                onChange={(event) => setTxSplitDescription(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-300"
               />
               {t('transaction_description_split')}
              </label>

              {txSplitDescription ? (
               <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                 <label className="block text-xs font-medium text-slate-500">
                  {clientAccountMap.get(transactionForm.accountFromId ?? -1)?.clientName ?? t('transaction_account_from')}
                 </label>
                 <textarea
                  value={transactionForm.descriptionFrom}
                  onChange={(event) => setTransactionForm((current) => ({ ...current, descriptionFrom: event.target.value }))}
                  className="mt-1 min-h-16 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                  placeholder={transactionForm.description || t('transaction_description_placeholder')}
                 />
                </div>
                <div>
                 <label className="block text-xs font-medium text-slate-500">
                  {clientAccountMap.get(transactionForm.accountToId ?? -1)?.clientName ?? t('transaction_account_to')}
                 </label>
                 <textarea
                  value={transactionForm.descriptionTo}
                  onChange={(event) => setTransactionForm((current) => ({ ...current, descriptionTo: event.target.value }))}
                  className="mt-1 min-h-16 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
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
            {section === 'archive' ? <p className="mt-1 text-sm text-slate-600">{t('archive_description')}</p> : null}
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
              onClick={() => void onExportArchivePdf()}
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
             className="cursor-pointer rounded border border-slate-300 p-2 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
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
             className="cursor-pointer rounded border border-slate-300 p-2 text-slate-600 transition hover:bg-slate-50"
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
             title={t('ledger_row_click_toggle')}
             onClick={toggleTxRowClickHighlight}
             aria-pressed={txRowClickHighlight}
             className={`cursor-pointer rounded border px-2 py-2 text-sm font-semibold transition ${
              txRowClickHighlight ? 'border-amber-400 bg-amber-50 text-amber-600 hover:bg-amber-100' : 'border-slate-300 text-slate-700 hover:bg-slate-50'
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
             onClick={openTransactionTableSettingsModal}
             title={t('transactions_more_settings')}
             className="cursor-pointer rounded border border-slate-300 p-2 text-slate-600 transition hover:bg-slate-50"
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
            {selectedTransactionIds.size === 1 ? (
             <button
              type="button"
              onClick={(e) => onCopySelectedTransaction(e)}
              title={t('copy_transaction')}
              aria-label={t('copy_transaction')}
              className="cursor-pointer rounded border border-slate-300 bg-white p-2 text-slate-600 transition hover:bg-slate-50"
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
                width="11"
                height="11"
                rx="2"
               />
               <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
             </button>
            ) : null}
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
              className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700"
             >
              <span className="font-semibold text-slate-900">{sum.total.toLocaleString(numLocale)}</span>
              <span className="text-slate-500">{sum.symbol || sum.code}</span>
             </span>
            ))}
            {Object.keys(transactionTableDrafts).length > 0 ? (
             <>
              <button
               type="button"
               title={t('undo')}
               onClick={txTableHistory.undo}
               disabled={!txTableHistory.canUndo}
               className="cursor-pointer rounded border border-slate-300 bg-white p-2 text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
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
               className="cursor-pointer rounded border border-slate-300 bg-white p-2 text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
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
          <div className="mt-3 rounded border border-slate-200 bg-slate-50">
           <button
            type="button"
            onClick={() => setTxFilterOpen((o) => !o)}
            aria-expanded={txFilterOpen}
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
            {(txFilterSearch || txFilterClient || txFilterDateFrom || txFilterDateTo) && (
             <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-xs font-semibold text-white leading-none">
              {[txFilterSearch, txFilterClient, txFilterDateFrom, txFilterDateTo].filter(Boolean).length}
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
            <div className="flex flex-wrap items-end gap-2 border-t border-slate-200 px-3 py-3">
             <div className="flex min-w-36 flex-1 flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">{t('tx_filter_search')}</label>
              <div className="relative">
               <input
                type="text"
                value={txFilterSearch}
                onChange={(e) => setTxFilterSearch(e.target.value)}
                placeholder={t('tx_filter_search_placeholder')}
                className={`w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none ring-blue-300 focus:ring ${isRTL ? 'pl-7' : 'pr-7'}`}
               />
               {txFilterSearch ? (
                <button
                 type="button"
                 onClick={() => setTxFilterSearch('')}
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
             <div className="flex min-w-36 flex-1 flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">{t('tx_filter_client')}</label>
              <select
               value={txFilterClient}
               onChange={(e) => setTxFilterClient(e.target.value)}
               className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none ring-blue-300 focus:ring"
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
              <label className="text-xs font-medium text-slate-500">{t('tx_filter_date_from')}</label>
              <input
               type="date"
               value={txFilterDateFrom}
               onChange={(e) => setTxFilterDateFrom(e.target.value)}
               className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none ring-blue-300 focus:ring"
              />
             </div>
             <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">{t('tx_filter_date_to')}</label>
              <input
               type="date"
               value={txFilterDateTo}
               onChange={(e) => setTxFilterDateTo(e.target.value)}
               className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none ring-blue-300 focus:ring"
              />
             </div>
             {(txFilterSearch || txFilterClient || txFilterDateFrom || txFilterDateTo) && (
              <button
               type="button"
               onClick={() => {
                setTxFilterSearch('');
                setTxFilterClient('');
                setTxFilterDateFrom('');
                setTxFilterDateTo('');
               }}
               className="self-end rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100"
              >
               {t('tx_filter_clear')}
              </button>
             )}
            </div>
           )}
          </div>
          {transactionsPager}
          <div className={`${tableWrapClassName} max-h-[70vh] overflow-y-auto`}>
           <table className="w-full text-sm">
            <colgroup>
             <col className="w-8" />
             <col className="w-10" />
             {transactionTableSettings.columns.created ? <col className="w-[10%]" /> : null}
             {transactionTableSettings.columns.description ? <col className="w-[15%]" /> : null}
             {transactionTableSettings.columns.accountFrom ? <col className="w-[17%]" /> : null}
             {transactionTableSettings.columns.accountTo ? <col className="w-[17%]" /> : null}
             {transactionTableSettings.columns.amount ? <col className="w-[13%]" /> : null}
             {transactionTableSettings.columns.charges ? <col className="w-[13%]" /> : null}
             {transactionTableSettings.columns.commission ? <col className="w-[15%]" /> : null}
             {section === 'archive' ? <col className="w-[16%]" /> : null}
            </colgroup>
            <thead className="sticky top-0 z-20 bg-slate-100 text-slate-700">
             <tr>
              <th className="px-2 py-3 w-8">
               <input
                type="checkbox"
                checked={paginatedTransactions.length > 0 && paginatedTransactions.every((t) => selectedTransactionIds.has(t.id))}
                onChange={onToggleSelectAllTransactions}
                aria-label="Select all"
                className="h-4 w-4 cursor-pointer rounded border-slate-300"
               />
              </th>
              <th className="px-2 py-3 w-10">
               {isEditAllTransactions ? (
                <div className="flex flex-col items-center gap-1">
                 <button
                  type="button"
                  title={t('save_changes')}
                  onClick={() => void onSaveAllTransactions()}
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
                  onClick={() => onCancelAllTransactions()}
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
                 onClick={() => onEditAllTransactions()}
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
              {transactionTableSettings.columns.created ? (
               <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>
                <button
                 type="button"
                 onClick={() => setTxSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
                 className="inline-flex items-center gap-1 hover:text-blue-600 transition-colors"
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
               draggable={!editingRowIds.has(txn.id)}
               onDragStart={(e) => {
                if (!dragFromHandle.current) {
                 e.preventDefault();
                 return;
                }
                setDragRowId(txn.id);
               }}
               onDragEnd={() => {
                dragFromHandle.current = false;
                if (dragRowId !== null && dragOverRowId !== null && dragRowId !== dragOverRowId) {
                 // If the dragged row is part of the selection, drag the whole selection; otherwise just this row
                 const idsToMove = selectedTransactionIds.has(dragRowId) && selectedTransactionIds.size > 1 ? [...selectedTransactionIds] : [dragRowId];
                 void onTransactionRowDrop(idsToMove, dragOverRowId, dragOverHalf);
                }
                setDragRowId(null);
                setDragOverRowId(null);
               }}
               onDragOver={(e) => {
                e.preventDefault();
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setDragOverHalf(e.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom');
                setDragOverRowId(txn.id);
               }}
               onDragLeave={() => setDragOverRowId((prev) => (prev === txn.id ? null : prev))}
               onKeyDown={(e) => {
                // Enter saves the row being edited (ignore Enter inside multi-line fields).
                if (e.key !== 'Enter') return;
                if (!editingRowIds.has(txn.id)) return;
                if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
                e.preventDefault();
                void onSaveTransactionTableRow(txn.id);
               }}
               className={`border-t border-slate-200 align-top transition-colors hover:bg-slate-100 ${txn.isArchived || (!txn.isAdjustment && (!txn.accountFromId || !txn.accountToId)) ? 'bg-amber-50' : index % 2 === 1 ? 'bg-slate-50' : 'bg-white'} ${
                dragRowId !== null && selectedTransactionIds.has(dragRowId) && selectedTransactionIds.has(txn.id) ? 'opacity-40' : dragRowId === txn.id ? 'opacity-40' : ''
               } ${dragOverRowId === txn.id && dragOverHalf === 'top' ? 'border-t-2 border-t-blue-500' : ''} ${
                dragOverRowId === txn.id && dragOverHalf === 'bottom' ? 'border-b-2 border-b-blue-500' : ''
               }`}
               style={(() => {
                const color = highlightedTxRows.get(txn.id);
                const isEditingRow = editingRowIds.has(txn.id);
                return {
                 ...(color ? { backgroundColor: color } : {}),
                 ...(isEditingRow ? {} : txRowClickHighlight ? { cursor: HIGHLIGHT_PEN_CURSOR } : { cursor: 'copy' }),
                };
               })()}
               onClick={(e) => {
                const isEditingRow = editingRowIds.has(txn.id);
                if (isEditingRow) return;
                if ((e.target as HTMLElement).closest('button, a, input, select, textarea, label')) return;
                if (txRowClickHighlight) {
                 toggleTxRowHighlight(txn.id);
                 return;
                }
                const td = (e.target as HTMLElement).closest('td');
                if (!td || (td as HTMLTableCellElement).cellIndex < 2) return;
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
                  <td className="px-2 py-3 align-middle w-8">
                   <input
                    type="checkbox"
                    checked={selectedTransactionIds.has(txn.id)}
                    onChange={() => onToggleTransactionSelection(txn.id)}
                    aria-label={`Select transaction ${txn.id}`}
                    className="h-4 w-4 cursor-pointer rounded border-slate-300"
                   />
                  </td>
                  <td className="px-2 py-3 align-top">
                   {isEditingRow ? (
                    <div className="flex flex-col items-center gap-1">
                     <span
                      className="cursor-grab text-slate-300 hover:text-slate-500 active:cursor-grabbing"
                      title="Drag to reorder"
                      onMouseDown={() => {
                       dragFromHandle.current = true;
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
                      title={t('save_changes')}
                      onClick={() => void onSaveTransactionTableRow(txn.id)}
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
                      onClick={() =>
                       setEditingRowIds((prev) => {
                        const next = new Set(prev);
                        next.delete(txn.id);
                        return next;
                       })
                      }
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
                      onClick={() => void onDeleteTransactionTableRow(txn)}
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
                        <path d="M7 4 3 8l4 4M3 8h13.5" />
                        <path d="M17 20l4-4-4-4m4 4H7.5" />
                       </svg>
                      </button>
                     )}
                    </div>
                   ) : (
                    <div className="flex items-center gap-0.5">
                     <span
                      className="cursor-grab text-slate-300 hover:text-slate-500 active:cursor-grabbing"
                      title="Drag to reorder"
                      onMouseDown={() => {
                       dragFromHandle.current = true;
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
                      onClick={() => setEditingRowIds((prev) => new Set([...prev, txn.id]))}
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
                  {transactionTableSettings.columns.created ? (
                   <td className="px-4 py-3 text-slate-500">
                    {isEditingRow && draft ? (
                     <input
                      type="date"
                      value={draft.createdDate}
                      onChange={(event) => updateTransactionTableDraft(txn.id, { createdDate: event.target.value })}
                      className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                     />
                    ) : (
                     <span className="inline-flex items-center gap-1.5">
                      {txn.isArchived ? (
                       <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
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
                        {t('transaction_archived_badge')}
                       </span>
                      ) : null}
                      {formatDateValue(txn.createdAt, transactionTableSettings.dateFormat)}
                     </span>
                    )}
                   </td>
                  ) : null}
                  {transactionTableSettings.columns.description ? (
                   <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                    {isEditingRow && draft ? (
                     <input
                      type="text"
                      value={draft.description}
                      onChange={(event) => updateTransactionTableDraft(txn.id, { description: event.target.value })}
                      className="field-sizing-content min-w-28 rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                      placeholder={t('transaction_description_placeholder')}
                     />
                    ) : (
                     txn.description || <span className="text-slate-400">-</span>
                    )}
                   </td>
                  ) : null}
                  {transactionTableSettings.columns.accountFrom ? (
                   <td className={`px-4 py-3 font-medium text-slate-900 whitespace-nowrap${isEditingRow ? ' min-w-52' : ''}`}>
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
                        <span className="text-xs text-slate-400">
                         {tableRateFromReversed[txn.id] ? `1 ${txn.accountFromCurrencyCode} = ? ${txn.currencyCode}` : `1 ${txn.currencyCode} = ? ${txn.accountFromCurrencyCode}`}
                        </span>
                        <button
                         type="button"
                         title="Reverse rate direction"
                         onClick={() => {
                          const val = parseFloat(draft.exchangeRateFrom) || 1;
                          updateTransactionTableDraft(txn.id, { exchangeRateFrom: (1 / val).toFixed(6).replace(/\.?0+$/, '') });
                          setTableRateFromReversed((prev) => ({ ...prev, [txn.id]: !prev[txn.id] }));
                         }}
                         className="ml-1 rounded p-0.5 text-slate-400 hover:text-slate-700"
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
                      )}
                      {transactionTableSettings.showExchangeRate ? (
                       <input
                        type="text"
                        inputMode="decimal"
                        dir="ltr"
                        value={draft.exchangeRateFrom}
                        onChange={(event) => updateTransactionTableDraft(txn.id, { exchangeRateFrom: normalizeDecimalInput(event.target.value) })}
                        className="field-sizing-content min-w-16 rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
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
                         className="cursor-pointer text-left hover:text-blue-700 hover:underline"
                        >
                         {txn.clientFromName} <span className="text-xs font-normal text-slate-500">{txn.accountFromCurrencySymbol || txn.accountFromCurrencyCode}</span>
                        </a>
                       ) : (
                        <div>
                         {txn.clientFromName} <span className="text-xs font-normal text-slate-500">{txn.accountFromCurrencySymbol || txn.accountFromCurrencyCode}</span>
                        </div>
                       );
                      })()}
                      {transactionTableSettings.showExchangeRate && txn.exchangeRateFrom !== 1 && txn.currencyCode !== txn.accountFromCurrencyCode ? (
                       <div className="text-xs text-slate-500">
                        {t('transaction_exchange_rate')}:{' '}
                        {txn.exchangeRateFromReversed
                         ? `1 ${txn.accountFromCurrencyCode} = ${formatRateValue(1 / txn.exchangeRateFrom)} ${txn.currencyCode}`
                         : `1 ${txn.currencyCode} = ${formatRateValue(txn.exchangeRateFrom)} ${txn.accountFromCurrencyCode}`}
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
                         className="cursor-pointer text-left hover:text-blue-700 hover:underline"
                        >
                         {txn.clientFromName} <span className="text-xs font-normal text-slate-500">{txn.accountFromCurrencySymbol || txn.accountFromCurrencyCode}</span>
                        </a>
                       ) : txn.accountFromId ? (
                        <div>
                         {txn.clientFromName} <span className="text-xs font-normal text-slate-500">{txn.accountFromCurrencySymbol || txn.accountFromCurrencyCode}</span>
                        </div>
                       ) : (
                        <span className="italic text-slate-400">{t('archive_no_sender')}</span>
                       );
                      })()}
                      {transactionTableSettings.showExchangeRate && txn.exchangeRateFrom !== 1 ? (
                       <div className="text-xs text-slate-500">
                        {t('transaction_exchange_rate')}:{' '}
                        {txn.exchangeRateFromReversed
                         ? `1 ${txn.accountFromCurrencyCode} = ${formatRateValue(1 / txn.exchangeRateFrom)} ${txn.currencyCode}`
                         : `1 ${txn.currencyCode} = ${formatRateValue(txn.exchangeRateFrom)} ${txn.accountFromCurrencyCode}`}
                       </div>
                      ) : null}
                     </>
                    )}
                   </td>
                  ) : null}
                  {transactionTableSettings.columns.accountTo ? (
                   <td className={`px-4 py-3 font-medium text-slate-900 whitespace-nowrap${isEditingRow ? ' min-w-52' : ''}`}>
                    {isEditingRow && draft && txn.isAdjustment ? (
                     <div className="grid grid-cols-2 gap-2">
                      <button
                       type="button"
                       onClick={() => updateTransactionTableDraft(txn.id, { adjustmentDirection: 'debit' })}
                       className={`rounded border px-3 py-2 text-sm font-semibold transition ${
                        draft.adjustmentDirection === 'debit' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                       }`}
                      >
                       {t('adjustment_direction_debit_short')}
                      </button>
                      <button
                       type="button"
                       onClick={() => updateTransactionTableDraft(txn.id, { adjustmentDirection: 'credit' })}
                       className={`rounded border px-3 py-2 text-sm font-semibold transition ${
                        draft.adjustmentDirection === 'credit' ? 'border-red-500 bg-red-50 text-red-700' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
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
                        <span className="text-xs text-slate-400">
                         {tableRateToReversed[txn.id] ? `1 ${txn.accountToCurrencyCode} = ? ${txn.currencyCode}` : `1 ${txn.currencyCode} = ? ${txn.accountToCurrencyCode}`}
                        </span>
                        <button
                         type="button"
                         title="Reverse rate direction"
                         onClick={() => {
                          const val = parseFloat(draft.exchangeRateTo) || 1;
                          updateTransactionTableDraft(txn.id, { exchangeRateTo: (1 / val).toFixed(6).replace(/\.?0+$/, '') });
                          setTableRateToReversed((prev) => ({ ...prev, [txn.id]: !prev[txn.id] }));
                         }}
                         className="ml-1 rounded p-0.5 text-slate-400 hover:text-slate-700"
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
                      )}
                      {transactionTableSettings.showExchangeRate ? (
                       <input
                        type="text"
                        inputMode="decimal"
                        dir="ltr"
                        value={draft.exchangeRateTo}
                        onChange={(event) => updateTransactionTableDraft(txn.id, { exchangeRateTo: normalizeDecimalInput(event.target.value) })}
                        className="field-sizing-content min-w-16 rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
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
                         className="cursor-pointer text-left hover:text-blue-700 hover:underline"
                        >
                         {txn.clientToName} <span className="text-xs font-normal text-slate-500">{txn.accountToCurrencySymbol || txn.accountToCurrencyCode}</span>
                        </a>
                       ) : txn.accountToId ? (
                        <div>
                         {txn.clientToName} <span className="text-xs font-normal text-slate-500">{txn.accountToCurrencySymbol || txn.accountToCurrencyCode}</span>
                        </div>
                       ) : (
                        <span className="italic text-slate-400">{t('archive_no_receiver')}</span>
                       );
                      })()}
                      {transactionTableSettings.showExchangeRate && txn.exchangeRateTo !== 1 ? (
                       <div className="text-xs text-slate-500">
                        {t('transaction_exchange_rate')}:{' '}
                        {txn.exchangeRateToReversed
                         ? `1 ${txn.accountToCurrencyCode} = ${formatRateValue(1 / txn.exchangeRateTo)} ${txn.currencyCode}`
                         : `1 ${txn.currencyCode} = ${formatRateValue(txn.exchangeRateTo)} ${txn.accountToCurrencyCode}`}
                       </div>
                      ) : null}
                     </>
                    )}
                   </td>
                  ) : null}
                  {transactionTableSettings.columns.amount ? (
                   <td className="px-4 py-3 text-slate-700">
                    {isEditingRow && draft ? (
                     <div className="flex gap-2">
                      <input
                       type="text"
                       inputMode="decimal"
                       dir="ltr"
                       value={formatAmountInput(draft.amount)}
                       onChange={(event) => updateTransactionTableDraft(txn.id, { amount: normalizeDecimalInput(event.target.value) })}
                       className="field-sizing-content min-w-16 rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                      />
                      <select
                       value={draft.currencyId ?? ''}
                       onChange={(event) => updateTransactionTableDraft(txn.id, { currencyId: event.target.value ? Number(event.target.value) : null })}
                       className="w-20 rounded border border-slate-300 px-2 py-2 text-sm outline-none ring-blue-300 focus:ring"
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
                    ) : (
                     <span className="whitespace-nowrap">
                      <span className="font-semibold">{txn.amount.toLocaleString(numLocale)}</span> <span className="text-slate-500">{txn.currencySymbol || txn.currencyCode}</span>
                     </span>
                    )}
                   </td>
                  ) : null}
                  {transactionTableSettings.columns.charges ? (
                   <td className="px-4 py-3 text-slate-700">
                    {txn.isAdjustment ? (
                     <span className="text-slate-400">-</span>
                    ) : isEditingRow && draft ? (
                     (() => {
                      const isZero = parseFloat(draft.charges) === 0;
                      const expanded = expensesExpandedTxns.has(txn.id);
                      if (isZero && !expanded) {
                       return (
                        <button
                         type="button"
                         onClick={() => setExpensesExpandedTxns((prev) => new Set([...prev, txn.id]))}
                         className="text-sm text-blue-600 hover:underline"
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
                         className="field-sizing-content min-w-16 rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                         placeholder="0"
                        />
                        <select
                         value={draft.chargesCurrencyId ?? ''}
                         onChange={(event) => updateTransactionTableDraft(txn.id, { chargesCurrencyId: event.target.value ? Number(event.target.value) : null })}
                         className="w-full rounded border border-slate-300 px-2 py-1 text-sm outline-none ring-blue-300 focus:ring"
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
                         value={draft.chargesPayer}
                         onChange={(event) => updateTransactionTableDraft(txn.id, { chargesPayer: event.target.value })}
                         className="w-full rounded border border-slate-300 px-2 py-1 text-sm outline-none ring-blue-300 focus:ring"
                        >
                         <option value="">{t('charges_payer_placeholder')}</option>
                         <option value="from">{txn.clientFromName}</option>
                         <option value="to">{txn.clientToName}</option>
                         <option value="me_to_from">{t('charges_payer_me_to_name', { name: txn.clientFromName })}</option>
                         <option value="me_to_to">{t('charges_payer_me_to_name', { name: txn.clientToName })}</option>
                         <option value="from_to_me">{t('charges_payer_name_to_me', { name: txn.clientFromName })}</option>
                         <option value="to_to_me">{t('charges_payer_name_to_me', { name: txn.clientToName })}</option>
                        </select>
                        {(() => {
                         const draftChargesCurrencyCode = draft.chargesCurrencyId ? currencyMap.get(draft.chargesCurrencyId)?.code : undefined;
                         const draftPayerAccountCurrencyCode =
                          draft.chargesPayer === 'from' ? txn.accountFromCurrencyCode : draft.chargesPayer === 'to' ? txn.accountToCurrencyCode : undefined;
                         if (!draftChargesCurrencyCode || !draftPayerAccountCurrencyCode || draftChargesCurrencyCode === draftPayerAccountCurrencyCode) return null;
                         return (
                          <div>
                           <span className="text-xs text-slate-500">
                            {draftChargesCurrencyCode} → {draftPayerAccountCurrencyCode}
                           </span>
                           <input
                            type="text"
                            inputMode="decimal"
                            dir="ltr"
                            value={draft.chargesExchangeRate}
                            onChange={(event) => updateTransactionTableDraft(txn.id, { chargesExchangeRate: normalizeDecimalInput(event.target.value) })}
                            className="mt-1 field-sizing-content min-w-16 rounded border border-slate-300 px-2 py-1 text-sm outline-none ring-blue-300 focus:ring"
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
                          className="field-sizing-content min-w-28 rounded border border-slate-300 px-2 py-1 text-sm outline-none ring-blue-300 focus:ring"
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
                       {txn.chargesCurrencyCode && <span className="text-slate-500"> {txn.chargesCurrencyCode}</span>}
                      </span>
                      {txn.chargesExchangeRate !== 1 && txn.chargesCurrencyCode && <div className="text-xs text-slate-400">@ {txn.chargesExchangeRate.toFixed(4)}</div>}
                      {txn.chargesPayer && (
                       <div className="text-xs text-slate-500">
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
                      {txn.chargesDescription && <div className="text-xs italic text-slate-400">{txn.chargesDescription}</div>}
                     </div>
                    ) : (
                     <span className="text-slate-400">-</span>
                    )}
                   </td>
                  ) : null}
                  {transactionTableSettings.columns.commission ? (
                   <td className="px-4 py-3 text-slate-600">
                    {txn.isAdjustment ? (
                     <span className="text-slate-400">—</span>
                    ) : isEditingRow && draft ? (
                     (() => {
                      const bothZero = parseFloat(draft.commissionFrom) === 0 && parseFloat(draft.commissionTo) === 0;
                      const expanded = commissionExpandedTxns.has(txn.id);
                      if (bothZero && !expanded) {
                       return (
                        <button
                         type="button"
                         onClick={() => setCommissionExpandedTxns((prev) => new Set([...prev, txn.id]))}
                         className="text-sm text-blue-600 hover:underline"
                        >
                         + {t('add_commission')}
                        </button>
                       );
                      }
                      return (
                       <div className="space-y-2">
                        <div className="flex items-center gap-2">
                         <span className="shrink-0 text-xs text-slate-500">{txn.clientFromName}:</span>
                         <input
                          type="text"
                          inputMode="decimal"
                          dir="ltr"
                          value={draft.commissionFrom}
                          onChange={(event) => updateTransactionTableDraft(txn.id, { commissionFrom: normalizeDecimalInput(event.target.value) })}
                          className="field-sizing-content min-w-12 rounded border border-slate-300 px-2 py-1 text-sm outline-none ring-blue-300 focus:ring"
                          placeholder="0"
                         />
                         <span className="text-xs text-slate-400">%</span>
                        </div>
                        <div className="flex items-center gap-2">
                         <span className="shrink-0 text-xs text-slate-500">{txn.clientToName}:</span>
                         <input
                          type="text"
                          inputMode="decimal"
                          dir="ltr"
                          value={draft.commissionTo}
                          onChange={(event) => updateTransactionTableDraft(txn.id, { commissionTo: normalizeDecimalInput(event.target.value) })}
                          className="field-sizing-content min-w-12 rounded border border-slate-300 px-2 py-1 text-sm outline-none ring-blue-300 focus:ring"
                          placeholder="0"
                         />
                         <span className="text-xs text-slate-400">%</span>
                        </div>
                       </div>
                      );
                     })()
                    ) : (
                     (() => {
                      const parts: string[] = [];
                      if (txn.commissionFrom) parts.push(`${txn.clientFromName}: ${txn.commissionFrom.toFixed(2)}%`);
                      if (txn.commissionTo) parts.push(`${txn.clientToName}: ${txn.commissionTo.toFixed(2)}%`);
                      return parts.length > 0 ? (
                       <div className="space-y-0.5 text-xs">
                        {parts.map((p, i) => (
                         <div key={i}>{p}</div>
                        ))}
                       </div>
                      ) : (
                       <span className="text-slate-400">-</span>
                      );
                     })()
                    )}
                   </td>
                  ) : null}
                  {section === 'archive' ? (
                   <td className="px-4 py-3 text-slate-600">
                    {txn.isArchived ? (
                     <span
                      title={t('archive_only_badge_hint')}
                      className="mb-1.5 inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
                     >
                      <svg
                       width="10"
                       height="10"
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
                      {t('archive_only_badge')}
                     </span>
                    ) : null}
                    {isEditingRow && draft ? (
                     <input
                      type="text"
                      value={draft.archiveNote}
                      onChange={(event) => updateTransactionTableDraft(txn.id, { archiveNote: event.target.value })}
                      placeholder={t('archive_more_info_placeholder')}
                      className="w-full rounded border border-slate-300 px-2 py-1 text-sm outline-none ring-blue-300 focus:ring"
                     />
                    ) : txn.archiveNote ? (
                     txn.archiveNote
                    ) : (
                     <span className="text-slate-400">-</span>
                    )}
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
                className="px-4 py-6 text-slate-500"
                colSpan={visibleTransactionColumnCount + (section === 'archive' ? 1 : 0)}
               >
                {section === 'archive' ? t('archive_empty') : t('no_transactions')}
               </td>
              </tr>
             ) : null}
            </tbody>
            {section === 'archive' && archiveCurrencyTotals.length > 0 ? (
             <tfoot>
              <tr className="border-t-2 border-slate-300 bg-slate-50">
               <td
                colSpan={visibleTransactionColumnCount + 1}
                className="px-4 py-3"
               >
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                 <span className="text-sm font-semibold uppercase tracking-wide text-slate-500">{t('archive_totals')}</span>
                 {archiveCurrencyTotals.map((total) => (
                  <span
                   key={total.code}
                   className="text-sm font-semibold text-slate-900"
                  >
                   {total.total.toLocaleString(numLocale)} <span className="font-normal text-slate-500">{total.symbol || total.code}</span>
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
       ) : null}
      </div>
     ) : null}
    </div>
   </main>

   {showTransactionExportModal ? (
    <div
     className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
     onClick={closeTransactionExportModal}
    >
     <div
      className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
      onClick={(event) => event.stopPropagation()}
     >
      <h2 className="text-lg font-semibold text-slate-900">{t('transactions_export_title')}</h2>
      <p className="mt-1 text-sm text-slate-500">{t('transactions_export_hint')}</p>

      <div className="mt-5 grid grid-cols-2 gap-4">
       <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{t('transactions_export_from')}</label>
        <input
         type="date"
         value={transactionExportFrom}
         max={transactionExportTo || undefined}
         onChange={(event) => setTransactionExportFrom(event.target.value)}
         className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
        />
       </div>
       <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{t('transactions_export_to')}</label>
        <input
         type="date"
         value={transactionExportTo}
         min={transactionExportFrom || undefined}
         onChange={(event) => setTransactionExportTo(event.target.value)}
         className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
        />
       </div>
      </div>

      <p className="mt-3 text-xs text-slate-500">
       {t('transactions_export_count').replace('{count}', String(buildTransactionExportData(transactionExportFrom, transactionExportTo).count))}
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3">
       <button
        type="button"
        onClick={() => void onExportTransactionsPdf()}
        disabled={isExportingTransactions}
        className="flex items-center justify-center gap-2 rounded border border-red-600 bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
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
         <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
         <polyline points="14 2 14 8 20 8" />
        </svg>
        {t('transactions_export_pdf')}
       </button>
       <button
        type="button"
        onClick={() => void onExportTransactionsExcel()}
        disabled={isExportingTransactions}
        className="flex items-center justify-center gap-2 rounded border border-emerald-600 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
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
         <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
         <polyline points="14 2 14 8 20 8" />
         <path d="M9 13l6 5M15 13l-6 5" />
        </svg>
        {t('transactions_export_excel')}
       </button>
      </div>

      <div className="mt-4 flex justify-end">
       <button
        type="button"
        onClick={closeTransactionExportModal}
        disabled={isExportingTransactions}
        className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
       >
        {t('cancel')}
       </button>
      </div>
     </div>
    </div>
   ) : null}

   {showTransactionTableSettingsModal ? (
    <div
     className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
     onClick={closeTransactionTableSettingsModal}
    >
     <div
      className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
      onClick={(event) => event.stopPropagation()}
     >
      <h2 className="text-lg font-semibold text-slate-900">{t('transactions_table_settings_title')}</h2>
      <div className="mt-5 space-y-5">
       <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('client_ledger_columns')}</p>
        <div className="mt-2 flex flex-wrap gap-2">
         {(
          [
           { key: 'created', label: t('date') },
           { key: 'description', label: t('transaction_description') },
           { key: 'accountFrom', label: t('transaction_account_from') },
           { key: 'accountTo', label: t('transaction_account_to') },
           { key: 'amount', label: t('transaction_amount') },
           { key: 'charges', label: t('charges') },
           { key: 'commission', label: t('commission') },
          ] as Array<{ key: TransactionColumnKey; label: string }>
         ).map((column) => {
          const isVisible = transactionTableSettingsDraft.columns[column.key];
          return (
           <button
            key={column.key}
            type="button"
            onClick={() =>
             setTransactionTableSettingsDraft((current) => ({
              ...current,
              columns: { ...current.columns, [column.key]: !current.columns[column.key] },
             }))
            }
            className={`rounded border px-3 py-1.5 text-xs font-semibold transition ${
             isVisible ? 'border-blue-600 bg-blue-700 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
            }`}
           >
            {column.label}
           </button>
          );
         })}
        </div>
       </div>

       <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('transactions_more_settings')}</p>
        <div className="mt-2 space-y-4">
         <label className="flex items-center justify-between gap-3 rounded border border-slate-200 px-4 py-3 text-sm text-slate-700">
          <span>{t('transactions_show_exchange_rate')}</span>
          <input
           type="checkbox"
           checked={transactionTableSettingsDraft.showExchangeRate}
           onChange={() => setTransactionTableSettingsDraft((current) => ({ ...current, showExchangeRate: !current.showExchangeRate }))}
           className="h-4 w-4 cursor-pointer rounded border-slate-300 text-blue-700 focus:ring-blue-500"
          />
         </label>

         <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{t('pdf_date_format_label')}</label>
          <select
           value={transactionTableSettingsDraft.dateFormat}
           onChange={(event) => setTransactionTableSettingsDraft((current) => ({ ...current, dateFormat: event.target.value as TransactionTableSettings['dateFormat'] }))}
           className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
          >
           <option value="full">YYYY-MM-DD</option>
           <option value="day-month">DD/MM</option>
           <option value="month-year">MM/YYYY</option>
           <option value="day-month-year-2">DD/MM/YY</option>
           <option value="month-day">MM/DD</option>
          </select>
         </div>
        </div>
       </div>

       <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('ledger_row_highlight_color')}</p>
        <div className="mt-2 flex items-center gap-2">
         <input
          type="color"
          value={txRowHighlightColor}
          onChange={(event) => updateTxRowHighlightColor(event.target.value)}
          className="h-8 w-14 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
         />
         <span
          className="rounded px-3 py-1 text-xs font-semibold text-slate-700"
          style={{ backgroundColor: txRowHighlightColor }}
         >
          {txRowHighlightColor}
         </span>
        </div>
       </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
       <button
        type="button"
        onClick={closeTransactionTableSettingsModal}
        className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
       >
        {t('cancel')}
       </button>
       <button
        type="button"
        onClick={saveTransactionTableSettingsModal}
        className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
       >
        {t('save_changes')}
       </button>
      </div>
     </div>
    </div>
   ) : null}

   {pendingImportData && !importReview ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
     <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded bg-white shadow-2xl">
      <div className="border-b border-slate-200 p-6">
       <h3 className="text-lg font-semibold text-slate-900">{t('import_setup_title')}</h3>
       <p className="mt-1 text-sm text-slate-500">{t('import_setup_subtitle', { fileName: pendingImportData.fileName })}</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
       <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm text-slate-700">
         <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{t('import_setup_date_label')}</span>
         <select
          value={importMapping.dateColumn ?? ''}
          onChange={(event) => setImportMapping((current) => ({ ...current, dateColumn: event.target.value === '' ? null : Number(event.target.value) }))}
          className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
         >
          <option value="">{t('import_setup_date_none')}</option>
          {pendingImportData.columnOptions.map((option) => (
           <option
            key={option.index}
            value={option.index}
           >
            {option.label}
           </option>
          ))}
         </select>
        </label>

        <label className="text-sm text-slate-700">
         <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{t('import_setup_sender_label')}</span>
         <select
          value={importMapping.fromColumn ?? ''}
          onChange={(event) => setImportMapping((current) => ({ ...current, fromColumn: event.target.value === '' ? null : Number(event.target.value) }))}
          className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
         >
          <option value="">{t('import_setup_sender_placeholder')}</option>
          {pendingImportData.columnOptions.map((option) => (
           <option
            key={option.index}
            value={option.index}
           >
            {option.label}
           </option>
          ))}
         </select>
        </label>

        <label className="text-sm text-slate-700">
         <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{t('import_setup_receiver_label')}</span>
         <select
          value={importMapping.toColumn ?? ''}
          onChange={(event) => setImportMapping((current) => ({ ...current, toColumn: event.target.value === '' ? null : Number(event.target.value) }))}
          className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
         >
          <option value="">{t('import_setup_receiver_placeholder')}</option>
          {pendingImportData.columnOptions.map((option) => (
           <option
            key={option.index}
            value={option.index}
           >
            {option.label}
           </option>
          ))}
         </select>
        </label>

        <label className="text-sm text-slate-700">
         <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{t('import_setup_amount_label')}</span>
         <select
          value={importMapping.amountColumn ?? ''}
          onChange={(event) => setImportMapping((current) => ({ ...current, amountColumn: event.target.value === '' ? null : Number(event.target.value) }))}
          className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
         >
          <option value="">{t('import_setup_amount_placeholder')}</option>
          {pendingImportData.columnOptions.map((option) => (
           <option
            key={option.index}
            value={option.index}
           >
            {option.label}
           </option>
          ))}
         </select>
        </label>

        <label className="text-sm text-slate-700">
         <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{t('import_setup_description_label')}</span>
         <select
          value={importMapping.descriptionColumn ?? ''}
          onChange={(event) => setImportMapping((current) => ({ ...current, descriptionColumn: event.target.value === '' ? null : Number(event.target.value) }))}
          className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
         >
          <option value="">{t('import_setup_description_none')}</option>
          {pendingImportData.columnOptions.map((option) => (
           <option
            key={option.index}
            value={option.index}
           >
            {option.label}
           </option>
          ))}
         </select>
        </label>

        <label className="text-sm text-slate-700">
         <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{t('import_setup_currency_label')}</span>
         <select
          value={importMapping.currencyId ?? ''}
          onChange={(event) => setImportMapping((current) => ({ ...current, currencyId: event.target.value === '' ? null : Number(event.target.value) }))}
          className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
         >
          <option value="">{t('import_setup_currency_placeholder')}</option>
          {currencies.map((currency) => (
           <option
            key={currency.id}
            value={currency.id}
           >
            {currency.code} - {currency.name}
           </option>
          ))}
         </select>
        </label>
       </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 p-6">
       <button
        type="button"
        onClick={onCancelImportTransactions}
        disabled={isImportingTransactions}
        className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
       >
        {t('import_cancel')}
       </button>
       <button
        type="button"
        onClick={onPrepareImportReview}
        disabled={isImportingTransactions}
        className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
       >
        {t('import_review_clients')}
       </button>
      </div>
     </div>
    </div>
   ) : null}

   {importReview ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
     <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded bg-white shadow-2xl">
      <div className="border-b border-slate-200 p-6">
       <h3 className="text-lg font-semibold text-slate-900">{t('import_review_title')}</h3>
       <p className="mt-1 text-sm text-slate-500">
        {t('import_review_subtitle', { count: importReview.length, fileName: pendingImportData?.fileName ?? t('import_review_the_file') })}
       </p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
       <div className="flex flex-col gap-3">
        {importReview.map((entry) => {
         const addableCurrencies = enabledCurrencies.filter((item) => !entry.accountCurrencyIds.includes(item.id));
         return (
          <div
           key={entry.key}
           className={`rounded border p-3 ${entry.isExpense ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200'}`}
          >
           <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-slate-700">{entry.originalName}</span>
            <label className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-slate-600">
             <input
              type="checkbox"
              checked={entry.isExpense}
              onChange={(event) => updateImportReviewEntry(entry.key, { isExpense: event.target.checked })}
             />
             {t('import_review_expense_checkbox')}
            </label>
           </div>

           {entry.isExpense ? (
            <div className="mt-2">
             <p className="text-xs text-amber-700">{t('import_review_expense_hint', { name: entry.originalName })}</p>
             <div className="mt-2 flex flex-col gap-1.5">
              {importParsedRows
               .map((row, index) => ({ row, index }))
               .filter(({ row }) => importNameKey(row.fromName) === entry.key || importNameKey(row.toName) === entry.key)
               .map(({ row, index }) => {
                const counterparty = importNameKey(row.fromName) === entry.key ? row.toName : row.fromName;
                const override = importRowOverrides[index] ?? DEFAULT_IMPORT_ROW_OVERRIDE;
                const sendName = override.swap ? row.toName : row.fromName;
                const receiveName = override.swap ? row.fromName : row.toName;
                return (
                 <div
                  key={index}
                  className="rounded border border-amber-200 bg-white px-2.5 py-1.5 text-xs"
                 >
                  <div className="flex items-center justify-between gap-2">
                   <span className="min-w-0 flex-1 truncate text-slate-600">
                    {row.fromName} → {row.toName} · {row.amount}
                    {row.createdAt ? ` · ${row.createdAt.slice(0, 10)}` : ''}
                   </span>
                   <select
                    value={override.mode}
                    onChange={(event) => updateImportRowOverride(index, { mode: event.target.value as ImportRowOverride['mode'] })}
                    className="shrink-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs outline-none ring-blue-300 focus:ring"
                   >
                    <option value="expense">{t('import_review_mode_expense')}</option>
                    <option value="transaction">{t('import_review_mode_transaction')}</option>
                   </select>
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                   {override.mode === 'expense' ? (
                    <>
                     <span className="text-slate-500">{t('import_review_on_party', { party: counterparty || t('import_review_other_party') })}</span>
                     <select
                      value={override.direction}
                      onChange={(event) => updateImportRowOverride(index, { direction: event.target.value as ImportRowOverride['direction'] })}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs outline-none ring-blue-300 focus:ring"
                     >
                      <option value="debit">{t('import_review_debit')}</option>
                      <option value="credit">{t('import_review_credit')}</option>
                     </select>
                    </>
                   ) : (
                    <>
                     <span className="text-slate-600">
                      {t('import_review_from')} <span className="font-semibold">{sendName}</span> → {t('import_review_to')} <span className="font-semibold">{receiveName}</span>
                     </span>
                     <button
                      type="button"
                      onClick={() => updateImportRowOverride(index, { swap: !override.swap })}
                      className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 font-semibold text-slate-600 transition hover:bg-slate-50"
                     >
                      ⇄ {t('import_review_swap')}
                     </button>
                    </>
                   )}
                  </div>
                 </div>
                );
               })}
             </div>
            </div>
           ) : (
            <>
             {/* Client selector — DB clients + new clients being created in this import */}
             <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end">
              <label className="flex-1 text-sm text-slate-700">
               <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{t('client')}</span>
               <select
                value={entry.existingClientId != null ? String(entry.existingClientId) : entry.pendingEntryKey != null ? `__pending__${entry.pendingEntryKey}` : '__new__'}
                onChange={(event) => {
                 const val = event.target.value;
                 if (val === '__new__') {
                  updateImportReviewEntry(entry.key, { existingClientId: null, existingAccountId: null, pendingEntryKey: null, targetCurrencyId: null });
                  return;
                 }
                 if (val.startsWith('__pending__')) {
                  const refKey = val.slice('__pending__'.length);
                  const refEntry = importReview!.find((e) => e.key === refKey);
                  const firstCurrencyId = refEntry?.accountCurrencyIds[0] ?? null;
                  updateImportReviewEntry(entry.key, { existingClientId: null, existingAccountId: null, pendingEntryKey: refKey, targetCurrencyId: firstCurrencyId });
                  return;
                 }
                 const clientId = Number(val);
                 const accountsForClient = clientAccounts.filter((account) => account.clientId === clientId);
                 const defaultAccount = accountsForClient.find((account) => account.currencyId === entry.currencyId) ?? accountsForClient[0] ?? null;
                 updateImportReviewEntry(entry.key, { existingClientId: clientId, existingAccountId: defaultAccount?.id ?? null, pendingEntryKey: null, targetCurrencyId: null });
                }}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
               >
                <option value="__new__">{t('import_review_create_new')}</option>
                {/* Other review entries whose new clients can be reused */}
                {importReview!.filter((e) => e.key !== entry.key && !e.isExpense && e.existingClientId == null && e.pendingEntryKey == null && e.name.trim()).length > 0 ? (
                 <optgroup label={t('import_review_from_import')}>
                  {importReview!
                   .filter((e) => e.key !== entry.key && !e.isExpense && e.existingClientId == null && e.pendingEntryKey == null && e.name.trim())
                   .map((e) => (
                    <option
                     key={e.key}
                     value={`__pending__${e.key}`}
                    >
                     {e.name.trim()}
                    </option>
                   ))}
                 </optgroup>
                ) : null}
                {clients.length > 0 ? (
                 <optgroup label={t('import_review_existing_clients')}>
                  {clients.map((client) => (
                   <option
                    key={client.id}
                    value={client.id}
                   >
                    {client.name}
                   </option>
                  ))}
                 </optgroup>
                ) : null}
               </select>
              </label>

              {/* New client name — only for entries creating a fresh client */}
              {entry.existingClientId == null && entry.pendingEntryKey == null ? (
               <label className="flex-1 text-sm text-slate-700">
                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{t('import_review_new_client_name')}</span>
                <input
                 type="text"
                 value={entry.name}
                 onChange={(event) => updateImportReviewEntry(entry.key, { name: event.target.value })}
                 className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                />
               </label>
              ) : null}
             </div>

             {/* Organization — only for new clients */}
             {entry.existingClientId == null && entry.pendingEntryKey == null ? (
              <label className="mt-3 block text-sm text-slate-700">
               <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{t('client_organization')}</span>
               <select
                value={entry.organizationId ?? ''}
                onChange={(event) => {
                 if (event.target.value === '__create__') {
                  setOrgDialogTargetReviewKey(entry.key);
                  setOrganizationForm(emptyOrganizationForm());
                  setShowCreateOrgDialog(true);
                  return;
                 }
                 updateImportReviewEntry(entry.key, { organizationId: event.target.value === '' ? null : Number(event.target.value) });
                }}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
               >
                <option value="">{t('overview_no_organization')}</option>
                {organizations.map((organization) => (
                 <option
                  key={organization.id}
                  value={organization.id}
                 >
                  {organization.name}
                 </option>
                ))}
                <option value="__create__">{t('client_organization_create')}</option>
               </select>
              </label>
             ) : null}

             {/* Existing DB client — account selector (only when 2+ accounts) */}
             {entry.existingClientId != null
              ? (() => {
                 const accountsForClient = clientAccounts.filter((account) => account.clientId === entry.existingClientId);
                 if (!accountsForClient.length) {
                  return <p className="mt-2 text-xs text-amber-600">{t('import_review_existing_no_accounts')}</p>;
                 }
                 if (accountsForClient.length === 1) return null;
                 return (
                  <label className="mt-3 block text-sm text-slate-700">
                   <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{t('import_review_apply_account')}</span>
                   <select
                    value={entry.existingAccountId ?? ''}
                    onChange={(event) => updateImportReviewEntry(entry.key, { existingAccountId: event.target.value === '' ? null : Number(event.target.value) })}
                    className={`mt-1 w-full rounded border px-3 py-2 text-sm outline-none ring-blue-300 focus:ring bg-white ${entry.existingAccountId == null ? 'border-red-400' : 'border-slate-300'}`}
                   >
                    <option value="">{t('import_review_select_account')}</option>
                    {accountsForClient.map((account) => (
                     <option
                      key={account.id}
                      value={account.id}
                     >
                      {account.currencyCode}
                      {account.currencySymbol ? ` (${account.currencySymbol})` : ''}
                     </option>
                    ))}
                   </select>
                  </label>
                 );
                })()
              : null}

             {/* Pending-entry reference — "post rows to" from the referenced entry's accounts */}
             {entry.pendingEntryKey != null
              ? (() => {
                 const refEntry = importReview!.find((e) => e.key === entry.pendingEntryKey);
                 const refCurrencies = (refEntry?.accountCurrencyIds ?? [])
                  .map((id) => enabledCurrencies.find((c) => c.id === id) ?? currencies.find((c) => c.id === id))
                  .filter(Boolean);
                 if (refCurrencies.length === 0) {
                  return <p className="mt-2 text-xs text-amber-600">{t('import_review_ref_no_accounts', { name: refEntry?.name || refEntry?.originalName || '' })}</p>;
                 }
                 if (refCurrencies.length === 1) return null;
                 return (
                  <label className="mt-3 block text-sm text-slate-700">
                   <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{t('import_review_post_to')}</span>
                   <select
                    value={entry.targetCurrencyId ?? ''}
                    onChange={(event) => updateImportReviewEntry(entry.key, { targetCurrencyId: event.target.value === '' ? null : Number(event.target.value) })}
                    className={`mt-1 w-full rounded border px-3 py-2 text-sm outline-none ring-blue-300 focus:ring bg-white ${entry.targetCurrencyId == null ? 'border-red-400' : 'border-slate-300'}`}
                   >
                    <option value="">{t('import_review_select_account')}</option>
                    {refCurrencies.map(
                     (currency) =>
                      currency && (
                       <option
                        key={currency.id}
                        value={currency.id}
                       >
                        {currency.code}
                        {currency.symbol ? ` (${currency.symbol})` : ''}
                       </option>
                      ),
                    )}
                   </select>
                  </label>
                 );
                })()
              : null}

             {/* New client — accounts to open + which one to post rows to */}
             {entry.existingClientId == null && entry.pendingEntryKey == null ? (
              <div className="mt-3 space-y-2">
               <div>
                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{t('import_review_accounts_to_open')}</span>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                 {entry.accountCurrencyIds.length === 0 ? <span className="text-xs font-semibold text-red-500">{t('import_review_accounts_required')}</span> : null}
                 {entry.accountCurrencyIds.map((currencyId) => {
                  const currency = enabledCurrencies.find((item) => item.id === currencyId) ?? currencies.find((item) => item.id === currencyId);
                  return (
                   <span
                    key={currencyId}
                    className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700"
                   >
                    {currency ? currency.code : currencyId}
                    <button
                     type="button"
                     onClick={() => {
                      const next = entry.accountCurrencyIds.filter((id) => id !== currencyId);
                      updateImportReviewEntry(entry.key, {
                       accountCurrencyIds: next,
                       targetCurrencyId: entry.targetCurrencyId === currencyId ? (next[0] ?? null) : entry.targetCurrencyId,
                      });
                     }}
                     aria-label={t('close')}
                     className="text-slate-400 transition hover:text-slate-700"
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
                      <path d="M18 6 6 18M6 6l12 12" />
                     </svg>
                    </button>
                   </span>
                  );
                 })}
                 {addableCurrencies.length ? (
                  <select
                   value=""
                   onChange={(event) => {
                    const currencyId = Number(event.target.value);
                    if (!currencyId) return;
                    updateImportReviewEntry(entry.key, {
                     accountCurrencyIds: [...entry.accountCurrencyIds, currencyId],
                     targetCurrencyId: entry.targetCurrencyId ?? currencyId,
                    });
                   }}
                   className="rounded-full border border-dashed border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-600 outline-none ring-blue-300 focus:ring"
                  >
                   <option value="">{t('import_review_add_account')}</option>
                   {addableCurrencies.map((currency) => (
                    <option
                     key={currency.id}
                     value={currency.id}
                    >
                     {currency.code} - {currency.name}
                    </option>
                   ))}
                  </select>
                 ) : null}
                </div>
               </div>
               {entry.accountCurrencyIds.length >= 2 ? (
                <label className="block text-sm text-slate-700">
                 <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{t('import_review_post_to')}</span>
                 <select
                  value={entry.targetCurrencyId ?? ''}
                  onChange={(event) => updateImportReviewEntry(entry.key, { targetCurrencyId: event.target.value === '' ? null : Number(event.target.value) })}
                  className={`mt-1 w-full rounded border px-3 py-2 text-sm outline-none ring-blue-300 focus:ring bg-white ${entry.targetCurrencyId == null ? 'border-red-400' : 'border-slate-300'}`}
                 >
                  <option value="">{t('import_review_select_account')}</option>
                  {entry.accountCurrencyIds.map((currencyId) => {
                   const currency = enabledCurrencies.find((c) => c.id === currencyId) ?? currencies.find((c) => c.id === currencyId);
                   return currency ? (
                    <option
                     key={currencyId}
                     value={currencyId}
                    >
                     {currency.code}
                     {currency.symbol ? ` (${currency.symbol})` : ''}
                    </option>
                   ) : null;
                  })}
                 </select>
                </label>
               ) : null}
              </div>
             ) : null}
            </>
           )}

           <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            {entry.isExpense ? (
             <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">{t('import_review_badge_expense')}</span>
            ) : entry.existingClientId != null ? (
             <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">{t('import_review_badge_existing')}</span>
            ) : entry.pendingEntryKey != null ? (
             <span className="rounded-full bg-violet-100 px-2 py-0.5 font-semibold text-violet-700">{t('import_review_badge_new_from_import')}</span>
            ) : (
             <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700">{t('import_review_badge_new')}</span>
            )}
            <span className="text-slate-500">{t('import_review_row_count', { count: entry.transactionCount })}</span>
           </div>
          </div>
         );
        })}
       </div>
      </div>

      {/* Live preview: count rows that will be skipped before the user clicks import */}
      {(() => {
       const normKey = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
       const reviewMap = new Map(importReview.map((e) => [e.key, e]));

       // Returns true if the entry will have an account to post rows to after setup.
       const willHaveAccount = (entry: ImportClientReview): boolean => {
        if (entry.existingClientId != null) {
         // Existing clients are never given new accounts automatically, so they
         // post only to a chosen account or one they already hold in the import currency.
         if (entry.existingAccountId != null) return true;
         if (importMapping.currencyId == null) return false;
         return clientAccounts.some((a) => a.clientId === entry.existingClientId && a.currencyId === importMapping.currencyId);
        }
        if (entry.pendingEntryKey != null) {
         const ref = reviewMap.get(entry.pendingEntryKey);
         if (!ref) return false;
         const tid = entry.targetCurrencyId ?? importMapping.currencyId ?? 0;
         return ref.accountCurrencyIds.includes(tid);
        }
        const tid = entry.targetCurrencyId ?? importMapping.currencyId ?? 0;
        return entry.accountCurrencyIds.includes(tid);
       };

       let skipCount = 0;
       const skipNames: string[] = [];
       importParsedRows.forEach((row, index) => {
        const fromEntry = reviewMap.get(normKey(row.fromName)) ?? null;
        const toEntry = reviewMap.get(normKey(row.toName)) ?? null;
        const fromIsExpense = !!fromEntry?.isExpense;
        const toIsExpense = !!toEntry?.isExpense;
        const override = importRowOverrides[index] ?? DEFAULT_IMPORT_ROW_OVERRIDE;
        const asExpense = (fromIsExpense || toIsExpense) && override.mode !== 'transaction';

        if (asExpense) {
         if (fromIsExpense && toIsExpense) return;
         const realEntry = fromIsExpense ? toEntry : fromEntry;
         if (!realEntry || !willHaveAccount(realEntry)) {
          skipCount += 1;
          if (realEntry && !skipNames.includes(realEntry.originalName)) skipNames.push(realEntry.originalName);
         }
        } else {
         if (!fromEntry || !toEntry) return;
         const sendEntry = override.swap ? toEntry : fromEntry;
         const receiveEntry = override.swap ? fromEntry : toEntry;
         let skip = false;
         if (!willHaveAccount(sendEntry)) {
          skip = true;
          if (!skipNames.includes(sendEntry.originalName)) skipNames.push(sendEntry.originalName);
         }
         if (!willHaveAccount(receiveEntry)) {
          skip = true;
          if (!skipNames.includes(receiveEntry.originalName)) skipNames.push(receiveEntry.originalName);
         }
         if (skip) skipCount += 1;
        }
       });

       if (skipCount === 0) return null;
       return (
        <div className="border-t border-amber-200 bg-amber-50 px-6 py-3 text-xs text-amber-800">
         <span className="font-semibold">{t('import_skip_count', { count: skipCount })}</span>
         {' — '}
         {t('import_skip_hint_pre')} <span className="font-medium">{skipNames.join(', ')}</span>. {t('import_skip_hint_post')}
        </div>
       );
      })()}

      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 p-6">
       <button
        type="button"
        onClick={() => setImportReview(null)}
        disabled={isImportingTransactions}
        className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
       >
        {t('import_back')}
       </button>
       <button
        type="button"
        onClick={() => void onConfirmImportTransactions()}
        disabled={
         isImportingTransactions ||
         importReview.some((entry) => !entry.isExpense && entry.existingClientId == null && entry.pendingEntryKey == null && !entry.name.trim()) ||
         importReview.some((entry) => !entry.isExpense && entry.existingClientId == null && entry.pendingEntryKey == null && entry.accountCurrencyIds.length === 0) ||
         importReview.some(
          (entry) => !entry.isExpense && entry.existingClientId == null && entry.pendingEntryKey == null && entry.accountCurrencyIds.length >= 2 && entry.targetCurrencyId == null,
         ) ||
         importReview.some(
          (entry) =>
           !entry.isExpense &&
           entry.pendingEntryKey != null &&
           entry.targetCurrencyId == null &&
           (importReview.find((e) => e.key === entry.pendingEntryKey)?.accountCurrencyIds.length ?? 0) >= 2,
         ) ||
         importReview.some(
          (entry) =>
           !entry.isExpense && entry.existingClientId != null && entry.existingAccountId == null && clientAccounts.filter((a) => a.clientId === entry.existingClientId).length >= 2,
         )
        }
        className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
       >
        {isImportingTransactions ? t('import_creating') : t('import_create_transactions')}
       </button>
      </div>
     </div>
    </div>
   ) : null}

   {adjustmentModal
    ? (() => {
       const ledger = selectedClientLedgers.find((l) => l.accountId === adjustmentModal.accountId);
       const account = clientAccounts.find((a) => a.id === adjustmentModal.accountId);
       const selectedCurrency = adjustmentModal.currencyId ? currencyMap.get(adjustmentModal.currencyId) : undefined;
       const accountCurrencyCode = account?.currencyCode ?? ledger?.currencyCode ?? '';
       const needsRate = !!(selectedCurrency && accountCurrencyCode && selectedCurrency.code !== accountCurrencyCode);
       const rawRate = parseFloat(adjustmentModal.exchangeRate) || 0;
       const effectiveRate = adjustmentModal.exchangeRateReversed ? (rawRate ? 1 / rawRate : 0) : rawRate;
       const amountValue = parseFloat(adjustmentModal.amount) || 0;
       const convertedAmount = needsRate ? amountValue * (effectiveRate || 0) : amountValue;
       return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
         <div
          className="w-full max-w-md rounded bg-white p-6 shadow-2xl"
          onKeyDown={(e) => {
           // Enter submits the adjustment (ignore Enter inside multi-line fields).
           if (e.key !== 'Enter') return;
           if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
           e.preventDefault();
           void onSubmitAdjustment();
          }}
         >
          <h3 className="text-lg font-semibold text-slate-900">{adjustmentModal.editingId ? t('adjustment_edit_title') : t('adjustment_add_title')}</h3>
          {ledger ? (
           <p className="mt-1 text-sm text-slate-500">
            {selectedClientForLedger?.name} &mdash; {ledger.currencyName}
           </p>
          ) : null}

          <div className="mt-5 flex flex-col gap-4">
           <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('adjustment_direction')}</label>
            <div className="grid grid-cols-2 gap-2">
             <button
              type="button"
              onClick={() => setAdjustmentModal((prev) => (prev ? { ...prev, direction: 'debit' } : prev))}
              className={`rounded border px-3 py-2 text-sm font-semibold transition ${
               adjustmentModal.direction === 'debit' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
              }`}
             >
              {t('adjustment_direction_debit')}
             </button>
             <button
              type="button"
              onClick={() => setAdjustmentModal((prev) => (prev ? { ...prev, direction: 'credit' } : prev))}
              className={`rounded border px-3 py-2 text-sm font-semibold transition ${
               adjustmentModal.direction === 'credit' ? 'border-red-500 bg-red-50 text-red-700' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
              }`}
             >
              {t('adjustment_direction_credit')}
             </button>
            </div>
            <p className="mt-1 text-xs text-slate-400">{adjustmentModal.direction === 'debit' ? t('adjustment_debit_hint') : t('adjustment_credit_hint')}</p>
           </div>

           <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('amount')}</label>
            <input
             type="text"
             inputMode="decimal"
             dir="ltr"
             value={adjustmentModal.amount}
             onChange={(e) => setAdjustmentModal((prev) => (prev ? { ...prev, amount: normalizeDecimalInput(e.target.value) } : prev))}
             placeholder="0"
             autoFocus
             className="rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
            />
           </div>

           <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('currency')}</label>
            <select
             value={adjustmentModal.currencyId ?? ''}
             onChange={(e) =>
              setAdjustmentModal((prev) => (prev ? { ...prev, currencyId: e.target.value ? Number(e.target.value) : null, exchangeRate: '', exchangeRateReversed: false } : prev))
             }
             className="rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
            >
             {(adjustmentModal.currencyId && !enabledCurrencies.some((c) => c.id === adjustmentModal.currencyId)
              ? [...enabledCurrencies, ...localizedCurrencies.filter((c) => c.id === adjustmentModal.currencyId)]
              : enabledCurrencies
             ).map((currency) => (
              <option
               key={currency.id}
               value={currency.id}
              >
               {currency.code} {currency.symbol ? `(${currency.symbol})` : ''} · {currency.name}
              </option>
             ))}
            </select>
           </div>

           {needsRate ? (
            <div className="flex flex-col gap-1">
             <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('exchange_rate')}</label>
              <button
               type="button"
               title={t('reverse_rate')}
               onClick={() =>
                setAdjustmentModal((prev) => {
                 if (!prev) return prev;
                 const val = parseFloat(prev.exchangeRate) || 0;
                 return {
                  ...prev,
                  exchangeRate: val ? String(Number((1 / val).toFixed(6))) : prev.exchangeRate,
                  exchangeRateReversed: !prev.exchangeRateReversed,
                 };
                })
               }
               className="inline-flex items-center gap-1 rounded p-1 text-xs text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
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
               {adjustmentModal.exchangeRateReversed ? t('rate_division') : t('rate_multiplication')}
              </button>
             </div>
             <span className="text-xs text-slate-400">
              {adjustmentModal.exchangeRateReversed
               ? `1 ${accountCurrencyCode} = ? ${selectedCurrency?.code ?? ''}`
               : `1 ${selectedCurrency?.code ?? ''} = ? ${accountCurrencyCode}`}
             </span>
             <input
              type="text"
              inputMode="decimal"
              dir="ltr"
              value={adjustmentModal.exchangeRate}
              onChange={(e) => setAdjustmentModal((prev) => (prev ? { ...prev, exchangeRate: normalizeDecimalInput(e.target.value) } : prev))}
              placeholder="0"
              className="rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
             />
             {amountValue > 0 && effectiveRate > 0 ? (
              <span className="text-xs text-slate-500">
               = {convertedAmount.toLocaleString(numLocale, { maximumFractionDigits: ledgerDecimals })} {accountCurrencyCode}
              </span>
             ) : null}
            </div>
           ) : null}

           <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('adjustment_description')}</label>
            <input
             type="text"
             value={adjustmentModal.description}
             onChange={(e) => setAdjustmentModal((prev) => (prev ? { ...prev, description: e.target.value } : prev))}
             placeholder={t('adjustment_description_placeholder')}
             className="rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
            />
           </div>

           <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('date')}</label>
            <input
             type="date"
             value={adjustmentModal.date}
             onChange={(e) => setAdjustmentModal((prev) => (prev ? { ...prev, date: e.target.value } : prev))}
             className="rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
            />
           </div>
          </div>

          <div className="mt-5 flex justify-end gap-2">
           <button
            type="button"
            onClick={() => setAdjustmentModal(null)}
            className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
           >
            {t('cancel')}
           </button>
           <button
            type="button"
            onClick={() => void onSubmitAdjustment()}
            disabled={!adjustmentModal.amount || parseFloat(adjustmentModal.amount) <= 0}
            className="rounded bg-purple-700 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-800 disabled:cursor-not-allowed disabled:opacity-40"
           >
            {adjustmentModal.editingId ? t('save_changes') : t('adjustment_add')}
           </button>
          </div>
         </div>
        </div>
       );
      })()
    : null}

   {pdfExportModal
    ? (() => {
       const ledger = selectedClientLedgers.find((l) => l.accountId === pdfExportModal.accountId);
       if (!ledger) return null;
       return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
         <div className="w-full max-w-md rounded bg-white p-6 shadow-2xl">
          <h3 className="text-lg font-semibold text-slate-900">{t('export_pdf_title')}</h3>
          <p className="mt-1 text-sm text-slate-500">
           {selectedClientForLedger?.name} &mdash; {ledger.currencyName}
          </p>

          <div className="mt-5 flex flex-col gap-4">
           <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('export_date_from')}</label>
            <input
             type="date"
             value={pdfExportModal.fromDate}
             onChange={(e) => {
              savePdfDateRange(pdfExportModal.accountId, e.target.value, pdfExportModal.toDate);
              setPdfExportModal((prev) => (prev ? { ...prev, fromDate: e.target.value, fromEntryKey: null, toEntryKey: null } : prev));
             }}
             className="rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
            />
           </div>
           <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('export_date_to')}</label>
            <input
             type="date"
             value={pdfExportModal.toDate}
             onChange={(e) => {
              savePdfDateRange(pdfExportModal.accountId, pdfExportModal.fromDate, e.target.value);
              setPdfExportModal((prev) => (prev ? { ...prev, toDate: e.target.value, fromEntryKey: null, toEntryKey: null } : prev));
             }}
             className="rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
            />
           </div>

           {/* Shortcut: derive the range from the highlighted rows. The first highlighted row is
               the pre-balance boundary (excluded; its accumulated balance becomes the pre-balance),
               the last highlighted row is the final row shown. */}
           {(() => {
            const highlightedEntries = ledger.entries.filter((e) => highlightedLedgerRows.has(getLedgerTransactionDraftKey(e.transactionId, ledger.accountId)));
            if (highlightedEntries.length < 2) return null;
            return (
             <div className="flex flex-col gap-1">
              <button
               type="button"
               onClick={() => {
                const first = highlightedEntries[highlightedEntries.length - 2];
                const last = highlightedEntries[highlightedEntries.length - 1];
                const firstIdx = ledger.entries.findIndex((e) => ledgerEntryKey(e) === ledgerEntryKey(first));
                // Start one row after the first highlight so that row is excluded but its
                // accumulated balance is rolled into the pre-balance.
                const afterFirst = ledger.entries[firstIdx + 1] ?? last;
                const newFrom = afterFirst.createdAt.slice(0, 10);
                const newTo = last.createdAt.slice(0, 10);
                savePdfDateRange(pdfExportModal.accountId, newFrom, newTo);
                setPdfExportModal((prev) =>
                 prev ? { ...prev, fromDate: newFrom, toDate: newTo, fromEntryKey: ledgerEntryKey(afterFirst), toEntryKey: ledgerEntryKey(last) } : prev,
                );
               }}
               className="cursor-pointer rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-100"
              >
               {t('export_use_highlights')}
              </button>
              <p className="text-xs text-slate-400">{t('export_use_highlights_hint')}</p>
             </div>
            );
           })()}

           {/* Start picker lists only the From-date's transactions; End picker only the To-date's. */}
           {(() => {
            const startCandidates = ledger.entries.filter((e) => e.createdAt.slice(0, 10) === pdfExportModal.fromDate);
            const endCandidates = ledger.entries.filter((e) => e.createdAt.slice(0, 10) === pdfExportModal.toDate);
            if (startCandidates.length === 0 && endCandidates.length === 0) return null;
            const startKey =
             pdfExportModal.fromEntryKey && startCandidates.some((e) => ledgerEntryKey(e) === pdfExportModal.fromEntryKey)
              ? pdfExportModal.fromEntryKey
              : startCandidates[0]
                ? ledgerEntryKey(startCandidates[0])
                : '';
            const endKey =
             pdfExportModal.toEntryKey && endCandidates.some((e) => ledgerEntryKey(e) === pdfExportModal.toEntryKey)
              ? pdfExportModal.toEntryKey
              : endCandidates[endCandidates.length - 1]
                ? ledgerEntryKey(endCandidates[endCandidates.length - 1])
                : '';
            const entryLabel = (e: ClientLedgerEntry) =>
             `${formatDateValue(e.createdAt, pdfSettings.dateFormat)} · ${e.counterpartyName} · ${e.direction === 'outgoing' ? '−' : '+'}${e.amount.toLocaleString(numLocale, { maximumFractionDigits: pdfSettings.decimals })} ${e.currencySymbol || e.currencyCode}`;
            return (
             <>
              {startCandidates.length > 0 ? (
               <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('export_start_transaction')}</label>
                <select
                 value={startKey}
                 onChange={(e) => setPdfExportModal((prev) => (prev ? { ...prev, fromEntryKey: e.target.value } : prev))}
                 className="rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                >
                 {startCandidates.map((entry) => (
                  <option
                   key={ledgerEntryKey(entry)}
                   value={ledgerEntryKey(entry)}
                  >
                   {entryLabel(entry)}
                  </option>
                 ))}
                </select>
               </div>
              ) : null}
              {endCandidates.length > 0 ? (
               <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('export_end_transaction')}</label>
                <select
                 value={endKey}
                 onChange={(e) => setPdfExportModal((prev) => (prev ? { ...prev, toEntryKey: e.target.value } : prev))}
                 className="rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                >
                 {endCandidates.map((entry) => (
                  <option
                   key={ledgerEntryKey(entry)}
                   value={ledgerEntryKey(entry)}
                  >
                   {entryLabel(entry)}
                  </option>
                 ))}
                </select>
               </div>
              ) : null}
             </>
            );
           })()}

           {/* Column toggles */}
           <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('pdf_columns_label')}</label>
            <div className="mt-2 flex flex-wrap gap-1.5">
             {pdfAllColumns.map((col) => {
              const isRunningBal = col.key === 'runningBalance';
              const isOn = isRunningBal || pdfExportModal.cols[col.key];
              return (
               <button
                key={col.key}
                type="button"
                disabled={isRunningBal}
                onClick={() => {
                 if (isRunningBal) return;
                 const newCols = { ...pdfExportModal.cols, [col.key]: !pdfExportModal.cols[col.key] };
                 savePdfCols(pdfExportModal.accountId, newCols);
                 setPdfExportModal((prev) => (prev ? { ...prev, cols: newCols } : prev));
                }}
                className={`rounded border px-2.5 py-1 text-xs font-medium transition ${
                 isOn ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'
                } ${isRunningBal ? 'cursor-default opacity-60' : 'cursor-pointer'}`}
               >
                {col.label}
               </button>
              );
             })}
            </div>
           </div>

           {(() => {
            const candidates = ledger.entries.filter((e) => {
             const d = e.createdAt.slice(0, 10);
             return d >= pdfExportModal.fromDate && d <= pdfExportModal.toDate;
            });
            const startIdx = pdfExportModal.fromEntryKey
             ? Math.max(
                0,
                candidates.findIndex((e) => ledgerEntryKey(e) === pdfExportModal.fromEntryKey),
               )
             : 0;
            const endIdxRaw = pdfExportModal.toEntryKey ? candidates.findIndex((e) => ledgerEntryKey(e) === pdfExportModal.toEntryKey) : -1;
            const endIdx = endIdxRaw === -1 ? candidates.length - 1 : endIdxRaw;
            const selected = startIdx <= endIdx ? candidates.slice(startIdx, endIdx + 1) : [];
            const firstSelected = selected[0];
            const cutoffIndex = firstSelected ? ledger.entries.findIndex((e) => ledgerEntryKey(e) === ledgerEntryKey(firstSelected)) : ledger.entries.length;
            const preBalance = ledger.startingBalance + ledger.entries.slice(0, cutoffIndex < 0 ? 0 : cutoffIndex).reduce((sum, e) => sum + e.netChange, 0);
            const count = selected.length;
            return (
             <div className="rounded border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <div className="flex justify-between">
               <span className="text-slate-500">{t('export_pre_balance')}</span>
               <span className={`font-semibold ${preBalance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {preBalance.toLocaleString(numLocale, { maximumFractionDigits: 2 })} {ledger.currencySymbol || ledger.currencyCode}
               </span>
              </div>
              <div className="mt-1 flex justify-between">
               <span className="text-slate-500">{t('client_page_transaction_count')}</span>
               <span className="font-semibold text-slate-900">{count}</span>
              </div>
             </div>
            );
           })()}
          </div>

          <div className="mt-5 flex justify-end gap-2">
           <button
            type="button"
            onClick={() => setPdfExportModal(null)}
            className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
           >
            {t('cancel')}
           </button>
           <button
            type="button"
            onClick={() =>
             void onExportLedgerPdf(ledger, pdfExportModal.fromDate, pdfExportModal.toDate, pdfExportModal.cols, pdfExportModal.fromEntryKey, pdfExportModal.toEntryKey)
            }
            disabled={!pdfExportModal.fromDate || !pdfExportModal.toDate || pdfExportModal.fromDate > pdfExportModal.toDate}
            className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-40"
           >
            {t('export_pdf')}
           </button>
          </div>
         </div>
        </div>
       );
      })()
    : null}

   {showLedgerSettingsModal ? (
    <div
     className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
     onClick={() => setShowLedgerSettingsModal(false)}
    >
     <div
      className="w-full max-w-md rounded bg-white p-6 shadow-2xl"
      onClick={(e) => e.stopPropagation()}
     >
      <h3 className="text-lg font-semibold text-slate-900">{t('nav_settings')}</h3>

      <div className="mt-5 flex flex-col gap-5">
       {/* Decimal places */}
       <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('decimal_places')}</p>
        <div className="mt-2 flex overflow-hidden rounded border border-slate-300 bg-white w-fit">
         <button
          type="button"
          onClick={() => updateLedgerDecimals(Math.max(0, ledgerDecimals - 1))}
          disabled={ledgerDecimals === 0}
          className="px-3 py-1.5 text-sm font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-30 transition"
         >
          -
         </button>
         <span className="border-x border-slate-200 px-3 py-1.5 text-center text-sm font-semibold text-slate-800">{ledgerDecimals}</span>
         <button
          type="button"
          onClick={() => updateLedgerDecimals(Math.min(6, ledgerDecimals + 1))}
          disabled={ledgerDecimals === 6}
          className="px-3 py-1.5 text-sm font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-30 transition"
         >
          +
         </button>
        </div>
       </div>

       {/* Currency symbol toggle */}
       <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('currency_symbol')}</p>
        <button
         type="button"
         onClick={() => toggleLedgerCurrencySymbol()}
         aria-pressed={showLedgerCurrencySymbol}
         className={`mt-2 cursor-pointer rounded border px-3 py-1.5 text-xs font-semibold transition ${
          showLedgerCurrencySymbol ? 'border-blue-600 bg-blue-700 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
         }`}
        >
         {t('currency_symbol')}
        </button>
       </div>

       {/* Date format */}
       <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('pdf_date_format_label')}</p>
        <select
         value={ledgerDateFormat}
         onChange={(event) => updateLedgerDateFormat(event.target.value as PdfSettings['dateFormat'])}
         className="mt-2 w-full max-w-xs rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-blue-300 focus:ring"
        >
         <option value="full">2026-06-26 (YYYY-MM-DD)</option>
         <option value="day-month">26/06 (DD/MM)</option>
         <option value="month-day">06/26 (MM/DD)</option>
         <option value="day-month-year-2">26/06/26 (DD/MM/YY)</option>
         <option value="month-year">06/2026 (MM/YYYY)</option>
        </select>
       </div>

       {/* Highlight net change column */}
       <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('ledger_highlight_net_change')}</p>
        <button
         type="button"
         onClick={() => toggleLedgerHighlightNetChange()}
         aria-pressed={ledgerHighlightNetChange}
         className={`mt-2 cursor-pointer rounded border px-3 py-1.5 text-xs font-semibold transition ${
          ledgerHighlightNetChange ? 'border-blue-600 bg-blue-700 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
         }`}
        >
         {t('ledger_highlight_net_change')}
        </button>
        {ledgerHighlightNetChange ? (
         <div className="mt-2 flex items-center gap-2">
          <input
           type="color"
           value={ledgerNetChangeHighlightColor}
           onChange={(event) => updateLedgerNetChangeHighlightColor(event.target.value)}
           className="h-8 w-14 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
          />
          <span
           className="rounded px-3 py-1 text-xs font-semibold text-slate-700"
           style={{ backgroundColor: ledgerNetChangeHighlightColor }}
          >
           {ledgerNetChangeHighlightColor}
          </span>
         </div>
        ) : null}
       </div>

       {/* Row highlight colour */}
       <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('ledger_row_highlight_color')}</p>
        <div className="mt-2 flex items-center gap-2">
         <input
          type="color"
          value={ledgerRowHighlightColor}
          onChange={(event) => updateLedgerRowHighlightColor(event.target.value)}
          className="h-8 w-14 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
         />
         <span
          className="rounded px-3 py-1 text-xs font-semibold text-slate-700"
          style={{ backgroundColor: ledgerRowHighlightColor }}
         >
          {ledgerRowHighlightColor}
         </span>
        </div>
       </div>

       {/* Column visibility */}
       <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('client_ledger_columns')}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
         {orderedLedgerColumnOptions.map((column) => {
          const isVisible = ledgerColumnVisibility[column.key];
          return (
           <button
            key={column.key}
            type="button"
            onClick={() => toggleLedgerColumn(column.key)}
            aria-pressed={isVisible}
            className={`cursor-pointer rounded border px-3 py-1.5 text-xs font-semibold transition ${
             isVisible ? 'border-blue-600 bg-blue-700 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
            }`}
           >
            {column.label}
           </button>
          );
         })}
        </div>
       </div>
      </div>

      <div className="mt-5 flex justify-end gap-2">
       <button
        type="button"
        onClick={() => setShowLedgerSettingsModal(false)}
        className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
       >
        {t('close')}
       </button>
       <button
        type="button"
        onClick={() => {
         persistLedgerSettings({});
         setShowLedgerSettingsModal(false);
        }}
        className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
       >
        {t('ledger_settings_save')}
       </button>
      </div>
     </div>
    </div>
   ) : null}

   {/* Transient confirmation toast (auto-dismisses after ~1s) */}
   {toast ? (
    toastPos ? (
     <div
      className="pointer-events-none fixed z-[80]"
      style={{ left: toastPos.x, top: toastPos.y, transform: 'translate(-50%, calc(-100% - 10px))' }}
     >
      <div className="flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-lg whitespace-nowrap">
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
        <polyline points="20 6 9 17 4 12" />
       </svg>
       {toast}
      </div>
     </div>
    ) : (
     <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[80] flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-lg">
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
        <polyline points="20 6 9 17 4 12" />
       </svg>
       {toast}
      </div>
     </div>
    )
   ) : null}

   {/* Create Organization dialog */}
   {showCreateOrgDialog ? (
    <div
     className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
     onClick={() => {
      setShowCreateOrgDialog(false);
      setOrgDialogTargetReviewKey(null);
      setOrgDialogError('');
     }}
    >
     <div
      className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
      onClick={(e) => e.stopPropagation()}
     >
      <h2 className="text-lg font-semibold text-slate-900">{t('new_organization')}</h2>
      {orgDialogError ? (
       <div className="mt-3 flex items-start gap-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
        <span className="flex-1">{orgDialogError}</span>
        <button
         type="button"
         onClick={() => setOrgDialogError('')}
         className="shrink-0 text-red-400 hover:text-red-700"
         aria-label={t('close')}
        >
         <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
         >
          <path d="M18 6 6 18M6 6l12 12" />
         </svg>
        </button>
       </div>
      ) : null}
      <form
       onSubmit={(e) => void onCreateOrgFromDialog(e)}
       className="mt-4 flex flex-col gap-4"
      >
       <div>
        <label className="block text-sm font-medium text-slate-700">{t('organization_name')}</label>
        <input
         type="text"
         value={organizationForm.name}
         onChange={(event) => setOrganizationForm((current) => ({ ...current, name: event.target.value }))}
         placeholder={t('organization_name_placeholder')}
         className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
         autoFocus
         required
        />
       </div>
       <div className="flex justify-end gap-2">
        <button
         type="button"
         onClick={() => {
          setShowCreateOrgDialog(false);
          setOrgDialogTargetReviewKey(null);
          setOrganizationForm(emptyOrganizationForm());
          setOrgDialogError('');
         }}
         className="rounded border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition"
        >
         {t('cancel')}
        </button>
        <button
         type="submit"
         disabled={isSavingOrg}
         className="inline-flex items-center gap-2 rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
         {isSavingOrg ? <Spinner className="text-base" /> : null}
         {t('save_organization')}
        </button>
       </div>
      </form>
     </div>
    </div>
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
function useDraftHistory<T>(drafts: T, setDrafts: (value: T) => void) {
 const past = useRef<T[]>([]);
 const future = useRef<T[]>([]);
 const burstActive = useRef(false);
 const burstTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
 const latest = useRef(drafts);
 latest.current = drafts;
 const [, bump] = useReducer((x: number) => x + 1, 0);

 const record = useCallback(() => {
  if (!burstActive.current) {
   past.current = [...past.current, latest.current].slice(-100);
   future.current = [];
   burstActive.current = true;
   bump();
  }
  if (burstTimer.current) clearTimeout(burstTimer.current);
  burstTimer.current = setTimeout(() => {
   burstActive.current = false;
  }, 500);
 }, []);

 const undo = useCallback(() => {
  if (past.current.length === 0) return;
  burstActive.current = false;
  if (burstTimer.current) clearTimeout(burstTimer.current);
  const prev = past.current[past.current.length - 1];
  past.current = past.current.slice(0, -1);
  future.current = [...future.current, latest.current];
  setDrafts(prev);
  bump();
 }, [setDrafts]);

 const redo = useCallback(() => {
  if (future.current.length === 0) return;
  const next = future.current[future.current.length - 1];
  future.current = future.current.slice(0, -1);
  past.current = [...past.current, latest.current];
  setDrafts(next);
  bump();
 }, [setDrafts]);

 const reset = useCallback(() => {
  past.current = [];
  future.current = [];
  burstActive.current = false;
  if (burstTimer.current) clearTimeout(burstTimer.current);
  bump();
 }, []);

 return { record, undo, redo, reset, canUndo: past.current.length > 0, canRedo: future.current.length > 0 };
}

function AccountSearchSelect({
 accounts,
 value,
 onChange,
 placeholder,
 clearLabel,
 isRTL,
}: {
 accounts: ClientAccount[];
 value: number | null;
 onChange: (id: number | null) => void;
 placeholder: string;
 clearLabel: string;
 isRTL: boolean;
}) {
 const [query, setQuery] = useState('');
 const [open, setOpen] = useState(false);
 const selected = value != null ? (accounts.find((account) => account.id === value) ?? null) : null;
 const selectedLabel = selected ? `${selected.clientName} · ${selected.currencyCode}` : '';
 const q = query.trim().toLowerCase();
 const filtered = q ? accounts.filter((account) => `${account.clientName} ${account.currencyCode}`.toLowerCase().includes(q)) : accounts;
 return (
  <div className="relative">
   <input
    type="text"
    value={open ? query : selectedLabel}
    onChange={(event) => {
     setQuery(event.target.value);
     setOpen(true);
    }}
    onFocus={() => {
     setQuery('');
     setOpen(true);
    }}
    onBlur={() => setTimeout(() => setOpen(false), 150)}
    placeholder={placeholder}
    autoComplete="off"
    className={`min-w-40 w-full rounded border border-slate-300 px-2 py-1.5 text-xs outline-none ring-blue-300 focus:ring ${isRTL ? 'pl-7' : 'pr-7'}`}
   />
   {value != null && !open ? (
    <button
     type="button"
     onMouseDown={(event) => {
      event.preventDefault();
      onChange(null);
      setQuery('');
      setOpen(false);
     }}
     title={clearLabel}
     aria-label={clearLabel}
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
   {open ? (
    <ul className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded border border-slate-200 bg-white text-xs shadow-lg">
     {filtered.length === 0 ? (
      <li className="px-3 py-2 text-slate-400">{placeholder}</li>
     ) : (
      filtered.map((account) => (
       <li
        key={account.id}
        onMouseDown={() => {
         onChange(account.id);
         setQuery('');
         setOpen(false);
        }}
        className={`cursor-pointer px-3 py-2 hover:bg-blue-50 ${value === account.id ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-800'}`}
       >
        {account.clientName} · {account.currencyCode}
       </li>
      ))
     )}
    </ul>
   ) : null}
  </div>
 );
}

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
