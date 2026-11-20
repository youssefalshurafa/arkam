'use client';

import { signOut } from 'next-auth/react';
import { purgeSessionDataCaches } from '@/shared/lib/cacheOwner';

/**
 * The one way the app signs a user out. Purges this account's cached data first, then ends
 * the session WITHOUT next-auth's client-side redirect, and finally does a full page load.
 * The hard navigation matters: it throws away the in-memory React Query cache and the
 * SessionProvider's last-known session, which a soft router transition would carry over to
 * whoever signs in next on this tab.
 */
export async function signOutCleanly(destination = '/login'): Promise<void> {
 purgeSessionDataCaches();
 try {
  await signOut({ redirect: false });
 } finally {
  window.location.assign(destination);
 }
}
