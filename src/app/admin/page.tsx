'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useStableSession } from '@/hooks/useStableSession';
import { getSubscriptionState } from '@/app/admin/subscription';
import { useAdminI18n } from './_ui/useAdminI18n';
import { Icon } from './_ui/icons';
import { Avatar, KpiCard, StateBlock } from './_ui/primitives';
import { formatDate } from './_lib/format';
import type { AdminUser, AccessRequest, PasswordResetRequest } from './_lib/types';

// Landing dashboard for the admin panel: the headline counts, an "at a glance"
// attention row (pending queues + expired subs) that deep-links into the relevant
// screen, and the most recent signups. Everything is derived from the same three
// admin endpoints the individual screens use.
export default function AdminOverviewPage() {
 const { status } = useStableSession();
 const router = useRouter();
 const { t, language } = useAdminI18n();

 const [users, setUsers] = useState<AdminUser[]>([]);
 const [requests, setRequests] = useState<AccessRequest[]>([]);
 const [resets, setResets] = useState<PasswordResetRequest[]>([]);
 const [loading, setLoading] = useState(true);
 const [forbidden, setForbidden] = useState(false);

 useEffect(() => {
  if (status === 'unauthenticated') router.replace('/login');
 }, [status, router]);

 const load = useCallback(async () => {
  setLoading(true);
  try {
   const [uRes, rRes, pRes] = await Promise.all([
    fetch('/api/admin/users'),
    fetch('/api/admin/access-requests'),
    fetch('/api/admin/password-reset-requests?status=pending'),
   ]);
   if (uRes.status === 403) {
    setForbidden(true);
    return;
   }
   const u = uRes.ok ? ((await uRes.json()) as { users: AdminUser[] }).users : [];
   const r = rRes.ok ? ((await rRes.json()) as { requests: AccessRequest[] }).requests : [];
   const p = pRes.ok ? ((await pRes.json()) as { requests: PasswordResetRequest[] }).requests : [];
   setUsers(u);
   setRequests(r);
   setResets(p);
  } catch {
   /* surfaced via empty state */
  } finally {
   setLoading(false);
  }
 }, []);

 useEffect(() => {
  if (status === 'authenticated') void load();
 }, [status, load]);

 const stats = useMemo(() => {
  const totalWorkspaces = users.reduce((s, u) => s + u.workspaceCount, 0);
  let active = 0;
  let expiring = 0;
  let expired = 0;
  for (const r of requests) {
   if (r.status !== 'approved') continue;
   const s = getSubscriptionState(r.subscriptionEndsAt);
   if (s.tone === 'active' || s.tone === 'soon') active += 1;
   if (s.tone === 'soon') expiring += 1;
   if (s.tone === 'expired') expired += 1;
  }
  const pendingRequests = requests.filter((r) => r.status === 'pending').length;
  return { totalUsers: users.length, totalWorkspaces, active, expiring, expired, pendingRequests, pendingResets: resets.length };
 }, [users, requests, resets]);

 const recentUsers = useMemo(
  () => [...users].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 6),
  [users],
 );

 if (status === 'loading' || loading) {
  return <StateBlock>{t('admin_loading')}</StateBlock>;
 }
 if (forbidden) {
  return <StateBlock>🚫 {t('admin_no_users')}</StateBlock>;
 }

 const attention = [
  { key: 'requests', tone: 'warn' as const, icon: 'requests' as const, n: stats.pendingRequests, label: t('admin_attn_requests'), href: '/admin/requests' },
  { key: 'resets', tone: 'info' as const, icon: 'resets' as const, n: stats.pendingResets, label: t('admin_attn_resets'), href: '/admin/resets' },
  { key: 'expired', tone: 'bad' as const, icon: 'warning' as const, n: stats.expired, label: t('admin_attn_expired'), href: '/admin/subscriptions' },
 ].filter((a) => a.n > 0);

 return (
  <>
   <div className="ad-kpi-grid">
    <KpiCard icon="users" label={t('admin_kpi_users')} value={stats.totalUsers} />
    <KpiCard icon="check" tone="good" label={t('admin_kpi_active')} value={stats.active} />
    <KpiCard icon="clock" tone="warn" label={t('admin_kpi_expiring')} value={stats.expiring} />
    <KpiCard icon="building" label={t('admin_kpi_ws')} value={stats.totalWorkspaces} />
   </div>

   <div>
    <div className="ad-section-head">
     <span className="ad-eyebrow">{t('admin_attn_title')}</span>
    </div>
    {attention.length === 0 ? (
     <div className="ad-note info">
      <Icon name="check" />
      {t('admin_ov_all_clear')}
     </div>
    ) : (
     <div className="ad-attn-grid">
      {attention.map((a) => (
       <Link key={a.key} href={a.href} className={`ad-attn ${a.tone}`}>
        <div className="ad-attn-ic">
         <Icon name={a.icon} />
        </div>
        <div>
         <div className="ad-attn-n ad-num">{a.n}</div>
         <div className="ad-attn-l">{a.label}</div>
        </div>
        <div className="ad-attn-go">
         <Icon name="chevron" width={18} height={18} strokeWidth={2} />
        </div>
       </Link>
      ))}
     </div>
    )}
   </div>

   <div className="ad-card">
    <div className="ad-panel-head">
     <span className="ad-section-title">{t('admin_recent_users')}</span>
     <Link href="/admin/users" className="ad-link">
      {t('admin_view_all')}
     </Link>
    </div>
    {recentUsers.length === 0 ? (
     <StateBlock>{t('admin_no_users')}</StateBlock>
    ) : (
     <div className="ad-table-wrap">
      <table className="ad-table hover">
       <tbody>
        {recentUsers.map((u) => (
         <tr key={u.id} className="clickable" onClick={() => router.push(`/admin/users/${u.id}`)}>
          <td>
           <div className="ad-u-cell">
            <Avatar name={u.name} image={u.image} id={u.id} size={32} />
            <div>
             <div className="ad-u-name">{u.name}</div>
             <div className="ad-u-email">{u.email}</div>
            </div>
           </div>
          </td>
          <td className="ad-muted ad-num" style={{ whiteSpace: 'nowrap' }}>
           {formatDate(u.createdAt, language)}
          </td>
          <td className="end">
           {u.workspaceCount > 0 ? <span className="ad-ws-pill ad-num">{u.workspaceCount}</span> : <span className="ad-faint">—</span>}
          </td>
         </tr>
        ))}
       </tbody>
      </table>
     </div>
    )}
   </div>
  </>
 );
}
