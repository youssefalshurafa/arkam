import {
 ledgerColumnVisibilityStorageKeyPrefix,
 ledgerColumnOrderStorageKeyPrefix,
 ledgerSettingsStorageKeyPrefix,
 legacyLedgerColumnOrderStorageKey,
 transactionTableSettingsStorageKey,
 archiveTableSettingsStorageKey,
 txRowSettingsStorageKey,
 txHighlightsStorageKey,
} from '@/shared/lib/localStorage';

// The localStorage entries that make up the shareable "table settings": the ledger's
// per-client column visibility / order / display settings, plus the workspace-wide
// transaction/archive table settings and row settings. Row highlights and personal marks
// are intentionally excluded — those are per-user data, not layout settings.
const SHARED_KEY_PREFIXES = [ledgerColumnVisibilityStorageKeyPrefix, ledgerColumnOrderStorageKeyPrefix, ledgerSettingsStorageKeyPrefix];
const SHARED_EXACT_KEYS = [legacyLedgerColumnOrderStorageKey, transactionTableSettingsStorageKey, archiveTableSettingsStorageKey, txRowSettingsStorageKey];

function isSharedKey(key: string): boolean {
 return SHARED_EXACT_KEYS.includes(key) || SHARED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

// Per-user-only keys: the user's private row highlights. These ride along with the
// always-on per-user settings sync (so a user's highlights follow them to another
// device) but are deliberately kept OUT of isSharedKey — the owner's workspace-wide
// shared snapshot must never carry one user's personal highlights to everyone else.
const USER_ONLY_EXACT_KEYS = [txHighlightsStorageKey];

function isUserOnlyKey(key: string): boolean {
 return USER_ONLY_EXACT_KEYS.includes(key);
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

// Per-user snapshot = the shareable layout settings PLUS this user's private highlights.
// Used only by the always-on per-user sync, so highlights persist across a user's own
// devices without ever entering the owner's shared workspace snapshot.
export function snapshotUserSettings(): Record<string, string> {
 const out = snapshotSharedSettings();
 if (typeof window === 'undefined') return out;
 try {
  for (const key of USER_ONLY_EXACT_KEYS) {
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
