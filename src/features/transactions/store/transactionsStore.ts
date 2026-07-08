import { create } from 'zustand';
import type { Dispatch, SetStateAction } from 'react';
import { getStoredArchiveTableSettings, getStoredTransactionTableSettings } from '@/shared/lib/localStorage';
import { emptyTransactionForm } from '@/features/transactions/forms';
import type {
 ImportClientReview,
 ImportMappingState,
 ImportRowOverride,
 ImportedTransactionRow,
 PendingImportData,
 TransactionForm,
 TransactionTableDraft,
 TransactionTableRow,
 TransactionTableSettings,
} from '@/shared/types';

/**
 * UI state for the Transactions/Archive feature (per browser): the new-transaction
 * form + comboboxes, the editable table (edit mode, selection, drafts, drag order,
 * pagination, filters, sort, expansions, table settings), export/settings modals,
 * and the import wizard. Migrated out of the page so the ~2k-line transactions view
 * can read it directly instead of via dozens of props. Setters are setState-
 * compatible so existing call sites (incl. functional updaters) are unchanged.
 */
type TransactionsStore = {
 isTransactionsEditMode: boolean;
 setIsTransactionsEditMode: Dispatch<SetStateAction<boolean>>;
 selectedTransactionIds: Set<number>;
 setSelectedTransactionIds: Dispatch<SetStateAction<Set<number>>>;
 editingRowIds: Set<number>;
 setEditingRowIds: Dispatch<SetStateAction<Set<number>>>;
 isEditAllTransactions: boolean;
 setIsEditAllTransactions: Dispatch<SetStateAction<boolean>>;
 dragRowId: number | null;
 setDragRowId: Dispatch<SetStateAction<number | null>>;
 dragOverRowId: number | null;
 setDragOverRowId: Dispatch<SetStateAction<number | null>>;
 dragOverHalf: 'top' | 'bottom';
 setDragOverHalf: Dispatch<SetStateAction<'top' | 'bottom'>>;
 manualRowOrder: number[] | null;
 setManualRowOrder: Dispatch<SetStateAction<number[] | null>>;
 transactionsPage: number;
 setTransactionsPage: Dispatch<SetStateAction<number>>;
 transactionsPageSize: number;
 setTransactionsPageSize: Dispatch<SetStateAction<number>>;
 showTransactionTableSettingsModal: boolean;
 setShowTransactionTableSettingsModal: Dispatch<SetStateAction<boolean>>;
 transactionTableSettings: TransactionTableSettings;
 setTransactionTableSettings: Dispatch<SetStateAction<TransactionTableSettings>>;
 transactionTableSettingsDraft: TransactionTableSettings;
 setTransactionTableSettingsDraft: Dispatch<SetStateAction<TransactionTableSettings>>;
 // Archive is a separate table from Transactions (different rows/columns), so its column
 // visibility/date-format is tracked independently — see archiveTableSettingsStorageKey.
 archiveTableSettings: TransactionTableSettings;
 setArchiveTableSettings: Dispatch<SetStateAction<TransactionTableSettings>>;
 archiveTableSettingsDraft: TransactionTableSettings;
 setArchiveTableSettingsDraft: Dispatch<SetStateAction<TransactionTableSettings>>;
 showTransactionExportModal: boolean;
 setShowTransactionExportModal: Dispatch<SetStateAction<boolean>>;
 transactionExportFrom: string;
 setTransactionExportFrom: Dispatch<SetStateAction<string>>;
 transactionExportTo: string;
 setTransactionExportTo: Dispatch<SetStateAction<string>>;
 isExportingTransactions: boolean;
 setIsExportingTransactions: Dispatch<SetStateAction<boolean>>;
 txSortDir: 'desc' | 'asc';
 setTxSortDir: Dispatch<SetStateAction<'desc' | 'asc'>>;
 txFilterOpen: boolean;
 setTxFilterOpen: Dispatch<SetStateAction<boolean>>;
 txFilterSearch: string;
 setTxFilterSearch: Dispatch<SetStateAction<string>>;
 txFilterClient: string;
 setTxFilterClient: Dispatch<SetStateAction<string>>;
 txFilterDateFrom: string;
 setTxFilterDateFrom: Dispatch<SetStateAction<string>>;
 txFilterDateTo: string;
 setTxFilterDateTo: Dispatch<SetStateAction<string>>;
 txFilterHideExpenses: boolean;
 setTxFilterHideExpenses: Dispatch<SetStateAction<boolean>>;
 commissionExpandedTxns: Set<number>;
 setCommissionExpandedTxns: Dispatch<SetStateAction<Set<number>>>;
 expensesExpandedTxns: Set<number>;
 setExpensesExpandedTxns: Dispatch<SetStateAction<Set<number>>>;
 isNewTransactionSectionOpen: boolean;
 setIsNewTransactionSectionOpen: Dispatch<SetStateAction<boolean>>;
 isNewTransactionExpensesOpen: boolean;
 setIsNewTransactionExpensesOpen: Dispatch<SetStateAction<boolean>>;
 transactionTableDrafts: Record<number, TransactionTableDraft>;
 setTransactionTableDrafts: Dispatch<SetStateAction<Record<number, TransactionTableDraft>>>;
 transactionForm: TransactionForm;
 setTransactionForm: Dispatch<SetStateAction<TransactionForm>>;
 isSubmittingTransaction: boolean;
 setIsSubmittingTransaction: Dispatch<SetStateAction<boolean>>;
 txSplitDescription: boolean;
 setTxSplitDescription: Dispatch<SetStateAction<boolean>>;
 newTransactionDate: string;
 setNewTransactionDate: Dispatch<SetStateAction<string>>;
 copiedTransaction: TransactionTableRow | null;
 setCopiedTransaction: Dispatch<SetStateAction<TransactionTableRow | null>>;
 txFromQuery: string;
 setTxFromQuery: Dispatch<SetStateAction<string>>;
 txFromOpen: boolean;
 setTxFromOpen: Dispatch<SetStateAction<boolean>>;
 txFromExpandedClient: number | null;
 setTxFromExpandedClient: Dispatch<SetStateAction<number | null>>;
 txToQuery: string;
 setTxToQuery: Dispatch<SetStateAction<string>>;
 txToOpen: boolean;
 setTxToOpen: Dispatch<SetStateAction<boolean>>;
 txToExpandedClient: number | null;
 setTxToExpandedClient: Dispatch<SetStateAction<number | null>>;
 descriptionSuggestOpen: boolean;
 setDescriptionSuggestOpen: Dispatch<SetStateAction<boolean>>;
 txFromRateReversed: boolean;
 setTxFromRateReversed: Dispatch<SetStateAction<boolean>>;
 txToRateReversed: boolean;
 setTxToRateReversed: Dispatch<SetStateAction<boolean>>;
 tableRateFromReversed: Record<number, boolean>;
 setTableRateFromReversed: Dispatch<SetStateAction<Record<number, boolean>>>;
 tableRateToReversed: Record<number, boolean>;
 setTableRateToReversed: Dispatch<SetStateAction<Record<number, boolean>>>;
 importMapping: ImportMappingState;
 setImportMapping: Dispatch<SetStateAction<ImportMappingState>>;
 pendingImportData: PendingImportData | null;
 setPendingImportData: Dispatch<SetStateAction<PendingImportData | null>>;
 importReview: ImportClientReview[] | null;
 setImportReview: Dispatch<SetStateAction<ImportClientReview[] | null>>;
 importParsedRows: ImportedTransactionRow[];
 setImportParsedRows: Dispatch<SetStateAction<ImportedTransactionRow[]>>;
 importRowOverrides: Record<number, ImportRowOverride>;
 setImportRowOverrides: Dispatch<SetStateAction<Record<number, ImportRowOverride>>>;
 isImportingTransactions: boolean;
 setIsImportingTransactions: Dispatch<SetStateAction<boolean>>;
};

