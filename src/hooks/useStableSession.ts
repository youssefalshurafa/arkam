'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession as useNextAuthSession } from 'next-auth/react';

/**
 * Drop-in replacement for next-auth's useSession that guards against a mobile bug:
 * next-auth's default refetchOnWindowFocus re-checks the session whenever the tab
 * regains focus/visibility (e.g. returning to the browser after the phone was
 * backgrounded). If that background fetch fails — which happens easily right as a
 * phone wakes from sleep and is still reconnecting to a network — next-auth treats
 * the failure as "no session" and flips status straight to 'unauthenticated', even
 * though the session cookie is still perfectly valid. Callers gating on status (the
 * root page showing the public homepage instead of the signed-in app, the admin
 * pages redirecting to /login) then boot an actually-still-logged-in user out. A
 * manual refresh always "fixes" it because a fresh navigation retries the fetch
 * cleanly — this hook automates that same re-check instead of surfacing the
 * signed-out UI first.
 *
 * Only kicks in for a session that was previously authenticated in this tab; a
 * genuine first-load signed-out visitor sees 'unauthenticated' immediately as before.
 */
export function useStableSession() {
 const session = useNextAuthSession();
 const { status, update } = session;
 const wasAuthenticated = useRef(false);
 const [rechecking, setRechecking] = useState(false);

 useEffect(() => {
  if (status === 'authenticated') wasAuthenticated.current = true;
 }, [status]);

 useEffect(() => {
  if (status !== 'unauthenticated' || !wasAuthenticated.current) return;
  let cancelled = false;
  setRechecking(true);
  // update() forces next-auth to refetch and, if the session is actually still valid,
  // commits it back into the shared context — status flips back to 'authenticated' on
  // its own via re-render, no reload needed.
  void update().finally(() => {
   if (!cancelled) setRechecking(false);
  });
  return () => {
   cancelled = true;
  };
  // Re-run only when status flips to unauthenticated, not on every `update` identity change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [status]);

 if (status === 'unauthenticated' && rechecking) {
  return { ...session, status: 'loading' as const };
 }
 return session;
}
