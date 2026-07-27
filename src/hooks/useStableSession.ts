'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession as useNextAuthSession, getSession } from 'next-auth/react';
import type { Session } from 'next-auth';

// Backoff between verification retries while the network reconnects after wake.
const RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000];

/**
 * Drop-in replacement for next-auth's useSession that guards against a mobile bug:
 * next-auth's default refetchOnWindowFocus re-checks the session whenever the tab
 * regains focus/visibility (e.g. returning to the browser after the phone/PC was
 * asleep or hibernating). If that background fetch fails — which happens easily
 * right as a device wakes and is still reconnecting to a network — next-auth treats
 * the failure as "no session" and flips status straight to 'unauthenticated', even
 * though the session cookie is still perfectly valid. Callers gating on status (the
 * root page showing the public homepage instead of the signed-in app, the admin
 * pages redirecting to /login) then boot an actually-still-logged-in user out. A
 * manual refresh always "fixes" it because a fresh navigation retries the fetch
 * cleanly — this hook automates that same re-check instead of surfacing the
 * signed-out UI first.
 *
 * We can't use next-auth's own `update()` for the re-check: it bails out as a no-op
 * whenever `session` is already null (see next-auth/react's useSession), which is
 * always the case by the time status has flipped to 'unauthenticated' — so it can
 * never actually recover. Instead we call the standalone `getSession()` (an
 * independent fetch with no such guard) directly, with retries, and hold our own
 * verified copy until next-auth's internal state catches up on its own.
 *
 * Only kicks in for a session that was previously authenticated in this tab; a
 * genuine first-load signed-out visitor sees 'unauthenticated' immediately as before.
 */
export function useStableSession() {
 const session = useNextAuthSession();
 const { status } = session;
 const wasAuthenticated = useRef(false);
 // undefined = not verifying / no result yet, null = confirmed signed out, Session = recovered
 const [recovered, setRecovered] = useState<Session | null | undefined>(undefined);

 useEffect(() => {
  if (status === 'authenticated' && recovered !== undefined) setRecovered(undefined);
  if (status === 'authenticated') wasAuthenticated.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [status]);

 useEffect(() => {
  if (status !== 'unauthenticated' || !wasAuthenticated.current) return;
  let cancelled = false;
  setRecovered(undefined);
  (async () => {
   for (const delay of RETRY_DELAYS_MS) {
    if (cancelled) return;
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (cancelled) return;
    const fresh = await getSession().catch(() => null);
    if (cancelled) return;
    if (fresh) {
     setRecovered(fresh);
     return;
    }
   }
   if (!cancelled) setRecovered(null);
  })();
  return () => {
   cancelled = true;
  };
 }, [status]);

 if (status === 'unauthenticated' && wasAuthenticated.current) {
  if (recovered === undefined) return { ...session, status: 'loading' as const };
  if (recovered) return { ...session, data: recovered, status: 'authenticated' as const };
 }
 return session;
}
