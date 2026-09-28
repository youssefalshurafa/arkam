import type { DraftHistory } from '@/shared/hooks/useDraftHistory';
import { useActionHistoryStore } from '@/shared/store/actionHistoryStore';

/**
 * One undo/redo pair for a toolbar, over two histories: the page's unsaved-draft history (typing
 * in an open row) and the app-wide history of saved changes — edits, creates and deletes (see
 * actionHistoryStore). Drafts take priority, being the most recent thing the user touched; once
 * they are exhausted the buttons step through saved changes.
 */
export function useCombinedHistory(draftHistory: DraftHistory): DraftHistory {
 const canUndoSaved = useActionHistoryStore((s) => s.past.length > 0 && !s.busy);
 const canRedoSaved = useActionHistoryStore((s) => s.future.length > 0 && !s.busy);
 const undoSaved = useActionHistoryStore((s) => s.undo);
 const redoSaved = useActionHistoryStore((s) => s.redo);

 return {
  record: draftHistory.record,
  reset: draftHistory.reset,
  canUndo: draftHistory.canUndo || canUndoSaved,
  canRedo: draftHistory.canRedo || canRedoSaved,
  undo: () => {
   if (draftHistory.canUndo) draftHistory.undo();
   else void undoSaved();
  },
  redo: () => {
   if (draftHistory.canRedo) draftHistory.redo();
   else void redoSaved();
  },
 };
}
