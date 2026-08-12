import { create } from 'zustand';
import type { Dispatch, SetStateAction } from 'react';
import { defaultLedgerColumnOrder, defaultLedgerColumnVisibility, getStoredLedgerFilter, getStoredLedgerHighlightPresets, getStoredTableZoom } from '@/shared/lib/localStorage';
import type { LedgerColumnKey, LedgerTransactionDraft, PdfColVisibility, PdfSettings } from '@/shared/types';

export type PdfExportModalState = {
 accountId: number;
 fromDate: string;
 toDate: string;
 fromEntryKey: string | null;
 toEntryKey: string | null;
 cols: PdfColVisibility;
};

// A transaction with only one real party — the client whose ledger
// this was opened from — and the other side left unset, meaning "me" personally rather than
// another client account. Same field set as the normal Transactions-page form (type, rate,
// commission, charges) minus the second account picker, since that side never exists. Its own
// independent state/submit path (see openOneSidedTransactionModal/onSubmitOneSidedTransaction
// in useLedgerActions.ts) — deliberately not sharing transactionForm/onTransactionSubmit with
// the Transactions page, so an in-progress edit there can never collide with this modal.
export type OneSidedTransactionModalState = {
 accountId: number;
 // 'client_from': the client is the sender (accountFromId), the other side (accountToId) is
 // unset. 'client_to': the client is the receiver (accountToId), accountFromId is unset.
 direction: 'client_from' | 'client_to';
 date: string;
 type: string;
 amount: string;
 currencyId: number | null;
 exchangeRate: string;
 exchangeRateReversed: boolean;
 commission: string;
 charges: string;
 chargesCurrencyId: number | null;
 chargesPayer: string;
 chargesExchangeRate: string;
 chargesDescription: string;
 description: string;
 // Free-text name for the unset side (not a registered client) — e.g. "cash payment to
 // landlord". Keeps this row out of the Archive's missing-party list; see counterParty on
 // the Transaction type / filterDisplayedTransactionRows.
 counterParty: string;
};

// Commission Distribution report popup (see distributionCommission.ts) — scoped to one
// client-currency account at a time. fromEntryKey/toEntryKey (set together) pin an exact
// row-range picked via the ledger's highlight-pen mode, mirroring PdfExportModalState's
// fromEntryKey/toEntryKey; when null the plain fromDate/toDate inputs are used instead.
// receivingSelections/settlementSelections classify the range's transactions by their own
// free-text description (grouped via groupEntriesByDescription) — keyed by description text,
// not a pre-configured location, since there's no persistent per-client location list anymore.
export type CommissionModalState = {
 accountId: number;
 fromDate: string;
 toDate: string;
 fromEntryKey: string | null;
 toEntryKey: string | null;
 receivingSelections: Record<string, { included: boolean; rate: string }>;
 settlementSelections: Record<string, boolean>;
};

function initialLedgerPageSize(): number {
 if (typeof window === 'undefined') return 50;
 const stored = parseInt(window.localStorage.getItem('arkam:ledger-page-size') ?? '', 10);
 return [25, 50, 100].includes(stored) ? stored : 50;
}

/**
 * UI state for the client-ledger feature (per browser): row editing/selection,
 * drafts, filters, column order/visibility, per-client display settings +
 * highlights (loaded from localStorage by the page effect when the open client
 * changes), starting-balance drafts, counterparty combobox, and the PDF-export /
 * adjustment modals. Setters are setState-compatible so call sites are unchanged.
 */
