'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { confirmDialog } from '@/components/ui/AppDialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { accountingApi, type TrashBatch, type TrashTransactionRow, type WorkspaceRole } from '@/lib/accountingApi';
import { queryKeys } from '@/lib/queryClient';
import { panelClassName } from '@/shared/styles';
import { formatDateValue } from '@/shared/utils/date';
import { useTransactionsStore } from '@/features/transactions/store/transactionsStore';
import { useWorkspaceActions } from '@/features/workspace/hooks/useWorkspaceActions';
import { restoreTrashBatch, restoreTrashTransactions } from '@/features/trash/utils/restoreTrashBatch';
import TrashTransactionsTable from '@/features/trash/components/TrashTransactionsTable';
import { batchTitle, canPurge, canRestoreBatch, daysRemaining, filterBatches, isExpiringSoon, type TrashFilter } from '@/features/trash/utils/trash';

type Props = {
 role: WorkspaceRole | null;
 sessionUserId: string | null;
 workspaceId: string | null;
};

// Transactions comes first and is the default: it's the table view of every trashed
// transaction, which is what people come here looking for most.
const FILTERS: { key: TrashFilter; labelKey: string }[] = [
 { key: 'transactions', labelKey: 'trash_filter_transactions' },
 { key: 'clients', labelKey: 'trash_filter_clients' },
 { key: 'all', labelKey: 'trash_filter_all' },
];

/**
 * Settings > Trash: every delete of the last 30 days. The Transactions tab lists the trashed
 * transactions as a table (TrashTransactionsTable); the other tabs group deletes by the action
 * that made them. Both offer Restore and (owner/admin) Delete permanently. Fetched only while the
 * tab is open — it isn't part of the workspace snapshot, and refetched on every visit since
 * deletes elsewhere change it.
 */
