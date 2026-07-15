import type {
 DataCache,
 ExchangeSettings,
 LedgerColumnKey,
 PdfColVisibility,
 PdfSettings,
 StoredLedgerSettings,
 TransactionColumnVisibility,
 TransactionTableSettings,
} from '@/shared/types';

// Theme preference (Light / Dark / System). Stored per-device like the language
// choice — never synced to the server. 'system' follows the OS via matchMedia.
export type ThemeChoice = 'light' | 'dark' | 'system';
export const themeStorageKey = 'arkam:theme';

export function getStoredTheme(): ThemeChoice {
 if (typeof window === 'undefined') return 'system';
 try {
  const raw = window.localStorage.getItem(themeStorageKey);
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
 } catch {
  return 'system';
 }
}

export function saveStoredTheme(theme: ThemeChoice): void {
 if (typeof window === 'undefined') return;
 try {
  window.localStorage.setItem(themeStorageKey, theme);
 } catch {
  // Ignore write failures (private mode / quota) — theme just won't persist.
 }
}

// Base reading order is date, amount, commission, exchange rate, counterparty (left to
// right in English/French); Arabic's RTL layout mirrors this order automatically via the
// browser's native right-to-left table rendering, so no separate order is needed per language.
export const defaultLedgerColumnOrder: LedgerColumnKey[] = [
 'created',
 'description',
 'amount',
 'commission',
 'exchangeRate',
 'direction',
 'type',
 'currency',
 'netChange',
 'runningBalance',
 'counterparty',
];
export const ledgerColumnOrderStorageKeyPrefix = 'arkam:ledger-col-order:';
// Legacy global key — read once during migration so existing orders aren't lost.
export const legacyLedgerColumnOrderStorageKey = 'arkam:ledger-column-order';
export const ledgerColumnVisibilityStorageKeyPrefix = 'arkam:ledger-cols:';
// User-defined order of organization cards on the clients page (keys: org id as
// string, or '__unassigned__'). Persisted so the arrangement survives refreshes.
export const clientsOrgOrderStorageKey = 'arkam:clients-org-order';
export function getStoredClientsOrgOrder(): string[] {
 if (typeof window === 'undefined') return [];
 try {
  const raw = window.localStorage.getItem(clientsOrgOrderStorageKey);
  const parsed = raw ? JSON.parse(raw) : [];
  return Array.isArray(parsed) ? parsed.map(String) : [];
 } catch {
  return [];
 }
}
export const pdfSettingsStorageKey = 'arkam:pdf-settings';
export const pdfColsStorageKeyPrefix = 'arkam:pdf-cols:';
export const pdfDateRangeStorageKeyPrefix = 'arkam:pdf-date-range:';
export const transactionTableSettingsStorageKey = 'arkam:transaction-table-settings';
// Archive is a distinct table from the main Transactions table (different rows, different
// columns like "more info"), so its column visibility/date-format is stored separately —
// hiding a column in one must not affect the other.
export const archiveTableSettingsStorageKey = 'arkam:archive-table-settings';
// On-screen table zoom level, keyed per table ('ledger' | 'transactions'). A pure
// viewing preference (like a spreadsheet's zoom), so it is stored globally rather
// than per-client. Lets mobile users shrink these wide tables to see every column.
export const tableZoomStorageKeyPrefix = 'arkam:table-zoom:';
export const minTableZoom = 0.5;
export const maxTableZoom = 1.2;

export function getStoredTableZoom(key: 'ledger' | 'transactions'): number {
 if (typeof window === 'undefined') return 1;
 try {
  const raw = window.localStorage.getItem(tableZoomStorageKeyPrefix + key);
  if (!raw) return 1;
  const parsed = parseFloat(raw);
  if (isNaN(parsed)) return 1;
  return Math.min(maxTableZoom, Math.max(minTableZoom, parsed));
 } catch {
  return 1;
 }
}

export function saveTableZoom(key: 'ledger' | 'transactions', value: number) {
 try {
  window.localStorage.setItem(tableZoomStorageKeyPrefix + key, String(value));
 } catch {
  /* ignore quota / privacy-mode errors */
 }
}

// How often (in seconds) the Live Rates screen re-polls the feed while it is open.
export const liveRatesIntervalStorageKey = 'arkam:live-rates-interval';
export const defaultLiveRatesInterval = 5;
export const minLiveRatesInterval = 2;
export const maxLiveRatesInterval = 3600;

