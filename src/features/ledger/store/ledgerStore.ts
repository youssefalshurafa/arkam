import { create } from 'zustand';
import type { Dispatch, SetStateAction } from 'react';
import { defaultLedgerColumnOrder, defaultLedgerColumnVisibility } from '@/shared/lib/localStorage';
import type { LedgerColumnKey, LedgerTransactionDraft, PdfColVisibility, PdfSettings } from '@/shared/types';

export type PdfExportModalState = {
 accountId: number;
 fromDate: string;
 toDate: string;
 fromEntryKey: string | null;
 toEntryKey: string | null;
 cols: PdfColVisibility;
};

export type AdjustmentModalState = {
 accountId: number;
 editingId: number | null;
 amount: string;
 direction: 'debit' | 'credit';
 currencyId: number | null;
 exchangeRate: string;
 exchangeRateReversed: boolean;
 description: string;
 date: string;
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
 // "Sum mode": a running-total calculator. While on, clicking a row's amount toggles it into
 // ledgerSumSelection (key -> its amount + currency); the toolbar shows the sum of the values.
 ledgerSumMode: boolean;
 setLedgerSumMode: Dispatch<SetStateAction<boolean>>;
 ledgerSumSelection: Map<string, { amount: number; currencyCode: string }>;
 setLedgerSumSelection: Dispatch<SetStateAction<Map<string, { amount: number; currencyCode: string }>>>;
 showLedgerSettingsModal: boolean;
 setShowLedgerSettingsModal: Dispatch<SetStateAction<boolean>>;
 ledgerFilterOpen: boolean;
 setLedgerFilterOpen: Dispatch<SetStateAction<boolean>>;
 ledgerFilterSearch: string;
 setLedgerFilterSearch: Dispatch<SetStateAction<string>>;
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
 ledgerRowClickHighlight: boolean;
 setLedgerRowClickHighlight: Dispatch<SetStateAction<boolean>>;
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
 adjustmentModal: AdjustmentModalState | null;
 setAdjustmentModal: Dispatch<SetStateAction<AdjustmentModalState | null>>;
 ledgerCounterpartyOpen: string | null;
 setLedgerCounterpartyOpen: Dispatch<SetStateAction<string | null>>;
 ledgerCounterpartyQuery: string;
 setLedgerCounterpartyQuery: Dispatch<SetStateAction<string>>;
 ledgerCounterpartyExpandedClient: number | null;
 setLedgerCounterpartyExpandedClient: Dispatch<SetStateAction<number | null>>;
 ledgerRateReversed: Record<string, boolean>;
 setLedgerRateReversed: Dispatch<SetStateAction<Record<string, boolean>>>;
 ledgerDisplayRateReversed: Record<string, boolean>;
 setLedgerDisplayRateReversed: Dispatch<SetStateAction<Record<string, boolean>>>;
};

export const useLedgerStore = create<LedgerStore>((set) => {
 const setter =
  <K extends keyof LedgerStore>(key: K) =>
  (updater: SetStateAction<LedgerStore[K]>) =>
   set((s) => ({ [key]: typeof updater === 'function' ? (updater as (v: LedgerStore[K]) => LedgerStore[K])(s[key]) : updater } as Pick<LedgerStore, K>));

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
  ledgerSumSelection: new Map(),
  setLedgerSumSelection: setter('ledgerSumSelection'),
  showLedgerSettingsModal: false,
  setShowLedgerSettingsModal: setter('showLedgerSettingsModal'),
  ledgerFilterOpen: false,
  setLedgerFilterOpen: setter('ledgerFilterOpen'),
  ledgerFilterSearch: '',
  setLedgerFilterSearch: setter('ledgerFilterSearch'),
  ledgerFilterCounterparty: '',
  setLedgerFilterCounterparty: setter('ledgerFilterCounterparty'),
  ledgerFilterDateFrom: '',
  setLedgerFilterDateFrom: setter('ledgerFilterDateFrom'),
  ledgerFilterDateTo: '',
  setLedgerFilterDateTo: setter('ledgerFilterDateTo'),
  ledgerDecimals: 2,
  setLedgerDecimals: setter('ledgerDecimals'),
  ledgerDateFormat: 'full',
  setLedgerDateFormat: setter('ledgerDateFormat'),
  ledgerHighlightNetChange: true,
  setLedgerHighlightNetChange: setter('ledgerHighlightNetChange'),
  ledgerNetChangeHighlightColor: '#eff6ff',
  setLedgerNetChangeHighlightColor: setter('ledgerNetChangeHighlightColor'),
  ledgerRowHighlightColor: '#fde68a',
  setLedgerRowHighlightColor: setter('ledgerRowHighlightColor'),
  ledgerRowClickHighlight: true,
  setLedgerRowClickHighlight: setter('ledgerRowClickHighlight'),
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
  adjustmentModal: null,
  setAdjustmentModal: setter('adjustmentModal'),
  ledgerCounterpartyOpen: null,
  setLedgerCounterpartyOpen: setter('ledgerCounterpartyOpen'),
  ledgerCounterpartyQuery: '',
  setLedgerCounterpartyQuery: setter('ledgerCounterpartyQuery'),
  ledgerCounterpartyExpandedClient: null,
  setLedgerCounterpartyExpandedClient: setter('ledgerCounterpartyExpandedClient'),
  ledgerRateReversed: {},
  setLedgerRateReversed: setter('ledgerRateReversed'),
  ledgerDisplayRateReversed: {},
  setLedgerDisplayRateReversed: setter('ledgerDisplayRateReversed'),
 };
});
