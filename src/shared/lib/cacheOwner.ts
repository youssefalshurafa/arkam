// Browser-local isolation guard.
//
// Every cache this app keeps in the browser — the workspace data snapshot
// (`arkam:data-cache` in sessionStorage), the active workspace id
// (`arkam.activeWorkspaceId`), and all `arkam:*` UI preferences — is scoped to the
// *browser*, not to the signed-in account. Server auth still blocks cross-tenant
// *fetches* (membership is checked on every request), but if a different user
// signs in on the same browser these caches would briefly render the previous
// user's data before the first refetch. For a bookkeeping app that is
// unacceptable, so we purge them the moment the signed-in user changes.

const CACHE_OWNER_KEY = 'arkam:cache-owner';

/** True for keys this app owns in browser storage (both `arkam:` and `arkam.`). */
function isAppKey(key: string | null): key is string {
 return !!key && (key.startsWith('arkam:') || key.startsWith('arkam.')) && key !== CACHE_OWNER_KEY;
}

function purgeStorage(storage: Storage) {
 const toRemove: string[] = [];
 for (let i = 0; i < storage.length; i += 1) {
  const key = storage.key(i);
  if (isAppKey(key)) toRemove.push(key);
 }
 toRemove.forEach((key) => storage.removeItem(key));
}

/** Removes every app-owned cache/preference from local + session storage. */
export function purgeUserScopedCaches(): void {
 if (typeof window === 'undefined') return;
 try {
  purgeStorage(window.localStorage);
  purgeStorage(window.sessionStorage);
 } catch {
  /* ignore storage / privacy-mode errors */
 }
}

/**
 * Ensures the browser's caches belong to `userId`. If the recorded owner differs
 * (a different account signed in on this browser) or is absent, purges all
 * app-owned caches first and records the new owner. Returns true when a purge
 * happened, so the caller can also clear any in-memory (React Query) cache.
 * Safe and cheap to call on every mount.
 */
export function ensureCacheOwner(userId: string | null | undefined): boolean {
 if (typeof window === 'undefined' || !userId) return false;
 try {
  const currentOwner = window.localStorage.getItem(CACHE_OWNER_KEY);
  if (currentOwner === userId) return false;
  purgeUserScopedCaches();
  window.localStorage.setItem(CACHE_OWNER_KEY, userId);
  return true;
 } catch {
  return false;
 }
}
