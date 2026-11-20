'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useStableSession } from '@/hooks/useStableSession';
import { alertDialog, confirmDialog } from '@/components/ui/AppDialog';
import { useAdminI18n } from '../_ui/useAdminI18n';
import { Icon } from '../_ui/icons';
import { RequestStatusBadge, LinkDialog, StateBlock } from '../_ui/primitives';
import { formatDate, formatDateTime } from '../_lib/format';
import type { PasswordResetRequest } from '../_lib/types';

export default function AdminResetsPage() {
 const { status } = useStableSession();
 const router = useRouter();
 const { t, language } = useAdminI18n();

 const [requests, setRequests] = useState<PasswordResetRequest[]>([]);
 const [loading, setLoading] = useState(true);
 const [reviewingId, setReviewingId] = useState<string | null>(null);
 const [resetLink, setResetLink] = useState<string | null>(null);

 const fetchRequests = useCallback(async () => {
  setLoading(true);
  try {
   const res = await fetch('/api/admin/password-reset-requests?status=pending');
   if (!res.ok) return;
   const data = (await res.json()) as { requests: PasswordResetRequest[] };
   setRequests(data.requests);
  } catch {
   /* empty state */
  } finally {
   setLoading(false);
  }
 }, []);

 useEffect(() => {
  if (status === 'unauthenticated') router.replace('/login');
 }, [status, router]);
 useEffect(() => {
  if (status === 'authenticated') void fetchRequests();
 }, [status, fetchRequests]);

 const review = async (request: PasswordResetRequest, action: 'approve' | 'reject') => {
  if (action === 'approve') {
   const confirmed = await confirmDialog({
    title: t('admin_rs_approve_title'),
    message: t('admin_rs_approve_msg')
     .replace('{name}', request.name)
     .replace('{email}', request.email)
     .replace('{phone}', request.phone ? ` (${request.phone})` : ''),
   });
   if (!confirmed) return;
  } else if (!(await confirmDialog({ message: t('admin_rs_reject_confirm').replace('{name}', request.name).replace('{email}', request.email) }))) {
   return;
  }

  setReviewingId(request.id);
  try {
   const res = await fetch('/api/admin/password-reset-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: request.id, action }),
   });
   const data = (await res.json()) as { ok?: boolean; resetLink?: string | null; error?: string };
   if (!res.ok || !data.ok) {
    await alertDialog({ title: t('admin_err_title'), message: data.error || t('admin_rs_review_failed') });
    return;
   }
   setRequests((prev) => prev.filter((r) => r.id !== request.id));
   if (action === 'approve' && data.resetLink) setResetLink(data.resetLink);
  } catch {
   await alertDialog({ title: t('admin_err_title'), message: t('admin_err_network') });
  } finally {
   setReviewingId(null);
  }
 };

 const pending = useMemo(() => requests.filter((r) => r.status === 'pending').length, [requests]);

 return (
  <>
   <div className="acp-note info">
    <Icon name="info" />
    {t('admin_reset_verify_note')}
   </div>

   <div className="acp-toolbar">
    <div className="acp-spacer" />
    <span className="acp-faint" style={{ fontSize: 12 }}>
     {t('admin_pending_count').replace('{count}', String(pending))}
    </span>
    <button className="acp-btn" onClick={() => void fetchRequests()}>
     <Icon name="refresh" />
     {t('admin_refresh')}
    </button>
   </div>

   <div className="acp-card acp-table-wrap">
    {loading ? (
     <StateBlock>{t('admin_loading')}</StateBlock>
    ) : requests.length === 0 ? (
     <StateBlock>{t('admin_no_resets')}</StateBlock>
    ) : (
     <table className="acp-table hover">
      <thead>
       <tr>
        <th>{t('admin_col_user')}</th>
        <th>{t('admin_col_contact')}</th>
        <th>{t('admin_col_note')}</th>
        <th>{t('admin_col_requested')}</th>
        <th className="center">{t('admin_col_status')}</th>
        <th />
       </tr>
      </thead>
      <tbody>
       {requests.map((r) => (
        <tr key={r.id} style={{ verticalAlign: 'top' }}>
         <td>
          <div className="acp-u-name">{r.name}</div>
          <div className="acp-u-email">{r.email}</div>
         </td>
         <td>
          {r.phone ? (
           <span className="acp-u-name">{r.phone}</span>
          ) : (
           <span className="acp-badge warn" style={{ whiteSpace: 'normal' }}>
            {t('admin_no_contact')} —{' '}
            <Link href={`/admin/users/${r.userId}`} className="acp-link" style={{ margin: 0 }}>
             {t('admin_add_contact')}
            </Link>
           </span>
          )}
         </td>
         <td className="acp-muted">{r.note || <span className="acp-faint">—</span>}</td>
         <td className="acp-muted acp-num" style={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.createdAt, language)}</td>
         <td className="center">
          <RequestStatusBadge status={r.status} t={t} />
         </td>
         <td className="end">
          {r.status === 'pending' ? (
           <div className="acp-row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button className="acp-btn sm good" disabled={reviewingId === r.id} onClick={() => void review(r, 'approve')}>
             {t('admin_approve')}
            </button>
            <button className="acp-btn sm outline-danger" disabled={reviewingId === r.id} onClick={() => void review(r, 'reject')}>
             {t('admin_reject')}
            </button>
           </div>
          ) : (
           <span className="acp-faint" style={{ fontSize: 12 }}>
            {t('admin_reviewed')} {r.reviewedAt ? formatDate(r.reviewedAt, language) : ''}
           </span>
          )}
         </td>
        </tr>
       ))}
      </tbody>
     </table>
    )}
   </div>

   {resetLink && (
    <LinkDialog title={t('admin_reset_link_title')} description={t('admin_reset_link_desc')} links={[{ url: resetLink }]} onClose={() => setResetLink(null)} />
   )}
  </>
 );
}
