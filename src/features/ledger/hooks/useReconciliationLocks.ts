'use client';

import { useMemo } from 'react';
import { confirmDialog } from '@/components/ui/AppDialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { buildLockBoundaries, violatedLock, isAtOrBeforeBoundary } from '@/features/ledger/utils/reconciliation';
import { computeTransactionSideNetChange } from '@/features/ledger/utils/ledgerBalances';
import type { ClientAccount, Reconciliation, Transaction, TransactionUpdateInput } from '@/shared/types';

type UseReconciliationLocksParams = {
 reconciliations: Reconciliation[];
 clientAccountMap: Map<number, ClientAccount & { clientName?: string }>;
};

/**
 * Reconciliation-lock guards shared by the ledger and transactions-table edit/
 * delete/reorder flows — both can touch history at or before an account's
 * lock line (its newest reconciliation), so both need the same "warn once,
 * proceed if confirmed" behavior.
 */
export function useReconciliationLocks({ reconciliations, clientAccountMap }: UseReconciliationLocksParams) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);

 // Newest reconciliation per client account = the lock line used by the guards below.
 const lockBoundaries = useMemo(() => buildLockBoundaries(reconciliations), [reconciliations]);

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
  * Reorder variant of the guard: warns if any reflowed row sits at or before an
  * account's lock line, either at its current timestamp or the one the drag assigns.
  * Returns true to proceed.
  */
 async function confirmIfReorderLocked(accountId: number, rows: Array<{ createdAt: string; refId: number; newCreatedAt: string }>): Promise<boolean> {
  const boundary = lockBoundaries.get(accountId);
  if (!boundary) return true;
  const touches = rows.some((r) => isAtOrBeforeBoundary(r.createdAt, r.refId, boundary) || isAtOrBeforeBoundary(r.newCreatedAt, r.refId, boundary));
  if (!touches) return true;
  return confirmDialog({
   title: t('reconcile_warn_title'),
   message: t('reconcile_warn_message', { balance: formatLockBalance(accountId, boundary.balance) }),
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

 /**
  * Edit guard: warns if a row is locked either where it is now (old position) or where
  * the edit would move it (new position) — covers re-dating and amount changes on or
  * near reconciled history. Returns true to proceed.
  */
 async function confirmIfEditLocked(oldAccountIds: Array<number | null | undefined>, oldCreatedAt: string, newAccountIds: Array<number | null | undefined>, newCreatedAt: string, refId: number): Promise<boolean> {
  const hit = violatedLock(oldAccountIds, oldCreatedAt, refId, lockBoundaries) ?? violatedLock(newAccountIds, newCreatedAt, refId, lockBoundaries);
  if (!hit) return true;
  return confirmDialog({
   title: t('reconcile_warn_title'),
   message: t('reconcile_warn_message', { balance: formatLockBalance(hit.accountId, hit.boundary.balance) }),
   confirmText: t('reconcile_warn_confirm'),
   tone: 'danger',
  });
 }

 /**
  * Two-sided edit guard for a transaction (the ledger-row/table-row edit save paths).
  * Unlike confirmIfEditLocked, this only checks the lock on a SIDE (from/to account) whose
  * own balance the edit could actually change — e.g. editing only the "from" side's
  * exchange rate never affects the "to" account's ledger, so the "to" account's lock (even
  * if reconciled) is not checked and no warning appears. A side counts as affected if its
  * account changed, the shared date changed (reorders both ledgers), or its computed net
  * change actually differs. Returns true to proceed.
  */
 async function confirmIfTransactionEditLocked(oldTx: Transaction, newPayload: TransactionUpdateInput): Promise<boolean> {
  const dateChanged = new Date(oldTx.createdAt).getTime() !== new Date(newPayload.createdAt).getTime();
  const accountIdsToCheck: number[] = [];
  for (const side of ['from', 'to'] as const) {
   const oldAccountId = side === 'from' ? oldTx.accountFromId : oldTx.accountToId;
   const newAccountId = side === 'from' ? newPayload.accountFromId : newPayload.accountToId;
   const oldAccount = oldAccountId != null ? clientAccountMap.get(oldAccountId) : undefined;
   const newAccount = newAccountId != null ? clientAccountMap.get(newAccountId) : undefined;
   const oldNetChange = oldAccountId != null && oldAccount ? computeTransactionSideNetChange(oldTx, oldAccount.currencyId, side) : 0;
   const newNetChange = newAccountId != null && newAccount ? computeTransactionSideNetChange(newPayload, newAccount.currencyId, side) : 0;
   const affected = oldAccountId !== newAccountId || dateChanged || Math.abs(oldNetChange - newNetChange) > 1e-9;
   if (!affected) continue;
   if (oldAccountId != null) accountIdsToCheck.push(oldAccountId);
   if (newAccountId != null) accountIdsToCheck.push(newAccountId);
  }
  if (accountIdsToCheck.length === 0) return true;
  const hit = violatedLock(accountIdsToCheck, oldTx.createdAt, oldTx.id, lockBoundaries) ?? violatedLock(accountIdsToCheck, newPayload.createdAt, oldTx.id, lockBoundaries);
  if (!hit) return true;
  return confirmDialog({
   title: t('reconcile_warn_title'),
   message: t('reconcile_warn_message', { balance: formatLockBalance(hit.accountId, hit.boundary.balance) }),
   confirmText: t('reconcile_warn_confirm'),
   tone: 'danger',
  });
 }

 return {
  lockBoundaries,
  formatLockBalance,
  confirmIfLocked,
  confirmIfReorderLocked,
  confirmDeleteWithLock,
  confirmIfEditLocked,
  confirmIfTransactionEditLocked,
 };
}
