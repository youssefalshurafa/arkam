import { create } from 'zustand';
import { accountingApi } from '@/lib/accountingApi';
import { useAppStatusStore } from '@/shared/store/appStatusStore';

/**
 * One already-SAVED change to workspace data — an edit, a create or a delete — reversible and
 * replayable by re-issuing server calls. Distinct from `DraftHistory` (useDraftHistory), which
 * only rewinds unsaved keystrokes in a row that is still open.
 */
export type HistoryAction = {
 undo: () => Promise<void>;
 redo: () => Promise<void>;
};

type Entry = HistoryAction & { workspaceId: string | null };

type ActionHistoryStore = {
 past: Entry[];
 future: Entry[];
 busy: boolean;
 /** Records a change that just happened. Clears the redo side, like any editor. */
 push: (action: HistoryAction) => HistoryAction;
 /** Takes back an entry for a change that turned out not to have landed (a failed optimistic write). */
 drop: (action: HistoryAction) => void;
 undo: () => Promise<void>;
 redo: () => Promise<void>;
 /**
  * Undoes one specific entry — the delete toast's Undo button. Goes through the stack rather
  * than around it, so the toolbar and the toast can never both undo the same change.
  */
 undoAction: (action: HistoryAction) => Promise<void>;
};

const MAX_ENTRIES = 30;

/**
 * App-wide undo/redo for saved changes, shared by the ledger's and the Transactions page's
 * toolbars — one history, so "undo" always means "the last thing I did", whichever page it was
 * done on. Module-level (zustand) rather than per-hook for exactly that reason.
 *
 * A step whose undo or redo fails is dropped with the error shown, rather than left on top of
 * the stack: the failure is almost always permanent (the row was deleted or purged since, or the
 * change was already reversed from the Trash), and a stuck entry would block every older step
 * beneath it.
 */
export const useActionHistoryStore = create<ActionHistoryStore>((set, get) => {
 // Ids in an entry belong to the workspace it was recorded in; after a switch they would point
 // at another workspace's rows (or nothing), so a stale history is discarded, not replayed.
 const currentWorkspace = () => accountingApi.getActiveWorkspaceId();
 const discardIfStale = (entry: Entry | undefined) => {
  if (entry && entry.workspaceId !== currentWorkspace()) {
   set({ past: [], future: [] });
   return true;
  }
  return false;
 };
 const report = (error: unknown) => {
  useAppStatusStore.getState().setError(error instanceof Error ? error.message : String(error));
 };

 async function run(entry: Entry, direction: 'undo' | 'redo', fromStack: 'past' | 'future') {
  set({ busy: true });
  try {
   await entry[direction]();
   set((state) => {
    const source = state[fromStack].filter((e) => e !== entry);
    const target = fromStack === 'past' ? 'future' : 'past';
    return { [fromStack]: source, [target]: [...state[target], entry], busy: false } as Partial<ActionHistoryStore>;
   });
  } catch (error) {
   report(error);
   set((state) => ({ [fromStack]: state[fromStack].filter((e) => e !== entry), busy: false }) as Partial<ActionHistoryStore>);
  }
 }

 return {
  past: [],
  future: [],
  busy: false,
  push: (action) => {
   const entry: Entry = Object.assign(action, { workspaceId: currentWorkspace() });
   set((state) => ({
    past: [...state.past.filter((e) => e.workspaceId === entry.workspaceId), entry].slice(-MAX_ENTRIES),
    future: [],
   }));
   return entry;
  },
  drop: (action) => {
   set((state) => ({ past: state.past.filter((e) => e !== action), future: state.future.filter((e) => e !== action) }));
  },
  undo: async () => {
   const { past, busy } = get();
   const entry = past[past.length - 1];
   if (!entry || busy || discardIfStale(entry)) return;
   await run(entry, 'undo', 'past');
  },
  redo: async () => {
   const { future, busy } = get();
   const entry = future[future.length - 1];
   if (!entry || busy || discardIfStale(entry)) return;
   await run(entry, 'redo', 'future');
  },
  undoAction: async (action) => {
   const entry = get().past.find((e) => e === action);
   if (!entry || get().busy || discardIfStale(entry)) return;
   await run(entry, 'undo', 'past');
  },
 };
});
