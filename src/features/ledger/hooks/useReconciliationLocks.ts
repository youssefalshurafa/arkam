'use client';

import { useMemo } from 'react';
import { confirmDialog } from '@/components/ui/AppDialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useAppStatusStore } from '@/shared/store/appStatusStore';
import { useLedgerStore } from '@/features/ledger/store/ledgerStore';
import { buildLockBoundaries, violatedLock, reconciledImpact, type LockBoundary, type RowContribution } from '@/features/ledger/utils/reconciliation';
import { computeTransactionSideNetChange } from '@/features/ledger/utils/ledgerBalances';
import { isBeforeToday } from '@/shared/utils/date';
import type { ClientAccount, Reconciliation, Transaction, TransactionUpdateInput } from '@/shared/types';

// The account+boundary a change would violate, or null if it touches no locked history.
type LockHit = { accountId: number; boundary: LockBoundary } | null;

/**
 * The outcome of a lock guard. Two separate facts, deliberately not collapsed into one boolean:
 *
 *   proceed  — may the caller go ahead? False only when the user cancelled a warning.
 *   overrode — did this actually override a reconciliation lock? True ONLY when a lock was hit
 *              AND the user confirmed writing through it.
 *
 * The distinction is the whole point. These guards used to return a bare `true` for both "there
 * was nothing locked here" and "the user confirmed an override", and every call site then sent
 * `acknowledgeReconciliationOverride: true` to the API. Since db.js's
 * assertReconciliationNotViolated begins `if (override) return;`, that meant the server-side
 * backstop was skipped on EVERY write in the app, not just deliberate overrides — leaving the
 * lock enforced solely by this browser code. Anything not going through this UI (a crafted
 * request, or a future code path that forgets to call a guard) wrote through reconciled history
 * silently. Passing `overrode` through instead means the server re-checks the ordinary case,
 * which is nearly all of them.
 */
export type LockDecision = { proceed: boolean; overrode: boolean };

const PROCEED_UNLOCKED: LockDecision = { proceed: true, overrode: false };

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
 * guards returns a LockDecision; pass its `overrode` field straight through as
 * `acknowledgeReconciliationOverride` on the API call. Do NOT hardcode `true`
 * there — that skips db.js's assertReconciliationNotViolated backstop on every
 * write, which is what made the lock browser-only. `overrode` is true only for a
 * genuine, user-confirmed override, so the server still checks everything else.
 */
