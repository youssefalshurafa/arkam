import {
 ledgerColumnVisibilityStorageKeyPrefix,
 ledgerColumnOrderStorageKeyPrefix,
 ledgerSettingsStorageKeyPrefix,
 legacyLedgerColumnOrderStorageKey,
 transactionTableSettingsStorageKey,
 archiveTableSettingsStorageKey,
 txRowSettingsStorageKey,
 txHighlightsStorageKey,
 exchangeSettingsStorageKey,
 themeStorageKey,
 clientsOrgOrderStorageKey,
 liveRatesIntervalStorageKey,
 harvestSortDirStorageKey,
 pdfSettingsStorageKey,
 aiSettingsStorageKey,
 descriptionSuggestionExclusionsStorageKey,
 ledgerFilterStorageKey,
 txFilterStorageKey,
 archiveFilterStorageKey,
 ledgerLastAccountStorageKeyPrefix,
 pdfColsStorageKeyPrefix,
 pdfDateRangeStorageKeyPrefix,
 ledgerHighlightsStorageKeyPrefix,
} from '@/shared/lib/localStorage';

// The language preference isn't stored under the shared `arkam:` prefix (legacy key
// name), so it's spelled out here rather than imported.
const languageStorageKey = 'arkam_language';
const sidebarCollapsedStorageKey = 'arkam:sidebar-collapsed';
const ledgerPageSizeStorageKey = 'arkam:ledger-page-size';

// The localStorage entries that make up the shareable "table settings": the ledger's
// per-client column visibility / order / display settings, plus the workspace-wide
// transaction/archive table settings and row settings. Row highlights and personal marks
// are intentionally excluded — those are per-user data, not layout settings.
const SHARED_KEY_PREFIXES = [ledgerColumnVisibilityStorageKeyPrefix, ledgerColumnOrderStorageKeyPrefix, ledgerSettingsStorageKeyPrefix];
const SHARED_EXACT_KEYS = [legacyLedgerColumnOrderStorageKey, transactionTableSettingsStorageKey, archiveTableSettingsStorageKey, txRowSettingsStorageKey, exchangeSettingsStorageKey];

function isSharedKey(key: string): boolean {
 return SHARED_EXACT_KEYS.includes(key) || SHARED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

// Per-user-only keys: personal device/browser preferences and private data (row
// highlights, filter bars, theme, etc). These ride along with the always-on per-user
// settings sync (so they follow the user to another device) but are deliberately kept
// OUT of isSharedKey/SHARED_* — the owner's workspace-wide shared snapshot must never
// carry one user's personal settings to everyone else.
//
// Table zoom (tableZoomStorageKeyPrefix) is deliberately absent from BOTH lists below:
// it's a pure per-device viewing preference (a laptop and a phone want different zoom
// levels for the same wide table), so it must never round-trip through the server at
// all — see getStoredTableZoom/saveTableZoom in localStorage.ts, which read/write
// window.localStorage directly and are never wrapped by snapshotUserSettings/
// applyUserSettings below.
const USER_ONLY_EXACT_KEYS = [
 txHighlightsStorageKey,
 themeStorageKey,
 languageStorageKey,
 sidebarCollapsedStorageKey,
 ledgerPageSizeStorageKey,
 clientsOrgOrderStorageKey,
 liveRatesIntervalStorageKey,
 harvestSortDirStorageKey,
 pdfSettingsStorageKey,
 aiSettingsStorageKey,
 descriptionSuggestionExclusionsStorageKey,
 ledgerFilterStorageKey,
 txFilterStorageKey,
 archiveFilterStorageKey,
];
const USER_ONLY_KEY_PREFIXES = [ledgerLastAccountStorageKeyPrefix, pdfColsStorageKeyPrefix, pdfDateRangeStorageKeyPrefix, ledgerHighlightsStorageKeyPrefix];

function isUserOnlyKey(key: string): boolean {
 return USER_ONLY_EXACT_KEYS.includes(key) || USER_ONLY_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

// Reads the current shareable settings out of localStorage into a plain map. This is
// what an owner pushes as the workspace-wide shared snapshot.
export function snapshotSharedSettings(): Record<string, string> {
 const out: Record<string, string> = {};
 if (typeof window === 'undefined') return out;
 try {
  for (let i = 0; i < window.localStorage.length; i += 1) {
   const key = window.localStorage.key(i);
   if (!key || !isSharedKey(key)) continue;
   const value = window.localStorage.getItem(key);
   if (value != null) out[key] = value;
  }
 } catch {
  /* ignore */
 }
 return out;
}

// Writes a shared snapshot into localStorage (merge — a user's settings for clients the
// owner never configured are left untouched). Callers then re-hydrate the live stores.
export function applySharedSettings(settings: Record<string, string>) {
 if (typeof window === 'undefined' || !settings) return;
 try {
  for (const [key, value] of Object.entries(settings)) {
   if (isSharedKey(key) && typeof value === 'string') window.localStorage.setItem(key, value);
  }
 } catch {
  /* ignore quota / privacy-mode errors */
 }
}

// Per-user snapshot = the shareable layout settings PLUS this user's private settings
// (highlights, filters, theme, etc — see USER_ONLY_*). Used only by the always-on
// per-user sync, so these follow a user across their own devices without ever entering
// the owner's shared workspace snapshot.
export function snapshotUserSettings(): Record<string, string> {
 const out: Record<string, string> = {};
 if (typeof window === 'undefined') return out;
 try {
  for (let i = 0; i < window.localStorage.length; i += 1) {
   const key = window.localStorage.key(i);
   if (!key || !(isSharedKey(key) || isUserOnlyKey(key))) continue;
   const value = window.localStorage.getItem(key);
   if (value != null) out[key] = value;
  }
 } catch {
  /* ignore */
 }
 return out;
}

// Applies a per-user snapshot: the shared layout keys plus this user's private highlights.
export function applyUserSettings(settings: Record<string, string>) {
 applySharedSettings(settings);
 if (typeof window === 'undefined' || !settings) return;
 try {
  for (const [key, value] of Object.entries(settings)) {
   if (isUserOnlyKey(key) && typeof value === 'string') window.localStorage.setItem(key, value);
  }
 } catch {
  /* ignore quota / privacy-mode errors */
 }
}

// Stable string form of a snapshot, so an owner-push effect can skip re-pushing when
// nothing shareable actually changed (e.g. merely switching the open client).
export function serializeSnapshot(snapshot: Record<string, string>): string {
 return JSON.stringify(Object.keys(snapshot).sort().map((k) => [k, snapshot[k]]));
}

// Remembers the last shared version this browser has applied, so each client re-applies
// only when the owner bumps the version (later local edits are the user's "override").
const appliedVersionStorageKey = 'arkam:shared-settings-applied-version';

export function getAppliedSharedVersion(): number {
 if (typeof window === 'undefined') return -1;
 try {
  const raw = window.localStorage.getItem(appliedVersionStorageKey);
  const n = raw != null ? Number(raw) : -1;
  return Number.isFinite(n) ? n : -1;
 } catch {
  return -1;
 }
}

export function setAppliedSharedVersion(version: number) {
 try {
  window.localStorage.setItem(appliedVersionStorageKey, String(version));
 } catch {
  /* ignore */
 }
}
