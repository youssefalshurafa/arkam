import { accountingApi, type TrashRestoreResult } from '@/lib/accountingApi';
import { resolveTransactionIds } from '@/lib/pendingTransactionWrites';
import { useActionHistoryStore, type HistoryAction } from '@/shared/store/actionHistoryStore';
import { useAppStatusStore } from '@/shared/store/appStatusStore';
import { describeBlockedRestore } from '@/features/trash/utils/trash';

type Translate = (key: string, params?: Record<string, string | number>) => string;

type Common = {
 // The reconciliation decision the user made for the original change. Undo and redo put rows
 // back exactly where that change moved them, so they need the same permission — and no more.
 override: boolean;
 t: Translate;
 reload: () => Promise<unknown> | void;
};

/**
 * The ~6s Undo toast for a change already on the history. Its button undoes that exact entry
 * through the store, so the toolbar's undo can't then undo it a second time.
 */
export function offerUndoFor(entry: HistoryAction, message: string): void {
 useAppStatusStore.getState().showUndo(message, () => void useActionHistoryStore.getState().undoAction(entry));
}

/** Takes back the entry for an optimistic create whose write never landed. */
export function dropHistoryAction(entry: HistoryAction): void {
 useActionHistoryStore.getState().drop(entry);
}

// A restore that brought nothing back (its account was deleted since, say) has not undone
// anything — report it as a failure so the step comes off the stack with the reason shown.
function assertRestored(result: TrashRestoreResult, t: Translate) {
 if (result.restored.transactions === 0 && result.blockedCount > 0) {
  throw new Error(describeBlockedRestore(result, t));
 }
}

/**
 * Records a transaction create on the shared undo/redo history. Undo moves the row to the Trash;
 * redo restores it from there — the same row, same id, so anything attached to it since (a
 * reconciliation mark, an edit history) survives the round trip.
 *
 * `realId` is the create's own answer rather than a (possibly temporary) id: the temp→real
 * mapping is bounded, and an undo may be pressed long after it has been forgotten. If the create
 * fails, the caller drops the returned entry.
 */
export function recordTransactionCreate(realId: Promise<number>, { override, t, reload }: Common): HistoryAction {
 // Marks the rejection handled here; the caller reports a failed create on its own path.
 realId.catch(() => {});
 let batchId: number | null = null;
 return useActionHistoryStore.getState().push({
  undo: async () => {
   const id = await realId;
   const result = await accountingApi.deleteTransaction(id, { acknowledgeReconciliationOverride: override });
   if (result.batchId == null) throw new Error(t('history_step_gone'));
   batchId = result.batchId;
   await reload();
  },
  redo: async () => {
   if (batchId == null) throw new Error(t('history_step_gone'));
   const result = await accountingApi.restoreTrash({ batchId, acknowledgeReconciliationOverride: override });
   assertRestored(result, t);
   batchId = null;
   await reload();
  },
 });
}

/**
 * Records a delete (one row or a selection) on the shared undo/redo history. Undo restores the
 * batch from the Trash; redo deletes the same rows again, which makes a new batch — tracked here
 * so the next undo restores the right one.
 */
export function recordTransactionDelete(transactionIds: number[], batchId: number, { override, t, reload }: Common): HistoryAction {
 let currentBatchId: number | null = batchId;
 // Resolved now, while any row created moments ago still maps from its temporary id — the
 // mapping is bounded, and a redo may come much later.
 const realIds = resolveTransactionIds(transactionIds);
 realIds.catch(() => {});
 return useActionHistoryStore.getState().push({
  undo: async () => {
   if (currentBatchId == null) throw new Error(t('history_step_gone'));
   const result = await accountingApi.restoreTrash({ batchId: currentBatchId, acknowledgeReconciliationOverride: override });
   assertRestored(result, t);
   currentBatchId = null;
   await reload();
  },
  redo: async () => {
   const ids = await realIds;
   const result =
    ids.length === 1
     ? await accountingApi.deleteTransaction(ids[0], { acknowledgeReconciliationOverride: override })
     : await accountingApi.deleteTransactionsBulk({ transactionIds: ids, acknowledgeReconciliationOverride: override });
   if (result.batchId == null) throw new Error(t('history_step_gone'));
   currentBatchId = result.batchId;
   await reload();
  },
 });
}