export function useReconciliationLocks({ reconciliations, clientAccountMap, lockPastEditsEnabled }: UseReconciliationLocksParams) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const setError = useAppStatusStore((s) => s.setError);
 // Dialogs quote balances the user is about to compare against rows on screen, so they are
 // formatted with the ledger's own decimal setting rather than a fixed two places.
 const ledgerDecimals = useLedgerStore((state) => state.ledgerDecimals);

 // Newest reconciliation per client account = the lock line used by the guards below. Both
 // `anchorDate` and `lockedTransactionIds` are frozen at creation time (see reconciliation.ts),
 // so — unlike the old model — this never needs to re-resolve anything from live transaction
 // positions; it only depends on the reconciliations list itself.
 const lockBoundaries = useMemo(() => buildLockBoundaries(reconciliations), [reconciliations]);

 // Formats a reconciled balance the way the ledger's own balance column does — "100,553 $",
 // not "$100,553.00" — so a figure in a dialog can be matched against the rows on screen
 // without mentally reformatting it.
 function formatLockBalance(accountId: number, balance: number): string {
  const account = clientAccountMap.get(accountId);
  const suffix = account ? ` ${account.currencySymbol || account.currencyCode}` : '';
  return `${balance.toLocaleString(undefined, { maximumFractionDigits: ledgerDecimals })}${suffix}`;
 }

 // Whose ledger a warning is about. A transaction sits in two ledgers, each reconciled
 // independently, so the ✓ a change trips is very often NOT the one on screen — an unnamed
 // balance from the other side is impossible to place, hence always naming the account.
 function lockAccountLabel(accountId: number): string {
  const account = clientAccountMap.get(accountId);
  if (!account) return '';
  return `${account.clientName ?? ''}${account.currencyCode ? ` (${account.currencyCode})` : ''}`.trim();
 }

 // Shared dialog for any lock hit, whatever guard found it — the ledger drag and the
 // transactions-table drop route their own hits through here too, so every reconciliation
 // warning in the app reads the same and names the same things. No hit means nothing was
 // locked, which is emphatically not an override — see LockDecision.
 async function warnLockHit(hit: LockHit): Promise<LockDecision> {
  if (!hit) return PROCEED_UNLOCKED;
  const confirmed = await confirmDialog({
   title: t('reconcile_warn_title'),
   message: t('reconcile_warn_message'),
   balanceChanges: [
    {
     label: lockAccountLabel(hit.accountId),
     from: formatLockBalance(hit.accountId, hit.boundary.balance),
     fromNegative: hit.boundary.balance < 0,
    },
   ],
   note: t('reconcile_warn_note'),
   confirmText: t('reconcile_warn_confirm'),
   tone: 'danger',
  });
  return { proceed: confirmed, overrode: confirmed };
 }

 /**
  * Guard shared by create/delete/reorder operations, which have no "old vs new net" to diff
  * — the whole row is appearing/disappearing/moving at that position. `accountIds` are the
  * accounts a change touches (a transaction hits both from & to); `createdAt`/`refId` locate
  * the affected row (pass NEW_ROW_REF_ID for a not-yet-created transaction).
  */
 async function checkLockForNewRow(accountIds: Array<number | null | undefined>, createdAt: string, refId: number): Promise<LockDecision> {
  return warnLockHit(violatedLock(accountIds, createdAt, refId, lockBoundaries));
 }

 /**
  * Delete confirmation that folds in the reconciliation guard: if the row is at or
  * before a lock line it shows the lock warning, otherwise the normal delete prompt —
  * one dialog either way. Confirming the ordinary delete prompt is not an override.
  */
 async function checkLockForDelete(accountIds: Array<number | null | undefined>, createdAt: string, refId: number, fallbackMessageKey: string): Promise<LockDecision> {
  const hit = violatedLock(accountIds, createdAt, refId, lockBoundaries);
  if (hit) return warnLockHit(hit);
  return { proceed: await confirmDialog({ message: t(fallbackMessageKey), confirmText: t('delete'), tone: 'danger' }), overrode: false };
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
 // wrapped by `checkLockForEdit` for single-row saves.
 function transactionEditImpact(oldTx: Transaction, newPayload: TransactionUpdateInput): LockHit {
  return reconciledImpact(transactionEditChanges(oldTx, newPayload), lockBoundaries);
 }

 /**
  * Does this edit touch a row the SERVER would refuse without the override flag?
  *
  * db.js's assertReconciliationNotViolated is a coarser, POSITION-only check than the
  * balance-delta math `transactionEditImpact` uses: it rejects any write whose row sits at or
  * before a lock line, "regardless of whether that specific write actually moves the reconciled
  * number" (its own words). So a dialog having been shown is NOT the only case where the server
  * has to be told to stand down — editing just the description of a locked row moves nothing,
  * correctly shows no dialog, and would still be refused server-side.
  *
  * Both positions are checked because an edit can re-date a row into, or out of, locked history.
  */
 function editTouchesLockedPosition(oldTx: Transaction, newPayload: TransactionUpdateInput): boolean {
  const fromOld = violatedLock([oldTx.accountFromId, oldTx.accountToId], oldTx.createdAt, oldTx.id, lockBoundaries);
  const fromNew = violatedLock([newPayload.accountFromId, newPayload.accountToId], newPayload.createdAt, oldTx.id, lockBoundaries);
  return Boolean(fromOld || fromNew);
 }

 /**
  * Two-sided edit guard for a transaction (the ledger-row/table-row edit save paths, and a
  * single dragged row). Warns only when the edit actually moves a reconciled balance (see
  * `transactionEditImpact`), but reports `overrode` on the server's broader position rule so a
  * balance-neutral edit to locked history isn't refused (see `editTouchesLockedPosition`).
  */
 async function checkLockForEdit(oldTx: Transaction, newPayload: TransactionUpdateInput): Promise<LockDecision> {
  const decision = await warnLockHit(transactionEditImpact(oldTx, newPayload));
  if (!decision.proceed) return decision;
  return { proceed: true, overrode: decision.overrode || editTouchesLockedPosition(oldTx, newPayload) };
 }

 /**
  * Batch version of `checkLockForEdit`: checks every planned edit and shows at
  * most ONE dialog for the whole batch (the first row that actually moves a reconciled
  * balance), instead of one dialog per locked row. A single decision covers the whole batch,
  * so `overrode` applies to every row in it.
  */
 async function checkLockForBatchEdit(edits: Array<{ oldTx: Transaction; newPayload: TransactionUpdateInput }>): Promise<LockDecision> {
  let hit: LockHit = null;
  for (const edit of edits) {
   hit = transactionEditImpact(edit.oldTx, edit.newPayload);
   if (hit) break;
  }
  const decision = await warnLockHit(hit);
  if (!decision.proceed) return decision;
  // One decision covers the batch, so if ANY row in it sits in locked history the whole batch
  // needs the flag — the rows are saved individually and the server checks each one.
  const touchesLocked = edits.some((edit) => editTouchesLockedPosition(edit.oldTx, edit.newPayload));
  return { proceed: true, overrode: decision.overrode || touchesLocked };
 }

 /**
  * Batch version of `checkLockForDelete`: checks every row about to be deleted and shows
  * at most ONE dialog for the whole batch. A single decision covers every row in it.
  */
 async function checkLockForBatchDelete(
  rows: Array<{ accountFromId: number | null; accountToId: number | null; createdAt: string; id: number }>,
  fallbackMessageKey: string,
  fallbackMessageParams?: Record<string, string | number>,
 ): Promise<LockDecision> {
  let hit: LockHit = null;
  for (const row of rows) {
   hit = violatedLock([row.accountFromId, row.accountToId], row.createdAt, row.id, lockBoundaries);
   if (hit) break;
  }
  if (hit) return warnLockHit(hit);
  return { proceed: await confirmDialog({ message: t(fallbackMessageKey, fallbackMessageParams), confirmText: t('delete'), tone: 'danger' }), overrode: false };
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
  lockAccountLabel,
  warnLockHit,
  checkLockForNewRow,
  checkLockForDelete,
  checkLockForEdit,
  checkLockForBatchEdit,
  checkLockForBatchDelete,
  transactionEditImpact,
  blockedByPastEditLock,
 };
}