export default function TrashSettings({ role, sessionUserId, workspaceId }: Props) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const dateFormat = useTransactionsStore((s) => s.transactionTableSettings.dateFormat);
 const { invalidate, setError } = useWorkspaceActions();
 const [filter, setFilter] = useState<TrashFilter>('transactions');
 const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
 const [busy, setBusy] = useState<number | 'all' | 'rows' | null>(null);

 const { data, isPending, isError, refetch } = useQuery({
  queryKey: queryKeys.trash(sessionUserId, workspaceId),
  queryFn: () => accountingApi.listTrash(),
  staleTime: 0,
  refetchOnMount: 'always',
 });

 const batches = useMemo(() => filterBatches(data?.batches ?? [], filter), [data, filter]);
 const allowPurge = canPurge(role);

 // Names and dates are interpolated into Arabic sentences and may be Latin-script (or the other
 // way round); isolating each keeps bidi reordering from scrambling "name · date" together.
 const isolate = (text: string) => `\u2068${text}\u2069`;
 const nameFor = (userId: string | null) => isolate((userId && data?.users[userId]?.name) || t('audit_unknown_user'));
 // deleted_at is a real timestamp (NOW()), unlike a transaction's wall-clock createdAt, so it
 // goes through the viewer's own locale and timezone.
 const formatDeletedAt = (value: string) => {
  const date = new Date(value);
  return isolate(Number.isFinite(date.getTime()) ? date.toLocaleString(language, { dateStyle: 'medium', timeStyle: 'short' }) : value);
 };

 function toggleExpanded(id: number) {
  setExpandedIds((current) => {
   const next = new Set(current);
   if (next.has(id)) next.delete(id);
   else next.add(id);
   return next;
  });
 }

 // Refreshes the Trash alongside the workspace instead of after it, so the restored rows leave the
 // list as soon as the (small) Trash query answers rather than after the full snapshot reload.
 const reloadAfterRestore = () => Promise.all([invalidate(), refetch()]);

 async function onRestore(batch: TrashBatch) {
  if (batch.pastEditLocked) {
   setError(t('trash_restore_past_locked'));
   return;
  }
  // Putting rows back at or before a reconciled balance changes it, exactly as deleting them
  // did — ask first, and only then send the override the server's backstop requires.
  let override = false;
  if (batch.touchesReconciled) {
   const confirmed = await confirmDialog({ title: t('trash_restore'), message: t('trash_restore_reconciled_confirm'), confirmText: t('trash_restore') });
   if (!confirmed) return;
   override = true;
  }
  setBusy(batch.id);
  const restored = await restoreTrashBatch(batch.id, { override, t, loadData: reloadAfterRestore });
  if (!restored) await refetch();
  setBusy(null);
 }

 // The table's Restore, for one row or a checked selection. Same checks as a batch restore.
 async function onRestoreRows(rows: TrashTransactionRow[]) {
  if (!rows.length) return;
  if (rows.some((row) => row.pastEditLocked)) {
   setError(t('trash_restore_past_locked'));
   return;
  }
  let override = false;
  if (rows.some((row) => row.touchesReconciled)) {
   const confirmed = await confirmDialog({ title: t('trash_restore'), message: t('trash_restore_reconciled_confirm'), confirmText: t('trash_restore') });
   if (!confirmed) return;
   override = true;
  }
  setBusy('rows');
  const restored = await restoreTrashTransactions(
   rows.map((row) => row.id),
   { override, t, loadData: reloadAfterRestore },
  );
  if (!restored) await refetch();
  setBusy(null);
 }

 async function onPurgeRows(rows: TrashTransactionRow[]) {
  if (!rows.length) return;
  const confirmed = await confirmDialog({
   title: t('danger_action_cannot_undo'),
   message: rows.length === 1 ? t('trash_delete_forever_confirm') : t('trash_delete_selected_confirm', { count: rows.length }),
   confirmText: t('trash_delete_forever'),
   tone: 'danger',
  });
  if (!confirmed) return;
  setBusy('rows');
  try {
   await accountingApi.purgeTrash({ transactionIds: rows.map((row) => row.id) });
   setError('');
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_delete'));
  }
  setBusy(null);
  await refetch();
 }

 async function onPurge(batch: TrashBatch) {
  const touchesClients = batch.counts.clients > 0 || batch.counts.accounts > 0;
  const confirmed = await confirmDialog({
   title: t('danger_action_cannot_undo'),
   message: touchesClients ? t('trash_delete_forever_client_confirm') : t('trash_delete_forever_confirm'),
   confirmText: t('trash_delete_forever'),
   tone: 'danger',
  });
  if (!confirmed) return;
  setBusy(batch.id);
  try {
   await accountingApi.purgeTrash({ batchIds: [batch.id] });
   setError('');
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_delete'));
  }
  setBusy(null);
  await refetch();
 }

 async function onEmptyTrash() {
  const confirmed = await confirmDialog({
   title: t('danger_action_cannot_undo'),
   message: t('trash_empty_confirm'),
   confirmText: t('trash_empty'),
   tone: 'danger',
  });
  if (!confirmed) return;
  setBusy('all');
  try {
   await accountingApi.purgeTrash({ all: true });
   setError('');
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_delete'));
  }
  setBusy(null);
  await refetch();
 }

 return (
  <section className={panelClassName}>
   <div className="flex flex-wrap items-start justify-between gap-3">
    <div className="min-w-0">
     <h3 className="text-lg font-semibold text-fg">{t('trash_title')}</h3>
     <p className="mt-1 text-sm text-fg-muted">{t('trash_description', { days: data?.retentionDays ?? 30 })}</p>
    </div>
    {allowPurge && (data?.batches.length ?? 0) > 0 ? (
     <button
      type="button"
      onClick={() => void onEmptyTrash()}
      disabled={busy !== null}
      className="shrink-0 rounded border border-border-strong px-3 py-1.5 text-sm font-semibold text-bad-text transition hover:bg-bad-bg disabled:cursor-not-allowed disabled:opacity-50"
     >
      {t('trash_empty')}
     </button>
    ) : null}
   </div>

   <div className="mt-4 flex flex-wrap gap-2">
    {FILTERS.map(({ key, labelKey }) => (
     <button
      key={key}
      type="button"
      onClick={() => setFilter(key)}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
       filter === key ? 'border-accent bg-accent-weak text-accent' : 'border-border text-fg-muted hover:bg-surface-hover'
      }`}
     >
      {t(labelKey)}
     </button>
    ))}
   </div>

   <div className="mt-4">
    {isPending ? <p className="text-sm text-fg-muted">{t('loading')}</p> : null}
    {isError ? <p className="text-sm text-bad-text">{t('error_failed_load')}</p> : null}
    {data && filter === 'transactions' ? (
     <TrashTransactionsTable
      rows={data.transactions}
      truncated={data.transactionsTruncated}
      role={role}
      sessionUserId={sessionUserId}
      serverNow={data.serverNow}
      retentionDays={data.retentionDays}
      busy={busy !== null}
      nameFor={nameFor}
      formatDeletedAt={formatDeletedAt}
      onRestore={onRestoreRows}
      onPurge={onPurgeRows}
     />
    ) : null}
    {data && filter !== 'transactions' && batches.length === 0 ? <p className="text-sm text-fg-faint">{t('trash_nothing')}</p> : null}

    {filter !== 'transactions' && batches.length > 0 ? (
     <ul className="flex flex-col gap-3">
      {batches.map((batch) => {
       // batches is only non-empty once data has loaded, so serverNow is always there.
       const days = daysRemaining(batch.deletedAt, data?.serverNow ?? '', data?.retentionDays ?? 30);
       const expanded = expandedIds.has(batch.id);
       const allowRestore = canRestoreBatch(role, sessionUserId, batch);
       const isBusy = busy === batch.id || busy === 'all';
       const showCounts = batch.kind === 'client' || batch.kind === 'client_account' || batch.kind === 'all_clients';
       return (
        <li key={batch.id} className="rounded border border-border bg-surface p-3">
         <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
           <p className="wrap-break-word text-sm font-semibold text-fg">{batchTitle(batch, t)}</p>
           <p className="mt-0.5 text-xs text-fg-faint">{t('trash_deleted_by', { user: nameFor(batch.deletedBy), date: formatDeletedAt(batch.deletedAt) })}</p>
           {showCounts ? (
            <p className="mt-0.5 text-xs text-fg-muted">{t('trash_counts', { accounts: batch.counts.accounts, transactions: batch.counts.transactions })}</p>
           ) : null}
          </div>
          <span
           className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
            isExpiringSoon(days) ? 'bg-warn-bg text-warn-text' : 'bg-surface-2 text-fg-muted'
           }`}
          >
           {days === 0 ? t('trash_expires_today') : t('trash_days_left', { count: days })}
          </span>
         </div>

         {batch.blockedCount > 0 ? (
          <p className="mt-2 text-xs text-warn-text">
           {batch.blockedBy.length
            ? t('trash_blocked_restore_first', { count: batch.blockedCount, names: batch.blockedBy.map(isolate).join(', ') })
            : t('trash_blocked_generic', { count: batch.blockedCount })}
          </p>
         ) : null}
         {batch.pastEditLocked ? <p className="mt-2 text-xs text-warn-text">{t('trash_restore_past_locked')}</p> : null}
         {batch.touchesReconciled && !batch.pastEditLocked ? <p className="mt-2 text-xs text-fg-muted">{t('trash_touches_reconciled')}</p> : null}

         <div className="mt-3 flex flex-wrap items-center gap-2">
          {allowRestore ? (
           <button
            type="button"
            onClick={() => void onRestore(batch)}
            disabled={isBusy || batch.pastEditLocked}
            className="rounded border border-accent bg-accent px-3 py-1.5 text-xs font-semibold text-accent-contrast transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
           >
            {t('trash_restore')}
           </button>
          ) : null}
          {allowPurge ? (
           <button
            type="button"
            onClick={() => void onPurge(batch)}
            disabled={isBusy}
            className="rounded border border-border-strong px-3 py-1.5 text-xs font-semibold text-bad-text transition hover:bg-bad-bg disabled:cursor-not-allowed disabled:opacity-50"
           >
            {t('trash_delete_forever')}
           </button>
          ) : null}
          {batch.preview.length > 0 ? (
           <button type="button" onClick={() => toggleExpanded(batch.id)} className="ms-auto text-xs font-medium text-accent hover:underline">
            {expanded ? t('trash_hide_rows') : t('trash_show_rows')}
           </button>
          ) : null}
         </div>

         {expanded ? (
          <ul className="mt-3 flex flex-col divide-y divide-border border-t border-border">
           {batch.preview.map((row) => {
            const from = row.clientFromName || row.counterParty || '—';
            const to = row.clientToName || (row.clientFromName ? row.counterParty : '') || '—';
            return (
             <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5 text-xs">
              <span className="min-w-0 text-fg">
               <span className="text-fg-faint">{formatDateValue(row.createdAt, dateFormat)}</span> · {from} → {to}
               {row.description ? <span className="text-fg-muted"> · {row.description}</span> : null}
              </span>
              <span dir="ltr" className="shrink-0 font-semibold tabular-nums text-fg">
               {Number(row.amount).toLocaleString('en-US', { maximumFractionDigits: 2 })} {row.currencyCode}
              </span>
             </li>
            );
           })}
           {batch.counts.transactions > batch.preview.length ? (
            <li className="py-1.5 text-xs text-fg-faint">{t('trash_more_rows', { count: batch.counts.transactions - batch.preview.length })}</li>
           ) : null}
          </ul>
         ) : null}
        </li>
       );
      })}
     </ul>
    ) : null}
   </div>
  </section>
 );
}
