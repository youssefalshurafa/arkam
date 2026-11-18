'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { accountingApi } from '@/lib/accountingApi';
import { queryKeys } from '@/lib/queryClient';
import { useStableSession } from '@/hooks/useStableSession';
import { useAppStatusStore } from '@/shared/store/appStatusStore';
import type { StickyNote, StickyNoteColor } from '@/shared/types';

const EMPTY: StickyNote[] = [];

/**
 * The workspace's shared sticky notes, plus optimistic add/update/remove.
 *
 * Its own small query rather than part of the bundled workspace snapshot: notes have nothing to
 * do with balances, and typing into one must never trigger the snapshot's big refetch. Polled
 * once a minute so a note a teammate adds shows up on the Home page without a reload.
 *
 * Edits are optimistic and the local copy stays authoritative: a save's response only refreshes
 * the updated-at/by metadata, never the text, so an older save that answers late can't roll back
 * what the user has typed since.
 */
export function useStickyNotes(failedMessage: string) {
 const { data: authSession } = useStableSession();
 const userId = authSession?.user?.id ?? null;
 // Same source accountingApi.request() uses for the x-workspace-id header (see useWorkspaceActions).
 const workspaceId = accountingApi.getActiveWorkspaceId();
 const queryKey = queryKeys.stickyNotes(userId, workspaceId);
 const queryClient = useQueryClient();
 const setError = useAppStatusStore((s) => s.setError);

 const query = useQuery({
  queryKey,
  queryFn: () => accountingApi.listStickyNotes(),
  enabled: Boolean(userId && workspaceId),
  refetchInterval: 60_000,
 });

 const patch = (fn: (notes: StickyNote[]) => StickyNote[]) => queryClient.setQueryData<StickyNote[]>(queryKey, (current) => fn(current ?? []));

 const fail = (error: unknown) => {
  setError(error instanceof Error && error.message ? error.message : failedMessage);
  void queryClient.invalidateQueries({ queryKey });
 };

 async function addNote(color: StickyNoteColor): Promise<StickyNote | null> {
  try {
   const note = await accountingApi.createStickyNote({ color });
   patch((notes) => [...notes.filter((n) => n.id !== note.id), note]);
   return note;
  } catch (error) {
   fail(error);
   return null;
  }
 }

 async function updateNote(id: number, changes: { content?: string; color?: StickyNoteColor }) {
  // A poll landing mid-edit would otherwise overwrite the optimistic value with the old one.
  await queryClient.cancelQueries({ queryKey });
  patch((notes) => notes.map((n) => (n.id === id ? { ...n, ...changes } : n)));
  try {
   const saved = await accountingApi.updateStickyNote({ id, ...changes });
   patch((notes) => notes.map((n) => (n.id === id ? { ...n, updatedAt: saved.updatedAt, updatedBy: saved.updatedBy } : n)));
  } catch (error) {
   fail(error);
  }
 }

 async function removeNote(id: number) {
  await queryClient.cancelQueries({ queryKey });
  patch((notes) => notes.filter((n) => n.id !== id));
  try {
   await accountingApi.deleteStickyNote(id);
  } catch (error) {
   fail(error);
  }
 }

 return { notes: query.data ?? EMPTY, isLoading: query.isLoading, addNote, updateNote, removeNote };
}