export function getStoredLiveRatesInterval(): number {
 if (typeof window === 'undefined') return defaultLiveRatesInterval;
 try {
  const raw = window.localStorage.getItem(liveRatesIntervalStorageKey);
  if (!raw) return defaultLiveRatesInterval;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) return defaultLiveRatesInterval;
  return Math.min(maxLiveRatesInterval, Math.max(minLiveRatesInterval, parsed));
 } catch {
  return defaultLiveRatesInterval;
 }
}

export function saveLiveRatesInterval(value: number) {
 try {
  window.localStorage.setItem(liveRatesIntervalStorageKey, String(value));
 } catch {
  /* ignore quota / privacy-mode errors */
 }
}
// Remembers the last ledger account the user viewed per client, so refreshing the
// page (or revisiting the client) restores that account instead of jumping to the first.
export const ledgerLastAccountStorageKeyPrefix = 'arkam:ledger-last-account:';

export function getStoredLedgerAccountId(clientId: number): number | null {
 if (typeof window === 'undefined') return null;
 try {
  const raw = window.localStorage.getItem(ledgerLastAccountStorageKeyPrefix + clientId);
  if (!raw) return null;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) ? null : parsed;
 } catch {
  return null;
 }
}

export function setStoredLedgerAccountId(clientId: number, accountId: number) {
 if (typeof window === 'undefined') return;
 try {
  window.localStorage.setItem(ledgerLastAccountStorageKeyPrefix + clientId, String(accountId));
 } catch {
  /* ignore quota / privacy-mode errors */
 }
}
// User-entered FX rates for the overview balance cards, keyed by currency code
// (e.g. { EUR: '10.92', USD: '9.50' }). Stable across currency reseeds.
export const overviewRatesStorageKey = 'arkam:overview-rates';

export function getStoredOverviewRates(): Record<string, string> {
 if (typeof window === 'undefined') return {};
 try {
  const raw = window.localStorage.getItem(overviewRatesStorageKey);
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
 } catch {
  return {};
 }
}

export function saveOverviewRates(rates: Record<string, string>) {
 try {
  window.localStorage.setItem(overviewRatesStorageKey, JSON.stringify(rates));
 } catch {
  /* ignore */
 }
}

// Daily reference rates for the حصاد اليوم (Today's Harvest) page, keyed by
// `${yyyy-mm-dd}:${currencyId}` → main-currency-per-unit. Only needed to value
// foreign-to-foreign trades (most deals price directly against the main currency).
export const harvestRatesStorageKey = 'arkam:harvest-ref-rates';

export function getStoredHarvestRates(): Record<string, string> {
 if (typeof window === 'undefined') return {};
 try {
  const raw = window.localStorage.getItem(harvestRatesStorageKey);
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
 } catch {
  return {};
 }
}

export function saveHarvestRates(rates: Record<string, string>) {
 try {
  window.localStorage.setItem(harvestRatesStorageKey, JSON.stringify(rates));
 } catch {
  /* ignore */
 }
}

// Opening inventory for the حصاد اليوم (Today's Harvest) profit engine: the quantity
// and average cost (in the main currency) of each currency the house already held as
// of `asOf`, used to seed the weighted-average cost pools before replaying tagged
// buy/sell transactions. Load-bearing accounting input — flagged to move to a
// per-workspace DB table once the page graduates from super-admin-only.
export type StoredHarvestOpening = { asOf: string; byCurrency: Record<string, { qty: string; avgCost: string }> };
export const harvestOpeningStorageKey = 'arkam:harvest-opening-costs';

export function getStoredHarvestOpening(): StoredHarvestOpening {
 if (typeof window === 'undefined') return { asOf: '', byCurrency: {} };
 try {
  const raw = window.localStorage.getItem(harvestOpeningStorageKey);
  if (!raw) return { asOf: '', byCurrency: {} };
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') return { asOf: '', byCurrency: {} };
  return { asOf: typeof parsed.asOf === 'string' ? parsed.asOf : '', byCurrency: parsed.byCurrency && typeof parsed.byCurrency === 'object' ? parsed.byCurrency : {} };
 } catch {
  return { asOf: '', byCurrency: {} };
 }
}

export function saveHarvestOpening(value: StoredHarvestOpening) {
 try {
  window.localStorage.setItem(harvestOpeningStorageKey, JSON.stringify(value));
 } catch {
  /* ignore */
 }
}
export const dataCacheStorageKey = 'arkam:data-cache';

