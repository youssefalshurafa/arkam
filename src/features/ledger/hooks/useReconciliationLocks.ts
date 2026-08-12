'use client';

import { useMemo } from 'react';
import { confirmDialog } from '@/components/ui/AppDialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useAppStatusStore } from '@/shared/store/appStatusStore';
import { buildLockBoundaries, violatedLock, reconciledImpact, type LockBoundary, type RowContribution } from '@/features/ledger/utils/reconciliation';
import { computeTransactionSideNetChange } from '@/features/ledger/utils/ledgerBalances';
import { isBeforeToday } from '@/shared/utils/date';
import type { ClientAccount, Reconciliation, Transaction, TransactionUpdateInput } from '@/shared/types';

// The account+boundary a change would violate, or null if it touches no locked history.
type LockHit = { accountId: number; boundary: LockBoundary } | null;

type UseReconciliationLocksParams = {
 reconciliations: Reconciliation[];
 clientAccountMap: Map<number, ClientAccount & { clientName?: string }>;
 // Workspace-wide "lock past-dated edits" toggle (Settings > Team, owner/admin only). The
 // real enforcement is server-side (route.ts/db.js) — this only stops the request from
 // being sent so the user sees an immediate, specific error instead of a round-trip 500.
 lockPastEditsEnabled: boolean;
};

/**
 * Reconciliation-lock guards shared by the ledger and transactions-table edit/
 * delete/reorder flows — both can touch history at or before an account's
 * lock line (its newest reconciliation), so both need the same "warn once,
 * proceed if confirmed" behavior. Every write path that passes one of these
 * guards must also set `acknowledgeReconciliationOverride: true` on the actual
 * API call, so the server-side backstop (assertReconciliationNotViolated in
 * db.js) doesn't independently re-reject a write the user already confirmed.
 */