type LedgerStore = {
 clientLedgerBackSection: 'clients' | 'organization-clients';
 setClientLedgerBackSection: Dispatch<SetStateAction<'clients' | 'organization-clients'>>;
 editingLedgerRowKeys: Set<string>;
 setEditingLedgerRowKeys: Dispatch<SetStateAction<Set<string>>>;
 editAllLedgerAccountIds: Set<number>;
 setEditAllLedgerAccountIds: Dispatch<SetStateAction<Set<number>>>;
 selectedLedgerEntryKeys: Set<string>;
 setSelectedLedgerEntryKeys: Dispatch<SetStateAction<Set<string>>>;
 // "Sum mode": a running-total calculator. While on, clicking a row's amount toggles its key
 // into ledgerSumSelection; the toolbar shows the sum of the CURRENT (live) values for those
 // keys, so editing a summed row's amount afterward updates the total instead of it going stale.
 ledgerSumMode: boolean;
 setLedgerSumMode: Dispatch<SetStateAction<boolean>>;
 ledgerSumSelection: Set<string>;
 setLedgerSumSelection: Dispatch<SetStateAction<Set<string>>>;
 showLedgerSettingsModal: boolean;
 setShowLedgerSettingsModal: Dispatch<SetStateAction<boolean>>;
 ledgerFilterOpen: boolean;
 setLedgerFilterOpen: Dispatch<SetStateAction<boolean>>;
 ledgerFilterSearch: string;
 setLedgerFilterSearch: Dispatch<SetStateAction<string>>;
 ledgerFilterWholeWord: boolean;
 setLedgerFilterWholeWord: Dispatch<SetStateAction<boolean>>;
 ledgerFilterCounterparty: string;
 setLedgerFilterCounterparty: Dispatch<SetStateAction<string>>;
 ledgerFilterDateFrom: string;
 setLedgerFilterDateFrom: Dispatch<SetStateAction<string>>;
 ledgerFilterDateTo: string;
 setLedgerFilterDateTo: Dispatch<SetStateAction<string>>;
 ledgerDecimals: number;
 setLedgerDecimals: Dispatch<SetStateAction<number>>;
 ledgerDateFormat: PdfSettings['dateFormat'];
 setLedgerDateFormat: Dispatch<SetStateAction<PdfSettings['dateFormat']>>;
 ledgerHighlightNetChange: boolean;
 setLedgerHighlightNetChange: Dispatch<SetStateAction<boolean>>;
 ledgerNetChangeHighlightColor: string;
 setLedgerNetChangeHighlightColor: Dispatch<SetStateAction<string>>;
 ledgerRowHighlightColor: string;
 setLedgerRowHighlightColor: Dispatch<SetStateAction<string>>;
 // The 3 saved "pen" colors offered in ledger settings for quickly switching
 // ledgerRowHighlightColor — global across every client's ledger, not per-client.
 ledgerRowHighlightPresets: [string, string, string];
 setLedgerRowHighlightPresets: Dispatch<SetStateAction<[string, string, string]>>;
 ledgerRowClickHighlight: boolean;
 setLedgerRowClickHighlight: Dispatch<SetStateAction<boolean>>;
 // Whether the highlight/copy click mode is engaged at all. When false the pointer is neutral
 // and row clicks do nothing (session-only; the highlight-vs-copy preference still persists).
 ledgerRowClickActive: boolean;
 setLedgerRowClickActive: Dispatch<SetStateAction<boolean>>;
 highlightedLedgerRows: Map<string, string>;
 setHighlightedLedgerRows: Dispatch<SetStateAction<Map<string, string>>>;
 ledgerStartingBalanceDrafts: Record<number, string>;
 setLedgerStartingBalanceDrafts: Dispatch<SetStateAction<Record<number, string>>>;
 editingStartingBalanceIds: Set<number>;
 setEditingStartingBalanceIds: Dispatch<SetStateAction<Set<number>>>;
 ledgerPageState: Record<number, number>;
 setLedgerPageState: Dispatch<SetStateAction<Record<number, number>>>;
 ledgerPageSize: number;
 setLedgerPageSize: Dispatch<SetStateAction<number>>;
 ledgerExpensesExpandedKeys: Set<string>;
 setLedgerExpensesExpandedKeys: Dispatch<SetStateAction<Set<string>>>;
 showLedgerCurrencySymbol: boolean;
 setShowLedgerCurrencySymbol: Dispatch<SetStateAction<boolean>>;
 draggedLedgerColumn: LedgerColumnKey | null;
 setDraggedLedgerColumn: Dispatch<SetStateAction<LedgerColumnKey | null>>;
 dragLedgerRowKey: string | null;
 setDragLedgerRowKey: Dispatch<SetStateAction<string | null>>;
 dragOverLedgerRowKey: string | null;
 setDragOverLedgerRowKey: Dispatch<SetStateAction<string | null>>;
 dragOverLedgerHalf: 'top' | 'bottom';
 setDragOverLedgerHalf: Dispatch<SetStateAction<'top' | 'bottom'>>;
 ledgerColumnOrder: LedgerColumnKey[];
 setLedgerColumnOrder: Dispatch<SetStateAction<LedgerColumnKey[]>>;
 ledgerColumnVisibility: Record<LedgerColumnKey, boolean>;
 setLedgerColumnVisibility: Dispatch<SetStateAction<Record<LedgerColumnKey, boolean>>>;
 ledgerTransactionDrafts: Record<string, LedgerTransactionDraft>;
 setLedgerTransactionDrafts: Dispatch<SetStateAction<Record<string, LedgerTransactionDraft>>>;
 pdfExportModal: PdfExportModalState | null;
 setPdfExportModal: Dispatch<SetStateAction<PdfExportModalState | null>>;
 oneSidedTransactionModal: OneSidedTransactionModalState | null;
 setOneSidedTransactionModal: Dispatch<SetStateAction<OneSidedTransactionModalState | null>>;
 // Which account's ledger the "New Transaction" modal is open for, or null when closed. Unlike
 // oneSidedTransactionModal above, the form data itself isn't duplicated here — it lives in
 // useTransactionsStore's transactionForm and friends, the same store the Transactions page's
 // own inline form reads/writes, so NewTransactionForm behaves identically wherever it's mounted.
 newTransactionModalAccountId: number | null;
 setNewTransactionModalAccountId: Dispatch<SetStateAction<number | null>>;
 commissionModal: CommissionModalState | null;
 setCommissionModal: Dispatch<SetStateAction<CommissionModalState | null>>;
 ledgerCounterpartyOpen: string | null;
 setLedgerCounterpartyOpen: Dispatch<SetStateAction<string | null>>;
 ledgerCounterpartyQuery: string;
 setLedgerCounterpartyQuery: Dispatch<SetStateAction<string>>;
 ledgerCounterpartyExpandedClient: number | null;
 setLedgerCounterpartyExpandedClient: Dispatch<SetStateAction<number | null>>;
 // Same combobox pattern as the counterparty picker above, but for reassigning which
 // client/account THIS side of the row belongs to (i.e. moving the row to another client's ledger).
 ledgerSelfAccountOpen: string | null;
 setLedgerSelfAccountOpen: Dispatch<SetStateAction<string | null>>;
 ledgerSelfAccountQuery: string;
 setLedgerSelfAccountQuery: Dispatch<SetStateAction<string>>;
 ledgerSelfAccountExpandedClient: number | null;
 setLedgerSelfAccountExpandedClient: Dispatch<SetStateAction<number | null>>;
 ledgerRateReversed: Record<string, boolean>;
 setLedgerRateReversed: Dispatch<SetStateAction<Record<string, boolean>>>;
 ledgerDisplayRateReversed: Record<string, boolean>;
 setLedgerDisplayRateReversed: Dispatch<SetStateAction<Record<string, boolean>>>;
 // Per-user-synced (see sharedTableSettings.ts) — kept in this store rather than a plain
 // useState in LedgerSection so page.tsx's post-login settings fetch can re-hydrate it into
 // the already-mounted component; a bare useState's lazy initializer only ever reads
 // localStorage once, before that fetch resolves, so a fresh device would stay stuck at the
 // default zoom until a full reload.
 tableZoom: number;
 setTableZoom: Dispatch<SetStateAction<number>>;
};

