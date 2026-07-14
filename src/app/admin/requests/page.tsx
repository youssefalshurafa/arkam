'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStableSession } from '@/hooks/useStableSession';
import { alertDialog, confirmDialog, promptDialog } from '@/components/ui/AppDialog';
import { getSubscriptionState } from '@/app/admin/subscription';
import { useAdminI18n } from '../_ui/useAdminI18n';
import { Icon } from '../_ui/icons';
import { RequestStatusBadge, RowMenu, StateBlock, SubscriptionBadge } from '../_ui/primitives';
import { formatDate, formatDateTime } from '../_lib/format';
import type { AccessRequest } from '../_lib/types';

type ReviewAction = 'approve' | 'reject' | 'renew' | 'setDays';

export default function AdminRequestsPage() {
 const { status } = useStableSession();
 const router = useRouter();
 const { t, language } = useAdminI18n();

 const [requests, setRequests] = useState<AccessRequest[]>([]);
 const [loading, setLoading] = useState(true);
 const [reviewingId, setReviewingId] = useState<string | null>(null);

 const fetchRequests = useCallback(async () => {
  setLoading(true);
  try {
   const res = await fetch('/api/admin/access-requests');
   if (!res.ok) return;
   const data = (await res.json()) as { requests: AccessRequest[] };
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

 const review = async (request: AccessRequest, action: ReviewAction) => {
  let note = '';
  let days: number | undefined;
  if (action === 'reject') {
   const reason = await promptDialog({ title: t('admin_rq_reject_title'), message: t('admin_rq_reject_msg') });
   if (reason === null) return;
   note = reason;
  } else if (action === 'approve') {
   if (!(await confirmDialog({ message: t('admin_rq_approve_confirm').replace('{name}', request.name).replace('{email}', request.email) }))) return;
  } else if (action === 'renew') {
   if (!(await confirmDialog({ message: t('admin_rq_renew_confirm').replace('{name}', request.name) }))) return;
  } else if (action === 'setDays') {
   const currentDaysLeft = getSubscriptionState(request.subscriptionEndsAt).daysLeft;
   const input = await promptDialog({
    title: t('admin_rq_setdays_title'),
    message: t('admin_rq_setdays_msg').replace('{name}', request.name).replace('{email}', request.email),
    defaultValue: currentDaysLeft != null && currentDaysLeft > 0 ? String(currentDaysLeft) : '30',
    placeholder: t('admin_rq_setdays_ph'),
   });
   if (input === null) return;
   const parsed = Number(input.trim());
   if (!Number.isFinite(parsed) || parsed < 0) {
    await alertDialog({ title: t('admin_err_title'), message: t('admin_rq_days_nonneg') });
    return;
   }
   days = parsed;
  }

  setReviewingId(request.id);
  try {
   const res = await fetch('/api/admin/access-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: request.id, userId: request.userId, action, note, days }),
   });
   const data = (await res.json()) as { ok?: boolean; status?: string; subscriptionEndsAt?: string; error?: string };
   if (!res.ok || !data.ok) {
    await alertDialog({ title: t('admin_err_title'), message: data.error || t('admin_rq_update_failed') });
    return;
   }
   void fetchRequests();
  } catch {
   await alertDialog({ title: t('admin_err_title'), message: t('admin_err_network') });
  } finally {
   setReviewingId(null);
  }
 };

 const { pending, expired, soon } = useMemo(() => {
  let e = 0;
  let s = 0;
  for (const r of requests) {
   if (r.status !== 'approved') continue;
   const st = getSubscriptionState(r.subscriptionEndsAt);
   if (st.tone === 'expired') e += 1;
   else if (st.tone === 'soon') s += 1;
  }
  return { pending: requests.filter((r) => r.status === 'pending').length, expired: e, soon: s };
 }, [requests]);

 return (
  <>
   {(expired > 0 || soon > 0) && (
    <div className="ad-row ad-wrap">
     {expired > 0 && (
      <div className="ad-note warn" style={{ flex: 1, minWidth: 220 }}>
       <Icon name="warning" />
       {t('admin_req_expired_banner').replace('{count}', String(expired))}
      </div>
     )}
     {soon > 0 && (
      <div className="ad-note info" style={{ flex: 1, minWidth: 220 }}>
       <Icon name="clock" />
       {t('admin_req_soon_banner').replace('{count}', String(soon))}
      </div>
     )}
    </div>
   )}

   <div className="ad-toolbar">
    <div className="ad-spacer" />
    <span className="ad-faint" style={{ fontSize: 12 }}>
     {t('admin_pending_count').replace('{count}', String(pending))}
    </span>
    <button className="ad-btn" onClick={() => void fetchRequests()}>
     <Icon name="refresh" />
     {t('admin_refresh')}
    </button>
   </div>

   <div className="ad-card ad-table-wrap">
    {loading ? (
     <StateBlock>{t('admin_loading')}</StateBlock>
    ) : requests.length === 0 ? (
     <StateBlock>{t('admin_no_requests')}</StateBlock>
    ) : (
     <table className="ad-table hover">
      <thead>
       <tr>
        <th>{t('admin_col_user')}</th>
        <th>{t('admin_col_plan')}</th>
        <th>{t('admin_col_paid')}</th>
        <th>{t('admin_col_sub')}</th>
        <th>{t('admin_col_proof')}</th>
        <th className="center">{t('admin_col_status')}</th>
        <th />
       </tr>
      </thead>
      <tbody>
       {requests.map((r) => {
        const sub = getSubscriptionState(r.subscriptionEndsAt);
        const busy = reviewingId === r.id;
        return (
         <tr key={r.id} style={{ verticalAlign: 'top' }}>
          <td>
           <div className="ad-u-name">{r.name}</div>
           <div className="ad-u-email">{r.email}</div>
           {r.company && <div className="ad-muted" style={{ fontSize: 12, marginTop: 2 }}>{r.company}</div>}
           {(r.phone || r.country) && <div className="ad-faint" style={{ fontSize: 12 }}>{[r.phone, r.country].filter(Boolean).join(' · ')}</div>}
           {r.txReference && <div className="ad-faint" style={{ fontSize: 12, marginTop: 2, wordBreak: 'break-all' }}>tx: {r.txReference}</div>}
          </td>
          <td>
           {r.plan && <div className="ad-u-name">{r.plan}</div>}
           <div className="ad-muted">{r.amount || '—'}</div>
           <div className="ad-faint" style={{ fontSize: 12 }}>{r.network}</div>
          </td>
          <td className="ad-muted ad-num" style={{ whiteSpace: 'nowrap' }}>{formatDate(r.createdAt, language)}</td>
          <td>
           {r.subscriptionEndsAt ? (
            <>
             <SubscriptionBadge endsAt={r.subscriptionEndsAt} />
             <div className="ad-faint ad-num" style={{ fontSize: 12, marginTop: 4, whiteSpace: 'nowrap' }}>
              {t('admin_ends_label')} {formatDateTime(r.subscriptionEndsAt, language)}
             </div>
            </>
           ) : (
            <span className="ad-faint">—</span>
           )}
          </td>
          <td>
           {r.hasProof ? (
            <a href={`/api/admin/access-requests/${r.id}/proof`} target="_blank" rel="noopener noreferrer" className="ad-link" style={{ margin: 0 }}>
             {t('admin_view_proof')}
            </a>
           ) : (
            <span className="ad-faint">—</span>
           )}
          </td>
          <td className="center">
           <RequestStatusBadge status={r.status} t={t} />
           {r.status === 'rejected' && r.note && <div className="ad-faint" style={{ fontSize: 12, marginTop: 4 }}>{r.note}</div>}
          </td>
          <td className="end">
           {r.status === 'pending' ? (
            <div className="ad-row" style={{ justifyContent: 'flex-end', gap: 8 }}>
             <button className="ad-btn sm good" disabled={busy} onClick={() => void review(r, 'approve')}>
              {t('admin_approve')}
             </button>
             <button className="ad-btn sm outline-danger" disabled={busy} onClick={() => void review(r, 'reject')}>
              {t('admin_reject')}
             </button>
            </div>
           ) : r.status === 'approved' ? (
            <div className="ad-row" style={{ justifyContent: 'flex-end', gap: 8 }}>
             <button className="ad-btn sm info" disabled={busy} onClick={() => void review(r, 'renew')}>
              {sub.tone === 'expired' ? t('admin_renew') : t('admin_extend')}
             </button>
             <RowMenu
              items={[
               { label: t('admin_set_days'), icon: 'clock', onClick: () => void review(r, 'setDays') },
               { label: t('admin_deactivate'), icon: 'x', danger: true, onClick: () => void review(r, 'reject') },
              ]}
             />
            </div>
           ) : (
            <div className="ad-row" style={{ justifyContent: 'flex-end', gap: 8 }}>
             <button className="ad-btn sm good" disabled={busy} onClick={() => void review(r, 'renew')}>
              {t('admin_reactivate')}
             </button>
             <RowMenu items={[{ label: t('admin_set_days'), icon: 'clock', onClick: () => void review(r, 'setDays') }]} />
            </div>
           )}
          </td>
         </tr>
        );
       })}
      </tbody>
     </table>
    )}
   </div>
  </>
 );
}
