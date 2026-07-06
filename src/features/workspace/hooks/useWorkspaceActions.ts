'use client';

import { useSession } from 'next-auth/react';
import { accountingApi } from '@/lib/accountingApi';
import { useAppStatusStore } from '@/shared/store/appStatusStore';
import { useWorkspaceCache } from './useWorkspaceData';

/**
 * Session-scoped workspace mutation helpers for feature components. Bundles the
 * cache setters + `invalidate` (from useWorkspaceCache, keyed to the signed-in
 * user + active workspace, mirroring how the page derives sessionUserId/
 * activeWorkspaceId) with the shared error setter from appStatusStore. Lets a
 * feature component run its own accountingApi mutations and reflect the result
 * without onReload/onError/setX props plumbed down from the page.
 */
export function useWorkspaceActions() {
 const { data: authSession } = useSession();
 const sessionUserId = authSession?.user?.id ?? null;
 // Read directly from storage rather than via page state: it's exactly what
 // accountingApi.request() sends as the x-workspace-id header, so the cache
 // slot this hook reads/writes always matches what was actually fetched.
 const workspaceId = accountingApi.getActiveWorkspaceId();
 const { invalidate, setters } = useWorkspaceCache(sessionUserId, workspaceId);
 const setError = useAppStatusStore((s) => s.setError);
 return { invalidate, setters, setError };
}
