'use client';

import type { ChangeEvent, Dispatch, RefObject, SetStateAction } from 'react';
import { confirmDialog } from '@/components/ui/AppDialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { accountingApi } from '@/lib/accountingApi';
import { useWorkspaceActions } from '@/features/workspace/hooks/useWorkspaceActions';
import { useTransactionsStore } from '@/features/transactions/store/transactionsStore';
import { useClientsStore } from '@/features/clients/store/clientsStore';
import { emptyClientForm } from '@/features/clients/forms';
import { getDeviceLabel } from '@/shared/utils/device';
import type { Client } from '@/shared/types';

type UseBackupActionsParams = {
 setIsBackingUp: Dispatch<SetStateAction<boolean>>;
 setIsRestoringBackup: Dispatch<SetStateAction<boolean>>;
 lastBackupAt: string | null;
 setLastBackupAt: Dispatch<SetStateAction<string | null>>;
 lastBackupDevice: string | null;
 setLastBackupDevice: Dispatch<SetStateAction<string | null>>;
 backupRestoreInputRef: RefObject<HTMLInputElement | null>;
 setImportSummary: Dispatch<SetStateAction<string>>;
 setSelectedClientForAccounts: Dispatch<SetStateAction<Client | null>>;
 setSelectedClientForLedger: Dispatch<SetStateAction<Client | null>>;
 setSelectedLedgerAccountId: Dispatch<SetStateAction<number | null>>;
};

/**
 * Backup download/restore + the "last backup: N ago" label. Grouped together
 * since the label reads the same lastBackupAt/lastBackupDevice state the
 * handlers write, and both are consumed together by DatabaseSettings.
 */
export function useBackupActions({
 setIsBackingUp,
 setIsRestoringBackup,
 lastBackupAt,
 setLastBackupAt,
 lastBackupDevice,
 setLastBackupDevice,
 backupRestoreInputRef,
 setImportSummary,
 setSelectedClientForAccounts,
 setSelectedClientForLedger,
 setSelectedLedgerAccountId,
}: UseBackupActionsParams) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const { invalidate: loadData, setError } = useWorkspaceActions();
 const setClientForm = useClientsStore((s) => s.setClientForm);
 const setSelectedTransactionIds = useTransactionsStore((s) => s.setSelectedTransactionIds);
 const setTransactionTableDrafts = useTransactionsStore((s) => s.setTransactionTableDrafts);
 const setCommissionExpandedTxns = useTransactionsStore((s) => s.setCommissionExpandedTxns);
 const setExpensesExpandedTxns = useTransactionsStore((s) => s.setExpensesExpandedTxns);
 const setTransactionsPage = useTransactionsStore((s) => s.setTransactionsPage);

async function onDownloadBackup() {
 if (!accountingApi) {
  setError(t('error_bridge'));
  return;
 }

 setIsBackingUp(true);
 try {
  const backup = await accountingApi.exportWorkspaceData();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `arkam_backup_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  // Stamp the backup server-side so the indicator syncs to every device.
  try {
   const recorded = await accountingApi.recordBackup(getDeviceLabel());
   setLastBackupAt(recorded.lastBackupAt);
   setLastBackupDevice(recorded.lastBackupDevice);
  } catch {
   // Download already succeeded; a failed stamp is non-fatal.
   setLastBackupAt(new Date().toISOString());
   setLastBackupDevice(getDeviceLabel());
  }
  setError('');
  setImportSummary(t('backup_download_success'));
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_save'));
 } finally {
  setIsBackingUp(false);
 }
}

async function onRestoreBackupFile(event: ChangeEvent<HTMLInputElement>) {
 const file = event.target.files?.[0];
 if (backupRestoreInputRef.current) backupRestoreInputRef.current.value = '';
 if (!file) return;

 if (!accountingApi) {
  setError(t('error_bridge'));
  return;
 }

 const confirmed = await confirmDialog({
  title: t('danger_action_cannot_undo'),
  message: t('backup_restore_confirm'),
  tone: 'danger',
 });
 if (!confirmed) return;

 setIsRestoringBackup(true);
 try {
  const text = await file.text();
  let parsed: unknown;
  try {
   parsed = JSON.parse(text);
  } catch {
   throw new Error(t('backup_restore_invalid_file'));
  }

  if (!parsed || typeof parsed !== 'object' || (parsed as { format?: string }).format !== 'arkam-backup') {
   throw new Error(t('backup_restore_invalid_file'));
  }

  await accountingApi.importWorkspaceData(parsed as Parameters<typeof accountingApi.importWorkspaceData>[0]);
  setSelectedTransactionIds(new Set());
  setTransactionTableDrafts({});
  setCommissionExpandedTxns(new Set());
  setExpensesExpandedTxns(new Set());
  setClientForm(emptyClientForm());
  setSelectedClientForAccounts(null);
  setSelectedClientForLedger(null);
  setSelectedLedgerAccountId(null);
  setTransactionsPage(99999);
  setError('');
  await loadData();
  setImportSummary(t('backup_restore_success'));
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_save'));
 } finally {
  setIsRestoringBackup(false);
 }
}

// How long a downloaded backup stays "recent" before the UI starts nudging. A week is a
// deliberate compromise: short enough that a lost laptop costs at most a few days of work,
// long enough that the reminder doesn't become background noise people learn to ignore.
const BACKUP_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

// Previously only a never-backed-up workspace was flagged, so a backup taken months ago
// rendered in the same faint grey as one taken this morning — the label was there, but it read
// as reassurance either way.
//
// Three states rather than a boolean because 'never' and 'stale' want the same warning colour
// but different copy: lastBackupLabel already says "no backup yet" for 'never', so adding
// "you haven't backed up in over a week" on top of it just says the same thing twice.
// An unparseable timestamp counts as 'never': if we can't tell when the last backup happened,
// we shouldn't imply there was one.
function backupFreshness(): 'never' | 'stale' | 'fresh' {
 if (!lastBackupAt) return 'never';

 const then = new Date(lastBackupAt).getTime();
 if (!Number.isFinite(then)) return 'never';

 return Date.now() - then > BACKUP_STALE_AFTER_MS ? 'stale' : 'fresh';
}

// Localized "Last backup: 2 days ago" style label, or a "never" message.
function lastBackupLabel(): string {
 if (!lastBackupAt) return t('backup_last_never');

 const then = new Date(lastBackupAt).getTime();
 if (Number.isNaN(then)) return t('backup_last_never');

 const diffMs = Date.now() - then;
 const minutes = Math.round(diffMs / 60000);
 const hours = Math.round(diffMs / 3600000);
 const days = Math.round(diffMs / 86400000);

 const exact = new Date(lastBackupAt).toLocaleString(language, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
 });

 let relative: string;
 try {
  const rtf = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  if (Math.abs(days) >= 1) relative = rtf.format(-days, 'day');
  else if (Math.abs(hours) >= 1) relative = rtf.format(-hours, 'hour');
  else if (Math.abs(minutes) >= 1) relative = rtf.format(-minutes, 'minute');
  else relative = rtf.format(0, 'minute');
 } catch {
  relative = exact;
 }

 const time = `${relative} (${exact})`;
 if (lastBackupDevice) {
  return t('backup_last_device').replace('{time}', time).replace('{device}', lastBackupDevice);
 }
 return t('backup_last_label').replace('{time}', time);
}

 return { onDownloadBackup, onRestoreBackupFile, lastBackupLabel, backupFreshness };
}