// The snapshot is tagged with the id of the user who wrote it AND the workspace it
// was fetched for. readDataCache only returns it when both match, so another
// account signing in on the same browser can never read the previous user's
// financial data from the cache (regardless of any purge timing), and switching
// between two workspaces owned by the same user can never read the other
// workspace's data either.
type StoredDataCache = DataCache & { ownerId: string | null; workspaceId: string | null };

export function readDataCache(ownerId: string | null | undefined, workspaceId: string | null | undefined): DataCache | null {
 try {
  const raw = typeof window !== 'undefined' ? window.sessionStorage.getItem(dataCacheStorageKey) : null;
  if (!raw) return null;
  const parsed = JSON.parse(raw) as StoredDataCache;
  // Only hand back a cache that belongs to the current user AND workspace.
  if (!ownerId || parsed.ownerId !== ownerId) return null;
  if (!workspaceId || parsed.workspaceId !== workspaceId) return null;
  delete (parsed as { ownerId?: unknown }).ownerId;
  delete (parsed as { workspaceId?: unknown }).workspaceId;
  return parsed;
 } catch {
  return null;
 }
}

export function saveDataCache(data: DataCache, ownerId: string | null | undefined, workspaceId: string | null | undefined) {
 try {
  const payload: StoredDataCache = { ...data, ownerId: ownerId ?? null, workspaceId: workspaceId ?? null };
  window.sessionStorage.setItem(dataCacheStorageKey, JSON.stringify(payload));
 } catch {
  /* ignore — cache is best-effort */
 }
}
export const defaultLedgerColumnVisibility: Record<LedgerColumnKey, boolean> = {
 created: true,
 counterparty: true,
 direction: false,
 type: false,
 amount: true,
 currency: false,
 exchangeRate: true,
 commission: true,
 netChange: true,
 runningBalance: true,
 description: true,
};

