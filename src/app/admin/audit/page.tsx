'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStableSession } from '@/hooks/useStableSession';
import { useAdminI18n } from '../_ui/useAdminI18n';
import { Icon, type IconName } from '../_ui/icons';
import { Avatar, StateBlock } from '../_ui/primitives';
import { formatDateTime } from '../_lib/format';

type AuditEvent = {
 kind: 'admin' | 'login';
 id: string;
 actorEmail: string | null;
 action: string;
 targetUserId: string | null;
 targetEmail: string | null;
 targetName: string | null;
 meta: Record<string, unknown> | null;
 createdAt: string;
};

type Filter = 'all' | 'admin' | 'login';

// Icon + tone for each logged action, so the event type reads at a glance.
const ACTION_STYLE: Record<string, { icon: IconName; tone: 'good' | 'bad' | 'info' | 'neutral' }> = {
 approve_request: { icon: 'check', tone: 'good' },
 reject_request: { icon: 'x', tone: 'bad' },
 renew_subscription: { icon: 'refresh', tone: 'info' },
 set_days: { icon: 'clock', tone: 'info' },
 create_user: { icon: 'user', tone: 'good' },
 delete_user: { icon: 'trash', tone: 'bad' },
 reset_password: { icon: 'key', tone: 'neutral' },
 approve_reset: { icon: 'check', tone: 'good' },
 reject_reset: { icon: 'x', tone: 'bad' },
 upload_image: { icon: 'images', tone: 'info' },
 remove_image: { icon: 'images', tone: 'bad' },
 login: { icon: 'login', tone: 'neutral' },
};

function metaSuffix(ev: AuditEvent): string | null {
 const m = ev.meta;
 if (!m) return null;
 if (typeof m.days === 'number') return `${m.days}d`;
 if (typeof m.durationDays === 'number') return `+${m.durationDays}d`;
 if (typeof m.slot === 'string') return m.slot;
 if (typeof m.note === 'string' && m.note) return m.note;
 return null;
}

export default function AdminAuditPage() {
 const { status } = useStableSession();
 const router = useRouter();
 const { t, language } = useAdminI18n();

 const [events, setEvents] = useState<AuditEvent[]>([]);
 const [loading, setLoading] = useState(true);
 const [filter, setFilter] = useState<Filter>('all');

 const load = useCallback(async () => {
  setLoading(true);
  try {
   const res = await fetch('/api/admin/audit');
   if (!res.ok) return;
   const data = (await res.json()) as { events: AuditEvent[] };
   setEvents(data.events);
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
  if (status === 'authenticated') void load();
 }, [status, load]);

 const counts = useMemo(
  () => ({ all: events.length, admin: events.filter((e) => e.kind === 'admin').length, login: events.filter((e) => e.kind === 'login').length }),
  [events],
 );
 const rows = useMemo(() => (filter === 'all' ? events : events.filter((e) => e.kind === filter)), [events, filter]);

 const actionLabel = (action: string) => {
  const key = `admin_action_${action}`;
  const val = t(key);
  return val === key ? action : val;
 };

 const chips: { key: Filter; labelKey: string; count: number }[] = [
  { key: 'all', labelKey: 'admin_filter_all', count: counts.all },
  { key: 'admin', labelKey: 'admin_audit_filter_admin', count: counts.admin },
  { key: 'login', labelKey: 'admin_audit_filter_login', count: counts.login },
 ];

 return (
  <>
   <div className="ad-toolbar">
    <div className="ad-chips">
     {chips.map((c) => (
      <button key={c.key} className={`ad-chip ${filter === c.key ? 'active' : ''}`} onClick={() => setFilter(c.key)}>
       {t(c.labelKey)} <span className="cnt ad-num">{c.count}</span>
      </button>
     ))}
    </div>
    <div className="ad-spacer" />
    <button className="ad-btn" onClick={() => void load()}>
     <Icon name="refresh" />
     {t('admin_refresh')}
    </button>
   </div>

   <div className="ad-card ad-table-wrap">
    {loading ? (
     <StateBlock>{t('admin_loading')}</StateBlock>
    ) : rows.length === 0 ? (
     <StateBlock>{t('admin_audit_empty')}</StateBlock>
    ) : (
     <table className="ad-table hover">
      <thead>
       <tr>
        <th>{t('admin_audit_col_action')}</th>
        <th>{t('admin_audit_col_target')}</th>
        <th>{t('admin_audit_col_actor')}</th>
        <th>{t('admin_audit_col_when')}</th>
       </tr>
      </thead>
      <tbody>
       {rows.map((ev) => {
        const style = ACTION_STYLE[ev.action] || { icon: 'audit' as IconName, tone: 'neutral' as const };
        const suffix = metaSuffix(ev);
        const canOpen = Boolean(ev.targetUserId);
        return (
         <tr key={ev.id} className={canOpen ? 'clickable' : ''} onClick={() => canOpen && router.push(`/admin/users/${ev.targetUserId}`)}>
          <td>
           <div className="ad-row" style={{ gap: 10 }}>
            <div className={`ad-act-ic ${style.tone}`}>
             <Icon name={style.icon} />
            </div>
            <div>
             <div className="ad-u-name">{actionLabel(ev.action)}</div>
             {suffix && <div className="ad-faint" style={{ fontSize: 11.5 }}>{suffix}</div>}
            </div>
           </div>
          </td>
          <td>
           {ev.targetName || ev.targetEmail ? (
            <div className="ad-u-cell">
             <Avatar name={ev.targetName || ev.targetEmail || '?'} id={ev.targetUserId || ev.targetEmail || ''} size={28} />
             <div>
              <div className="ad-u-name">{ev.targetName || ev.targetEmail}</div>
              {ev.targetName && ev.targetEmail && <div className="ad-u-email">{ev.targetEmail}</div>}
             </div>
            </div>
           ) : (
            <span className="ad-faint">—</span>
           )}
          </td>
          <td className="ad-muted" style={{ fontSize: 12.5 }}>
           {ev.kind === 'login' ? <span className="ad-faint">—</span> : ev.actorEmail || t('admin_audit_system')}
          </td>
          <td className="ad-muted ad-num" style={{ whiteSpace: 'nowrap' }}>
           {formatDateTime(ev.createdAt, language)}
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