export function useReconciliationLocks({ reconciliations, clientAccountMap, lockPastEditsEnabled }: UseReconciliationLocksParams) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const setError = useAppStatusStore((s) => s.setError);

 // Newest reconciliation per client account = the lock line used by the guards below. Both
 // `anchorDate` and `lockedTransactionIds` are frozen at creation time (see reconciliation.ts),
 // so — unlike the old model — this never needs to re-resolve anything from live transaction
 // positions; it only depends on the reconciliations list itself.
 const lockBoundaries = useMemo(() => buildLockBoundaries(reconciliations), [reconciliations]);

 // Formats a reconciled balance for dialogs, e.g. "$100,553.00".
 function formatLockBalance(accountId: number, balance: number): string {
  const symbol = clientAccountMap.get(accountId)?.currencySymbol ?? '';
  return `${symbol}${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
 }

 // Shared dialog for any lock hit, whatever guard found it.
 function warnLockHit(hit: LockHit): Promise<boolean> {
  if (!hit) return Promise.resolve(true);
  return confirmDialog({
   title: t('reconcile_warn_title'),
   message: t('reconcile_warn_message', { balance: formatLockBalance(hit.accountId, hit.boundary.balance) }),
   confirmText: t('reconcile_warn_confirm'),
   tone: 'danger',
  });
 }

 /**
  * Guard shared by create/delete/reorder operations, which have no "old vs new net" to diff
  * — the whole row is appearing/disappearing/moving at that position. `accountIds` are the
  * accounts a change touches (a transaction hits both from & to); `createdAt`/`refId` locate
  * the affected row (pass NEW_ROW_REF_ID for a not-yet-created transaction). Returns true to
  * proceed — either nothing is locked, or the user confirmed the warning.
  */
 async function confirmIfLocked(accountIds: Array<number | null | undefined>, createdAt: string, refId: number): Promise<boolean> {
  return warnLockHit(violatedLock(accountIds, createdAt, refId, lockBoundaries));
 }

 /**
  * Delete confirmation that folds in the reconciliation guard: if the row is at or
  * before a lock line it shows the lock warning, otherwise the normal delete prompt —
  * one dialog either way. Returns true to proceed.
  */
 async function confirmDeleteWithLock(accountIds: Array<number | null | undefined>, createdAt: string, refId: number, fallbackMessageKey: string): Promise<boolean> {
  const hit = violatedLock(accountIds, createdAt, refId, lockBoundaries);
  if (hit) return warnLockHit(hit);
  return confirmDialog({ message: t(fallbackMessageKey), confirmText: t('delete'), tone: 'danger' });
 }

 /**
  * Builds the per-account before/after contribution list for one transaction edit — for
  * every account the transaction touches (before or after the edit) it compares that row's
  * net change while it's a reconciled member, before vs after. Editing only the "from"
  * side's rate never changes the "to" account's contribution (no entry needed there in
  * practice, though it's harmless to include); editing a field that nets to the same value,
  * or a row that stays strictly after the anchor, likewise nets to zero impact. Editing the
  * counterparty account itself IS a real hit for whichever account gains/loses the row.
  * Shared by every edit/reorder guard below (single, batch, and drag) so they can never
  * drift from each other the way the old, independently-reimplemented call sites could.
  */
 function transactionEditChanges(oldTx: Transaction, newPayload: TransactionUpdateInput): Array<{ accountId: number; old: RowContribution; next: RowContribution }> {
  const netOn = (tx: Transaction | TransactionUpdateInput, accountId: number): number => {
   const account = clientAccountMap.get(accountId);
   if (!account) return 0;
   let net = 0;
   if (tx.accountFromId === accountId) net += computeTransactionSideNetChange(tx, account.currencyId, 'from');
   if (tx.accountToId === accountId) net += computeTransactionSideNetChange(tx, account.currencyId, 'to');
   return net;
  };
  const accountIds = new Set<number>();
  for (const id of [oldTx.accountFromId, oldTx.accountToId, newPayload.accountFromId, newPayload.accountToId]) {
   if (id != null) accountIds.add(id);
  }
  return [...accountIds].map((accountId) => ({
   accountId,
   old: { createdAt: oldTx.createdAt, refId: oldTx.id, net: netOn(oldTx, accountId), present: oldTx.accountFromId === accountId || oldTx.accountToId === accountId },
   next: { createdAt: newPayload.createdAt, refId: oldTx.id, net: netOn(newPayload, accountId), present: newPayload.accountFromId === accountId || newPayload.accountToId === accountId },
  }));
 }

 // Pure (no dialog) impact check for one transaction edit — used directly by batch-save and
 // drag pre-checks (which must evaluate many rows before showing at most one dialog) and
 // wrapped by `confirmIfTransactionEditLocked` for single-row saves.
 function transactionEditImpact(oldTx: Transaction, newPayload: TransactionUpdateInput): LockHit {
  return reconciledImpact(transactionEditChanges(oldTx, newPayload), lockBoundaries);
 }

 /**
  * Two-sided edit guard for a transaction (the ledger-row/table-row edit save paths, and a
  * single dragged row). Warns only when the edit actually moves a reconciled balance (see
  * `transactionEditImpact`). Returns true to proceed.
  */
 async function confirmIfTransactionEditLocked(oldTx: Transaction, newPayload: TransactionUpdateInput): Promise<boolean> {
  return warnLockHit(transactionEditImpact(oldTx, newPayload));
 }

 /**
  * Batch version of `confirmIfTransactionEditLocked`: checks every planned edit and shows at
  * most ONE dialog for the whole batch (the first row that actually moves a reconciled
  * balance), instead of one dialog per locked row. Returns true to proceed with all of them.
  */
 async function confirmIfBatchEditLocked(edits: Array<{ oldTx: Transaction; newPayload: TransactionUpdateInput }>): Promise<boolean> {
  let hit: LockHit = null;
  for (const edit of edits) {
   hit = transactionEditImpact(edit.oldTx, edit.newPayload);
   if (hit) break;
  }
  return warnLockHit(hit);
 }

 /**
  * Batch version of `confirmDeleteWithLock`: checks every row about to be deleted and shows
  * at most ONE dialog for the whole batch. Returns true to proceed with all of them.
  */
 async function confirmBatchDeleteWithLock(
  rows: Array<{ accountFromId: number | null; accountToId: number | null; createdAt: string; id: number }>,
  fallbackMessageKey: string,
  fallbackMessageParams?: Record<string, string | number>,
 ): Promise<boolean> {
  let hit: LockHit = null;
  for (const row of rows) {
   hit = violatedLock([row.accountFromId, row.accountToId], row.createdAt, row.id, lockBoundaries);
   if (hit) break;
  }
  if (hit) return warnLockHit(hit);
  return confirmDialog({ message: t(fallbackMessageKey, fallbackMessageParams), confirmText: t('delete'), tone: 'danger' });
 }

 /**
  * Hard block (no confirm dialog, unlike the guards above) for the workspace's "lock
  * past-dated edits" toggle: when on, nobody — including owner/admin — can create, edit,
  * re-date, or delete a transaction dated yesterday or earlier. `createdAtValues`
  * should include both the row's CURRENT date (for edit/delete) and the date being written
  * (for create/edit), so re-dating either into or out of a locked day is caught. Archive-only
  * transactions are exempt (see db.js's createTransaction comment) — pass `isArchived: true`
  * for those. Returns true (and sets the error) if the action must be blocked.
  */
 function blockedByPastEditLock(createdAtValues: Array<string | null | undefined>, isArchived = false): boolean {
  if (!lockPastEditsEnabled || isArchived) return false;
  const locked = createdAtValues.some((value) => typeof value === 'string' && value && isBeforeToday(value));
  if (locked) {
   setError(t('lock_past_edits_blocked_message'));
  }
  return locked;
 }

 return {
  lockBoundaries,
  formatLockBalance,
  confirmIfLocked,
  confirmDeleteWithLock,
  confirmIfTransactionEditLocked,
  confirmIfBatchEditLocked,
  confirmBatchDeleteWithLock,
  transactionEditImpact,
  blockedByPastEditLock,
 };
}
