'use client';

import { useMemo } from 'react';
import { confirmDialog } from '@/components/ui/AppDialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useAppStatusStore } from '@/shared/store/appStatusStore';
import { buildLockBoundaries, buildLiveAnchorTimes, violatedLock, reconciledImpact, type LockBoundary, type RowContribution } from '@/features/ledger/utils/reconciliation';
import { computeTransactionSideNetChange, computeAdjustmentNetChange } from '@/features/ledger/utils/ledgerBalances';
import { isBeforeToday } from '@/shared/utils/date';
import type { ClientAccount, ClientAdjustment, Reconciliation, Transaction, TransactionUpdateInput } from '@/shared/types';

// The account+boundary a change would violate, or null if it touches no locked history.
type LockHit = { accountId: number; boundary: LockBoundary } | null;

type UseReconciliationLocksParams = {
 reconciliations: Reconciliation[];
 // Live rows used to resolve each lock boundary's anchor to its CURRENT createdAt rather
 // than the stale one-time snapshot stored on the reconciliation (see `buildLiveAnchorTimes`).
 transactions: Transaction[];
 adjustments: ClientAdjustment[];
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
 * proceed if confirmed" behavior.
 */
export function useReconciliationLocks({ reconciliations, transactions, adjustments, clientAccountMap, lockPastEditsEnabled }: UseReconciliationLocksParams) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const setError = useAppStatusStore((s) => s.setError);

 const liveAnchorTimes = useMemo(() => buildLiveAnchorTimes(transactions, adjustments), [transactions, adjustments]);
 // Newest reconciliation per client account = the lock line used by the guards below.
 const lockBoundaries = useMemo(() => buildLockBoundaries(reconciliations, liveAnchorTimes), [reconciliations, liveAnchorTimes]);

 // Formats a reconciled balance for dialogs, e.g. "$100,553.00".
 function formatLockBalance(accountId: number, balance: number): string {
  const symbol = clientAccountMap.get(accountId)?.currencySymbol ?? '';
  return `${symbol}${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
 }

 /**
  * Guard shared by all four dangerous operations. `accountIds` are the accounts a
  * change touches (a transaction hits both from & to); `createdAt`/`refId` locate
  * the affected row (pass NEW_ROW_REF_ID for a not-yet-created transaction). Returns
  * true to proceed — either nothing is locked, or the user confirmed the warning.
  */
 async function confirmIfLocked(accountIds: Array<number | null | undefined>, createdAt: string, refId: number): Promise<boolean> {
  const hit = violatedLock(accountIds, createdAt, refId, lockBoundaries);
  if (!hit) return true;
  return confirmDialog({
   title: t('reconcile_warn_title'),
   message: t('reconcile_warn_message', { balance: formatLockBalance(hit.accountId, hit.boundary.balance) }),
   confirmText: t('reconcile_warn_confirm'),
   tone: 'danger',
  });
 }

 /**
  * Delete confirmation that folds in the reconciliation guard: if the row is at or
  * before a lock line it shows the lock warning, otherwise the normal delete prompt —
  * one dialog either way. Returns true to proceed.
  */
 async function confirmDeleteWithLock(accountIds: Array<number | null | undefined>, createdAt: string, refId: number, fallbackMessageKey: string): Promise<boolean> {
  const hit = violatedLock(accountIds, createdAt, refId, lockBoundaries);
  if (hit) {
   return confirmDialog({
    title: t('reconcile_warn_title'),
    message: t('reconcile_warn_message', { balance: formatLockBalance(hit.accountId, hit.boundary.balance) }),
    confirmText: t('reconcile_warn_confirm'),
    tone: 'danger',
   });
  }
  return confirmDialog({ message: t(fallbackMessageKey), confirmText: t('delete'), tone: 'danger' });
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
  * Pure (no dialog) balance-impact check for a transaction edit — for every account the
  * transaction touches (before or after the edit) it compares that row's contribution to the
  * account's reconciled balance — its net change while it sits at or before the lock anchor —
  * before vs after. Editing only the "from" side's rate never changes the "to" account's
  * balance (no hit); editing a field that nets to the same value, or a row that stays strictly
  * after the anchor, is likewise silent. Editing the counterparty account itself IS a real hit
  * for whichever account gains/loses the row. Used directly by batch-save pre-checks (which
  * must evaluate many rows before showing at most one dialog) and wrapped by
  * `confirmIfTransactionEditLocked` for single-row saves.
  */
 function transactionEditImpact(oldTx: Transaction, newPayload: TransactionUpdateInput): LockHit {
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
  const contributions = [...accountIds].map((accountId) => {
   const old: RowContribution = { createdAt: oldTx.createdAt, refId: oldTx.id, net: netOn(oldTx, accountId), present: oldTx.accountFromId === accountId || oldTx.accountToId === accountId };
   const next: RowContribution = { createdAt: newPayload.createdAt, refId: oldTx.id, net: netOn(newPayload, accountId), present: newPayload.accountFromId === accountId || newPayload.accountToId === accountId };
   return { accountId, old, next };
  });
  return reconciledImpact(contributions, lockBoundaries);
 }

 /**
  * Two-sided edit guard for a transaction (the ledger-row/table-row edit save paths). Warns
  * only when the edit actually moves a reconciled balance (see `transactionEditImpact`).
  * Returns true to proceed.
  */
 async function confirmIfTransactionEditLocked(oldTx: Transaction, newPayload: TransactionUpdateInput): Promise<boolean> {
  return warnLockHit(transactionEditImpact(oldTx, newPayload));
 }

 /**
  * Pure (no dialog) balance-impact check for an adjustment edit, mirroring
  * `transactionEditImpact` for the single-account adjustment case (its account can itself
  * change on edit, e.g. reassigning which client account an expense belongs to).
  */
 function adjustmentEditImpact(oldAdj: ClientAdjustment, newAdj: ClientAdjustment): LockHit {
  const netOn = (adj: ClientAdjustment, accountId: number): number => {
   const account = clientAccountMap.get(accountId);
   if (!account) return 0;
   return computeAdjustmentNetChange(adj, account.currencyId);
  };
  const accountIds = new Set<number>([oldAdj.accountId, newAdj.accountId]);
  const contributions = [...accountIds].map((accountId) => {
   const old: RowContribution = { createdAt: oldAdj.createdAt, refId: oldAdj.id, net: netOn(oldAdj, accountId), present: oldAdj.accountId === accountId };
   const next: RowContribution = { createdAt: newAdj.createdAt, refId: oldAdj.id, net: netOn(newAdj, accountId), present: newAdj.accountId === accountId };
   return { accountId, old, next };
  });
  return reconciledImpact(contributions, lockBoundaries);
 }

 /**
  * Edit guard for an adjustment (expense) — warns only when the edit actually moves a
  * reconciled balance (see `adjustmentEditImpact`). Returns true to proceed.
  */
 async function confirmIfAdjustmentEditLocked(oldAdj: ClientAdjustment, newAdj: ClientAdjustment): Promise<boolean> {
  return warnLockHit(adjustmentEditImpact(oldAdj, newAdj));
 }

 /**
  * Hard block (no confirm dialog, unlike the guards above) for the workspace's "lock
  * past-dated edits" toggle: when on, nobody — including owner/admin — can create, edit,
  * re-date, or delete a transaction/adjustment dated yesterday or earlier. `createdAtValues`
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
  confirmIfAdjustmentEditLocked,
  transactionEditImpact,
  adjustmentEditImpact,
  blockedByPastEditLock,
 };
}
