import { accountingApi } from '@/lib/accountingApi';
import { useAppStatusStore } from '@/shared/store/appStatusStore';
import { describeBlockedRestore } from '@/features/trash/utils/trash';

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * Brings one delete back out of the Trash — what every Undo toast and the Trash's Restore button
 * call. The rows return with their original ids, so their history, reconciliation membership and
 * ignored anomalies come back with them (the old undo re-created the transaction instead, and
 * lost all three).
 *
 * `override` must repeat the reconciliation decision the user made for the delete being undone
 * (or confirmed in the Trash): the restore puts the rows back exactly where they were, so it
 * needs the same permission the removal did — and no more.
 *
 * Anything the server had to leave in the Trash (its counterparty is itself deleted, or the
 * account was re-created since) is reported through the error banner rather than silently.
 */
export function restoreTrashBatch(batchId: number, options: RestoreOptions): Promise<boolean> {
 return runRestore({ batchId }, options);
}

/**
 * The same, for individual transactions picked in the Trash's table rather than a whole delete.
 * The server applies the same rules (member ownership, blocked counterparties, past-edit lock).
 */
export function restoreTrashTransactions(transactionIds: number[], options: RestoreOptions): Promise<boolean> {
 return runRestore({ transactionIds }, options);
}

type RestoreOptions = { override?: boolean; t: Translate; loadData: () => Promise<unknown> | void };

async function runRestore(target: { batchId: number } | { transactionIds: number[] }, { override = false, t, loadData }: RestoreOptions): Promise<boolean> {
 const { setError, showToast } = useAppStatusStore.getState();
 try {
  const result = await accountingApi.restoreTrash({ ...target, acknowledgeReconciliationOverride: override });
  const blocked = describeBlockedRestore(result, t);
  setError(blocked);
  await loadData();
  if (!blocked) showToast(t('trash_restored'));
  return true;
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_save'));
  return false;
 }
}

/**
 * Offers the ~6s Undo toast for a soft delete. A delete that found nothing left to trash (the
 * row was already gone) returns a null batch, and there is nothing to undo.
 */
export function offerTrashUndo(batchId: number | null | undefined, message: string, onUndo: (batchId: number) => void): void {
 if (batchId == null) return;
 useAppStatusStore.getState().showUndo(message, () => onUndo(batchId));
}