export const useTransactionsStore = create<TransactionsStore>((set) => {
 const setter =
  <K extends keyof TransactionsStore>(key: K) =>
  (updater: SetStateAction<TransactionsStore[K]>) =>
   set((s) => ({ [key]: typeof updater === 'function' ? (updater as (v: TransactionsStore[K]) => TransactionsStore[K])(s[key]) : updater } as Pick<TransactionsStore, K>));

 return {
  isTransactionsEditMode: false,
  setIsTransactionsEditMode: setter('isTransactionsEditMode'),
  selectedTransactionIds: new Set(),
  setSelectedTransactionIds: setter('selectedTransactionIds'),
  editingRowIds: new Set(),
  setEditingRowIds: setter('editingRowIds'),
  isEditAllTransactions: false,
  setIsEditAllTransactions: setter('isEditAllTransactions'),
  dragRowId: null,
  setDragRowId: setter('dragRowId'),
  dragOverRowId: null,
  setDragOverRowId: setter('dragOverRowId'),
  dragOverHalf: 'bottom',
  setDragOverHalf: setter('dragOverHalf'),
  manualRowOrder: null,
  setManualRowOrder: setter('manualRowOrder'),
  transactionsPage: 99999,
  setTransactionsPage: setter('transactionsPage'),
  transactionsPageSize: 100,
  setTransactionsPageSize: setter('transactionsPageSize'),
  showTransactionTableSettingsModal: false,
  setShowTransactionTableSettingsModal: setter('showTransactionTableSettingsModal'),
  transactionTableSettings: getStoredTransactionTableSettings(),
  setTransactionTableSettings: setter('transactionTableSettings'),
  transactionTableSettingsDraft: getStoredTransactionTableSettings(),
  setTransactionTableSettingsDraft: setter('transactionTableSettingsDraft'),
  archiveTableSettings: getStoredArchiveTableSettings(),
  setArchiveTableSettings: setter('archiveTableSettings'),
  archiveTableSettingsDraft: getStoredArchiveTableSettings(),
  setArchiveTableSettingsDraft: setter('archiveTableSettingsDraft'),
  showTransactionExportModal: false,
  setShowTransactionExportModal: setter('showTransactionExportModal'),
  transactionExportFrom: '',
  setTransactionExportFrom: setter('transactionExportFrom'),
  transactionExportTo: '',
  setTransactionExportTo: setter('transactionExportTo'),
  isExportingTransactions: false,
  setIsExportingTransactions: setter('isExportingTransactions'),
  txSortDir: 'desc',
  setTxSortDir: setter('txSortDir'),
  txFilterOpen: false,
  setTxFilterOpen: setter('txFilterOpen'),
  txFilterSearch: '',
  setTxFilterSearch: setter('txFilterSearch'),
  txFilterClient: '',
  setTxFilterClient: setter('txFilterClient'),
  txFilterDateFrom: '',
  setTxFilterDateFrom: setter('txFilterDateFrom'),
  txFilterDateTo: '',
  setTxFilterDateTo: setter('txFilterDateTo'),
  txFilterHideExpenses: false,
  setTxFilterHideExpenses: setter('txFilterHideExpenses'),
  commissionExpandedTxns: new Set(),
  setCommissionExpandedTxns: setter('commissionExpandedTxns'),
  expensesExpandedTxns: new Set(),
  setExpensesExpandedTxns: setter('expensesExpandedTxns'),
  isNewTransactionSectionOpen: false,
  setIsNewTransactionSectionOpen: setter('isNewTransactionSectionOpen'),
  isNewTransactionExpensesOpen: false,
  setIsNewTransactionExpensesOpen: setter('isNewTransactionExpensesOpen'),
  transactionTableDrafts: {},
  setTransactionTableDrafts: setter('transactionTableDrafts'),
  transactionForm: emptyTransactionForm(),
  setTransactionForm: setter('transactionForm'),
  isSubmittingTransaction: false,
  setIsSubmittingTransaction: setter('isSubmittingTransaction'),
  txSplitDescription: false,
  setTxSplitDescription: setter('txSplitDescription'),
  newTransactionDate: new Date().toISOString().slice(0, 10),
  setNewTransactionDate: setter('newTransactionDate'),
  copiedTransaction: null,
  setCopiedTransaction: setter('copiedTransaction'),
  txFromQuery: '',
  setTxFromQuery: setter('txFromQuery'),
  txFromOpen: false,
  setTxFromOpen: setter('txFromOpen'),
  txFromExpandedClient: null,
  setTxFromExpandedClient: setter('txFromExpandedClient'),
  txToQuery: '',
  setTxToQuery: setter('txToQuery'),
  txToOpen: false,
  setTxToOpen: setter('txToOpen'),
  txToExpandedClient: null,
  setTxToExpandedClient: setter('txToExpandedClient'),
  descriptionSuggestOpen: false,
  setDescriptionSuggestOpen: setter('descriptionSuggestOpen'),
  txFromRateReversed: false,
  setTxFromRateReversed: setter('txFromRateReversed'),
  txToRateReversed: false,
  setTxToRateReversed: setter('txToRateReversed'),
  tableRateFromReversed: {},
  setTableRateFromReversed: setter('tableRateFromReversed'),
  tableRateToReversed: {},
  setTableRateToReversed: setter('tableRateToReversed'),
  importMapping: { dateColumn: null, fromColumn: null, toColumn: null, amountColumn: null, descriptionColumn: null, moreInfoColumn: null, currencyId: null },
  setImportMapping: setter('importMapping'),
  pendingImportData: null,
  setPendingImportData: setter('pendingImportData'),
  importReview: null,
  setImportReview: setter('importReview'),
  importParsedRows: [],
  setImportParsedRows: setter('importParsedRows'),
  importRowOverrides: {},
  setImportRowOverrides: setter('importRowOverrides'),
  isImportingTransactions: false,
  setIsImportingTransactions: setter('isImportingTransactions'),
 };
});