// Column show/hide is stored per client so each client's ledger keeps its own choice.
export function getStoredLedgerColumnVisibility(clientId: number | null | undefined): Record<LedgerColumnKey, boolean> {
 if (typeof window === 'undefined' || !clientId) return { ...defaultLedgerColumnVisibility };
 try {
  const raw = window.localStorage.getItem(ledgerColumnVisibilityStorageKeyPrefix + clientId);
  if (!raw) return { ...defaultLedgerColumnVisibility };
  return { ...defaultLedgerColumnVisibility, ...JSON.parse(raw) };
 } catch {
  return { ...defaultLedgerColumnVisibility };
 }
}
// Per-client ledger display settings (decimals, currency symbol, date format), stored
// alongside column visibility so each client's ledger keeps its own preferences.
export const ledgerSettingsStorageKeyPrefix = 'arkam:ledger-settings:';
export const defaultLedgerSettings: StoredLedgerSettings = {
 decimals: 0,
 showCurrencySymbol: true,
 dateFormat: 'day-month',
 highlightNetChange: true,
 netChangeHighlightColor: '#eff6ff',
 rowHighlightColor: '#fde68a',
 rowClickHighlight: true,
};
export function getStoredLedgerSettings(clientId: number | null | undefined): StoredLedgerSettings {
 if (typeof window === 'undefined' || !clientId) return { ...defaultLedgerSettings };
 try {
  const raw = window.localStorage.getItem(ledgerSettingsStorageKeyPrefix + clientId);
  if (!raw) return { ...defaultLedgerSettings };
  return { ...defaultLedgerSettings, ...JSON.parse(raw) };
 } catch {
  return { ...defaultLedgerSettings };
 }
}
// Row keys the user has click-highlighted, stored per client so highlights persist.
// Each key maps to the color it was highlighted with, so changing the setting later
// does not retroactively recolor already-highlighted rows.
export const ledgerHighlightsStorageKeyPrefix = 'arkam:ledger-highlights:';
export const txHighlightsStorageKey = 'arkam:tx-highlights';
export const txRowSettingsStorageKey = 'arkam:tx-row-settings';
export function getStoredTxHighlights(): Map<number, string> {
 if (typeof window === 'undefined') return new Map();
 try {
  const raw = window.localStorage.getItem(txHighlightsStorageKey);
  const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  if (!parsed || typeof parsed !== 'object') return new Map();
  return new Map(Object.entries(parsed).map(([k, v]) => [Number(k), String(v)]));
 } catch {
  return new Map();
 }
}
export function getStoredTxRowSettings(): { rowClickHighlight: boolean; rowHighlightColor: string } {
 if (typeof window === 'undefined') return { rowClickHighlight: true, rowHighlightColor: '#fde68a' };
 try {
  const raw = window.localStorage.getItem(txRowSettingsStorageKey);
  const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  return {
   rowClickHighlight: typeof parsed?.rowClickHighlight === 'boolean' ? parsed.rowClickHighlight : true,
   rowHighlightColor: typeof parsed?.rowHighlightColor === 'string' ? parsed.rowHighlightColor : '#fde68a',
  };
 } catch {
  return { rowClickHighlight: true, rowHighlightColor: '#fde68a' };
 }
}
export function getStoredLedgerHighlights(clientId: number | null | undefined): Map<string, string> {
 if (typeof window === 'undefined' || !clientId) return new Map();
 try {
  const raw = window.localStorage.getItem(ledgerHighlightsStorageKeyPrefix + clientId);
  const parsed = raw ? JSON.parse(raw) : null;
  if (!parsed) return new Map();
  // New format: { key: color }
  if (!Array.isArray(parsed) && typeof parsed === 'object') {
   return new Map(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
  }
  // Legacy format: string[] — treat each key as highlighted with a default color
  if (Array.isArray(parsed)) {
   return new Map((parsed as unknown[]).map((k) => [String(k), '#fde68a']));
  }
  return new Map();
 } catch {
  return new Map();
 }
}
export const defaultPdfColVisibility: PdfColVisibility = {
 created: true,
 counterparty: false,
 direction: false,
 type: false,
 amount: true,
 currency: false,
 exchangeRate: true,
 commission: true,
 netChange: true,
 runningBalance: true,
 description: true,
};

export const defaultTransactionColumnVisibility: TransactionColumnVisibility = {
 created: true,
 description: true,
 accountFrom: true,
 accountTo: true,
 amount: true,
 exchangeRate: true,
 charges: true,
 commission: true,
};

export const defaultTransactionTableSettings: TransactionTableSettings = {
 columns: defaultTransactionColumnVisibility,
 dateFormat: 'full',
};
export function getStoredPdfCols(accountId: number): PdfColVisibility {
 if (typeof window === 'undefined') return defaultPdfColVisibility;
 try {
  const raw = window.localStorage.getItem(pdfColsStorageKeyPrefix + accountId);
  if (!raw) return defaultPdfColVisibility;
  return { ...defaultPdfColVisibility, ...JSON.parse(raw) };
 } catch {
  return defaultPdfColVisibility;
 }
}

export function savePdfCols(accountId: number, cols: PdfColVisibility) {
 try {
  window.localStorage.setItem(pdfColsStorageKeyPrefix + accountId, JSON.stringify(cols));
 } catch {
  /* ignore */
 }
}

export function getStoredPdfDateRange(accountId: number): { fromDate: string; toDate: string } | null {
 if (typeof window === 'undefined') return null;
 try {
  const raw = window.localStorage.getItem(pdfDateRangeStorageKeyPrefix + accountId);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (typeof parsed?.fromDate === 'string' && typeof parsed?.toDate === 'string') {
   return { fromDate: parsed.fromDate, toDate: parsed.toDate };
  }
  return null;
 } catch {
  return null;
 }
}

export function savePdfDateRange(accountId: number, fromDate: string, toDate: string) {
 try {
  window.localStorage.setItem(pdfDateRangeStorageKeyPrefix + accountId, JSON.stringify({ fromDate, toDate }));
 } catch {
  /* ignore */
 }
}

function getStoredTableSettings(storageKey: string): TransactionTableSettings {
 if (typeof window === 'undefined') return defaultTransactionTableSettings;
 try {
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return defaultTransactionTableSettings;
  const parsed = JSON.parse(raw);
  return {
   ...defaultTransactionTableSettings,
   ...parsed,
   columns: { ...defaultTransactionColumnVisibility, ...(parsed?.columns ?? {}) },
  };
 } catch {
  return defaultTransactionTableSettings;
 }
}

function saveTableSettings(storageKey: string, settings: TransactionTableSettings) {
 try {
  window.localStorage.setItem(storageKey, JSON.stringify(settings));
 } catch {
  /* ignore */
 }
}

export function getStoredTransactionTableSettings(): TransactionTableSettings {
 return getStoredTableSettings(transactionTableSettingsStorageKey);
}

export function saveTransactionTableSettings(settings: TransactionTableSettings) {
 saveTableSettings(transactionTableSettingsStorageKey, settings);
}

export function getStoredArchiveTableSettings(): TransactionTableSettings {
 return getStoredTableSettings(archiveTableSettingsStorageKey);
}

export function saveArchiveTableSettings(settings: TransactionTableSettings) {
 saveTableSettings(archiveTableSettingsStorageKey, settings);
}
export const defaultPdfSettings: PdfSettings = {
 decimals: 2,
 fontFamily: 'Arial, Helvetica, sans-serif',
 fontSize: 12,
 headFontSize: 13,
 companyName: '',
 showCompanyName: false,
 dateFormat: 'full',
 showPreBalance: true,
 showMetaClient: true,
 showMetaCurrency: true,
 showMetaPeriod: true,
 showFooter: true,
 showGeneratedOn: true,
 showCurrencySymbol: true,
 highlightNetChange: true,
};
export function getStoredPdfSettings(): PdfSettings {
 if (typeof window === 'undefined') return defaultPdfSettings;
 try {
  const raw = window.localStorage.getItem(pdfSettingsStorageKey);
  if (!raw) return defaultPdfSettings;
  const parsed = JSON.parse(raw);
  return { ...defaultPdfSettings, ...parsed };
 } catch {
  return defaultPdfSettings;
 }
}
// Workspace-wide exchange (صرف) rules. Shared across members via sharedTableSettings so the
// tolerance limit is consistent for everyone in the workspace.
export const exchangeSettingsStorageKey = 'arkam:exchange-settings';
export const defaultExchangeSettings: ExchangeSettings = {
 tolerance: 5,
};
export function getStoredExchangeSettings(): ExchangeSettings {
 if (typeof window === 'undefined') return defaultExchangeSettings;
 try {
  const raw = window.localStorage.getItem(exchangeSettingsStorageKey);
  if (!raw) return defaultExchangeSettings;
  const parsed = JSON.parse(raw);
  const tolerance = Number(parsed?.tolerance);
  return { tolerance: Number.isFinite(tolerance) && tolerance >= 0 ? tolerance : defaultExchangeSettings.tolerance };
 } catch {
  return defaultExchangeSettings;
 }
}
export function saveExchangeSettings(settings: ExchangeSettings) {
 if (typeof window === 'undefined') return;
 try {
  window.localStorage.setItem(exchangeSettingsStorageKey, JSON.stringify(settings));
 } catch {
  /* ignore quota / privacy-mode errors */
 }
}
// Description strings the user has dismissed from the transaction description
// autocomplete dropdown (via its per-suggestion "x"). Suggestions are derived live
// from past transactions, so exclusions are tracked separately rather than deleting
// anything; stored lowercased/trimmed since that's how suggestions are matched/deduped.
export const descriptionSuggestionExclusionsStorageKey = 'arkam:tx-description-suggestion-exclusions';

export function getStoredDescriptionSuggestionExclusions(): Set<string> {
 if (typeof window === 'undefined') return new Set();
 try {
  const raw = window.localStorage.getItem(descriptionSuggestionExclusionsStorageKey);
  const parsed = raw ? JSON.parse(raw) : [];
  return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
 } catch {
  return new Set();
 }
}

export function saveDescriptionSuggestionExclusions(excluded: Set<string>) {
 try {
  window.localStorage.setItem(descriptionSuggestionExclusionsStorageKey, JSON.stringify(Array.from(excluded)));
 } catch {
  /* ignore quota / privacy-mode errors */
 }
}

export function getStoredLedgerColumnOrder(clientId: number | null | undefined): LedgerColumnKey[] {
 if (typeof window === 'undefined') return defaultLedgerColumnOrder;
 try {
  // Per-client key first; fall back to the legacy global key so existing orders aren't lost.
  const raw = (clientId ? window.localStorage.getItem(ledgerColumnOrderStorageKeyPrefix + clientId) : null) ?? window.localStorage.getItem(legacyLedgerColumnOrderStorageKey);
  if (!raw) return defaultLedgerColumnOrder;
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length !== defaultLedgerColumnOrder.length) return defaultLedgerColumnOrder;
  const normalized = parsed.filter((c): c is LedgerColumnKey => defaultLedgerColumnOrder.includes(c as LedgerColumnKey));
  if (normalized.length !== defaultLedgerColumnOrder.length) return defaultLedgerColumnOrder;
  if (new Set(normalized).size !== defaultLedgerColumnOrder.length) return defaultLedgerColumnOrder;
  return normalized;
 } catch {
  return defaultLedgerColumnOrder;
 }
}
