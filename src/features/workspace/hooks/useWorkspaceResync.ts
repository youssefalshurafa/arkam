'use client';

import { useCallback, useEffect, useRef } from 'react';
import { pendingWriteCount } from '@/lib/pendingWrites';
import { useWorkspaceActions } from '@/features/workspace/hooks/useWorkspaceActions';

// How long to wait after the last optimistic write before reconciling with the server.
const WORKSPACE_RESYNC_DELAY_MS = 1_500;

// Module-level, not a ref per hook instance: the ledger, the transactions form and the table
// editor all save in the background, and a timer each would mean one full snapshot refetch per
// hook instead of one for the lot.
let resyncTimer: ReturnType<typeof setTimeout> | null = null;
// Set when a resync is scheduled (always from an event handler, never during render) so whichever
// mount armed the timer is the one whose refetch fires.
let runResync: (() => void) | null = null;

/**
 * Arms the debounce — and re-arms rather than fetching while any write is still on the wire.
 *
 * A snapshot that resolves over an outstanding write predates it, so applying it paints the
 * server's old values back over what the user just typed; the row then jumps a second time when
 * the write finally lands. Waiting costs nothing: this refetch exists precisely to reconcile
 * AFTER the writes settle, and the counter drops on rejection as well as success, so a failed
 * request can't hold it off forever.
 */
function arm() {
 if (resyncTimer) clearTimeout(resyncTimer);
 resyncTimer = setTimeout(() => {
  resyncTimer = null;
  if (pendingWriteCount() > 0) {
   arm();
   return;
  }
  runResync?.();
 }, WORKSPACE_RESYNC_DELAY_MS);
}

/**
 * Reconciling refetch after optimistic writes, coalesced.
 *
 * A full workspace invalidation reads every organization, client, account and transaction in one
 * round-trip — far too heavy to run once per saved row: editing a column with the arrow keys
 * fired one per keystroke. The optimistic patch already shows the right values, so this exists
 * only to pick up anything the server decided differently; running it once after the user stops
 * is enough, and keeps a run of edits from queueing a reload behind each one.
 *
 * Silent by design — nobody is waiting on it, so it must not light the loading indicator.
 */
export function useWorkspaceResync() {
 const { invalidateSilently } = useWorkspaceActions();
 // Kept current in an effect rather than during render, so the timer always fires the refetch
 // for the workspace that is actually mounted now.
 const latestInvalidate = useRef(invalidateSilently);
 useEffect(() => {
  latestInvalidate.current = invalidateSilently;
 }, [invalidateSilently]);

 const scheduleWorkspaceResync = useCallback(() => {
  runResync = () => latestInvalidate.current();
  arm();
 }, []);

 /** Runs any pending resync now — before an export or import, which must not read stale data. */
 const flushWorkspaceResync = useCallback(() => {
  if (!resyncTimer) return;
  clearTimeout(resyncTimer);
  resyncTimer = null;
  runResync?.();
 }, []);

 return { scheduleWorkspaceResync, flushWorkspaceResync };
}
