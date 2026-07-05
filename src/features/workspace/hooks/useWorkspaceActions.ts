'use client';

import { useSession } from 'next-auth/react';
import { useAppStatusStore } from '@/shared/store/appStatusStore';
import { useWorkspaceCache } from './useWorkspaceData';

/**
 * Session-scoped workspace mutation helpers for feature components. Bundles the
 * cache setters + `invalidate` (from useWorkspaceCache, keyed to the signed-in
 * user, mirroring how the page derives sessionUserId) with the shared error
 * setter from appStatusStore. Lets a feature component run its own accountingApi
 * mutations and reflect the result without onReload/onError/setX props plumbed
 * down from the page.
 */
export function useWorkspaceActions() {
 const { data: authSession } = useSession();
 const sessionUserId = authSession?.user?.id ?? null;
 const { invalidate, setters } = useWorkspaceCache(sessionUserId);
 const setError = useAppStatusStore((s) => s.setError);
 return { invalidate, setters, setError };
}
