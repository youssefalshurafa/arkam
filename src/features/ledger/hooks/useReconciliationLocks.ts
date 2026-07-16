'use client';

import { useMemo } from 'react';
import { confirmDialog } from '@/components/ui/AppDialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { buildLockBoundaries, violatedLock, reconciledImpact, type RowContribution } from '@/features/ledger/utils/reconciliation';
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
  * Two-sided edit guard for a transaction (the ledger-row/table-row edit save paths). Warns
  * only when the edit actually moves a reconciled balance: for every account the transaction
  * touches (before or after the edit) it compares that row's contribution to the account's
  * reconciled balance — its net change while it sits at or before the lock anchor — before vs
  * after. Editing only the "from" side's rate never changes the "to" account's balance (no
  * warning); editing a field that nets to the same value, or a row that stays strictly after
  * the anchor, is likewise silent. Returns true to proceed.
  */
 async function confirmIfTransactionEditLocked(oldTx: Transaction, newPayload: TransactionUpdateInput): Promise<boolean> {
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
  const hit = reconciledImpact(contributions, lockBoundaries);
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
  confirmDeleteWithLock,
  confirmIfEditLocked,
  confirmIfTransactionEditLocked,
 };
}