export const useLedgerStore = create<LedgerStore>((set) => {
 const setter =
  <K extends keyof LedgerStore>(key: K) =>
  (updater: SetStateAction<LedgerStore[K]>) =>
   set((s) => ({ [key]: typeof updater === 'function' ? (updater as (v: LedgerStore[K]) => LedgerStore[K])(s[key]) : updater } as Pick<LedgerStore, K>));

 const initialLedgerFilter = getStoredLedgerFilter();

 return {
  clientLedgerBackSection: 'clients',
  setClientLedgerBackSection: setter('clientLedgerBackSection'),
  editingLedgerRowKeys: new Set(),
  setEditingLedgerRowKeys: setter('editingLedgerRowKeys'),
  editAllLedgerAccountIds: new Set(),
  setEditAllLedgerAccountIds: setter('editAllLedgerAccountIds'),
  selectedLedgerEntryKeys: new Set(),
  setSelectedLedgerEntryKeys: setter('selectedLedgerEntryKeys'),
  ledgerSumMode: false,
  setLedgerSumMode: setter('ledgerSumMode'),
  ledgerSumSelection: new Set(),
  setLedgerSumSelection: setter('ledgerSumSelection'),
  showLedgerSettingsModal: false,
  setShowLedgerSettingsModal: setter('showLedgerSettingsModal'),
  ledgerFilterOpen: false,
  setLedgerFilterOpen: setter('ledgerFilterOpen'),
  ledgerFilterSearch: initialLedgerFilter.search,
  setLedgerFilterSearch: setter('ledgerFilterSearch'),
  ledgerFilterWholeWord: initialLedgerFilter.wholeWord,
  setLedgerFilterWholeWord: setter('ledgerFilterWholeWord'),
  ledgerFilterCounterparty: initialLedgerFilter.counterparty,
  setLedgerFilterCounterparty: setter('ledgerFilterCounterparty'),
  ledgerFilterDateFrom: initialLedgerFilter.dateFrom,
  setLedgerFilterDateFrom: setter('ledgerFilterDateFrom'),
  ledgerFilterDateTo: initialLedgerFilter.dateTo,
  setLedgerFilterDateTo: setter('ledgerFilterDateTo'),
  ledgerDecimals: 0,
  setLedgerDecimals: setter('ledgerDecimals'),
  ledgerDateFormat: 'day-month',
  setLedgerDateFormat: setter('ledgerDateFormat'),
  ledgerHighlightNetChange: true,
  setLedgerHighlightNetChange: setter('ledgerHighlightNetChange'),
  ledgerNetChangeHighlightColor: '#eff6ff',
  setLedgerNetChangeHighlightColor: setter('ledgerNetChangeHighlightColor'),
  ledgerRowHighlightColor: '#fde68a',
  setLedgerRowHighlightColor: setter('ledgerRowHighlightColor'),
  ledgerRowHighlightPresets: getStoredLedgerHighlightPresets(),
  setLedgerRowHighlightPresets: setter('ledgerRowHighlightPresets'),
  ledgerRowClickHighlight: true,
  setLedgerRowClickHighlight: setter('ledgerRowClickHighlight'),
  ledgerRowClickActive: false,
  setLedgerRowClickActive: setter('ledgerRowClickActive'),
  highlightedLedgerRows: new Map(),
  setHighlightedLedgerRows: setter('highlightedLedgerRows'),
  ledgerStartingBalanceDrafts: {},
  setLedgerStartingBalanceDrafts: setter('ledgerStartingBalanceDrafts'),
  editingStartingBalanceIds: new Set(),
  setEditingStartingBalanceIds: setter('editingStartingBalanceIds'),
  ledgerPageState: {},
  setLedgerPageState: setter('ledgerPageState'),
  ledgerPageSize: initialLedgerPageSize(),
  setLedgerPageSize: setter('ledgerPageSize'),
  ledgerExpensesExpandedKeys: new Set(),
  setLedgerExpensesExpandedKeys: setter('ledgerExpensesExpandedKeys'),
  showLedgerCurrencySymbol: true,
  setShowLedgerCurrencySymbol: setter('showLedgerCurrencySymbol'),
  draggedLedgerColumn: null,
  setDraggedLedgerColumn: setter('draggedLedgerColumn'),
  dragLedgerRowKey: null,
  setDragLedgerRowKey: setter('dragLedgerRowKey'),
  dragOverLedgerRowKey: null,
  setDragOverLedgerRowKey: setter('dragOverLedgerRowKey'),
  dragOverLedgerHalf: 'bottom',
  setDragOverLedgerHalf: setter('dragOverLedgerHalf'),
  ledgerColumnOrder: defaultLedgerColumnOrder,
  setLedgerColumnOrder: setter('ledgerColumnOrder'),
  ledgerColumnVisibility: { ...defaultLedgerColumnVisibility },
  setLedgerColumnVisibility: setter('ledgerColumnVisibility'),
  ledgerTransactionDrafts: {},
  setLedgerTransactionDrafts: setter('ledgerTransactionDrafts'),
  pdfExportModal: null,
  setPdfExportModal: setter('pdfExportModal'),
  oneSidedTransactionModal: null,
  setOneSidedTransactionModal: setter('oneSidedTransactionModal'),
  newTransactionModalAccountId: null,
  setNewTransactionModalAccountId: setter('newTransactionModalAccountId'),
  commissionModal: null,
  setCommissionModal: setter('commissionModal'),
  ledgerCounterpartyOpen: null,
  setLedgerCounterpartyOpen: setter('ledgerCounterpartyOpen'),
  ledgerCounterpartyQuery: '',
  setLedgerCounterpartyQuery: setter('ledgerCounterpartyQuery'),
  ledgerCounterpartyExpandedClient: null,
  setLedgerCounterpartyExpandedClient: setter('ledgerCounterpartyExpandedClient'),
  ledgerSelfAccountOpen: null,
  setLedgerSelfAccountOpen: setter('ledgerSelfAccountOpen'),
  ledgerSelfAccountQuery: '',
  setLedgerSelfAccountQuery: setter('ledgerSelfAccountQuery'),
  ledgerSelfAccountExpandedClient: null,
  setLedgerSelfAccountExpandedClient: setter('ledgerSelfAccountExpandedClient'),
  ledgerRateReversed: {},
  setLedgerRateReversed: setter('ledgerRateReversed'),
  ledgerDisplayRateReversed: {},
  setLedgerDisplayRateReversed: setter('ledgerDisplayRateReversed'),
  tableZoom: getStoredTableZoom('ledger'),
  setTableZoom: setter('tableZoom'),
 };
});
