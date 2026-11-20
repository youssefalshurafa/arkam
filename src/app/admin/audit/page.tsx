'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStableSession } from '@/hooks/useStableSession';
import { useAdminI18n } from '../_ui/useAdminI18n';
import { Icon, type IconName } from '../_ui/icons';
import { Avatar, StateBlock } from '../_ui/primitives';
import { formatDateTime } from '../_lib/format';

type AuditEvent = {
 kind: 'admin' | 'login' | 'security';
 id: string;
 actorEmail: string | null;
 action: string;
 targetUserId: string | null;
 targetEmail: string | null;
 targetName: string | null;
 meta: Record<string, unknown> | null;
 createdAt: string;
};

type Filter = 'all' | 'admin' | 'login' | 'security';

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
 setup_link: { icon: 'key', tone: 'info' },
 reset_mfa: { icon: 'key', tone: 'bad' },
 unlock: { icon: 'key', tone: 'neutral' },
 unlock_failed: { icon: 'warning', tone: 'bad' },
 login_failed: { icon: 'warning', tone: 'bad' },
 login_locked: { icon: 'warning', tone: 'bad' },
 mfa_failed: { icon: 'warning', tone: 'bad' },
 mfa_locked: { icon: 'warning', tone: 'bad' },
 mfa_enabled: { icon: 'check', tone: 'good' },
 mfa_disabled: { icon: 'x', tone: 'bad' },
 mfa_backup_code_used: { icon: 'key', tone: 'info' },
 password_changed: { icon: 'key', tone: 'info' },
 password_reset: { icon: 'key', tone: 'info' },
 password_setup: { icon: 'key', tone: 'good' },
 password_reset_requested: { icon: 'key', tone: 'neutral' },
 support_reset_requested: { icon: 'key', tone: 'neutral' },
 email_changed: { icon: 'user', tone: 'info' },
 email_verified: { icon: 'check', tone: 'good' },
 signup: { icon: 'user', tone: 'good' },
 sessions_revoked: { icon: 'login', tone: 'info' },
 admin_unlock: { icon: 'key', tone: 'neutral' },
 admin_unlock_failed: { icon: 'warning', tone: 'bad' },
 admin_unlock_locked: { icon: 'warning', tone: 'bad' },
 google_login_refused: { icon: 'warning', tone: 'bad' },
 google_link_password_removed: { icon: 'warning', tone: 'info' },
 invite_created: { icon: 'user', tone: 'info' },
 invite_accepted: { icon: 'check', tone: 'good' },
};

function metaSuffix(ev: AuditEvent): string | null {
 const m = ev.meta;
 if (!m) return null;
 if (typeof m.days === 'number') return `${m.days}d`;
 if (typeof m.durationDays === 'number') return `+${m.durationDays}d`;
 if (typeof m.slot === 'string') return m.slot;
 if (typeof m.note === 'string' && m.note) return m.note;
 if (typeof m.method === 'string') return m.method;
 if (typeof m.reason === 'string') return m.reason;
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
  () => ({
   all: events.length,
   admin: events.filter((e) => e.kind === 'admin').length,
   login: events.filter((e) => e.kind === 'login').length,
   security: events.filter((e) => e.kind === 'security').length,
  }),
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
  { key: 'security', labelKey: 'admin_audit_filter_security', count: counts.security },
 ];

 return (
  <>
   <div className="acp-toolbar">
    <div className="acp-chips">
     {chips.map((c) => (
      <button key={c.key} className={`acp-chip ${filter === c.key ? 'active' : ''}`} onClick={() => setFilter(c.key)}>
       {t(c.labelKey)} <span className="cnt acp-num">{c.count}</span>
      </button>
     ))}
    </div>
    <div className="acp-spacer" />
    <button className="acp-btn" onClick={() => void load()}>
     <Icon name="refresh" />
     {t('admin_refresh')}
    </button>
   </div>

   <div className="acp-card acp-table-wrap">
    {loading ? (
     <StateBlock>{t('admin_loading')}</StateBlock>
    ) : rows.length === 0 ? (
     <StateBlock>{t('admin_audit_empty')}</StateBlock>
    ) : (
     <table className="acp-table hover">
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
           <div className="acp-row" style={{ gap: 10 }}>
            <div className={`acp-act-ic ${style.tone}`}>
             <Icon name={style.icon} />
            </div>
            <div>
             <div className="acp-u-name">{actionLabel(ev.action)}</div>
             {suffix && <div className="acp-faint" style={{ fontSize: 11.5 }}>{suffix}</div>}
            </div>
           </div>
          </td>
          <td>
           {ev.targetName || ev.targetEmail ? (
            <div className="acp-u-cell">
             <Avatar name={ev.targetName || ev.targetEmail || '?'} id={ev.targetUserId || ev.targetEmail || ''} size={28} />
             <div>
              <div className="acp-u-name">{ev.targetName || ev.targetEmail}</div>
              {ev.targetName && ev.targetEmail && <div className="acp-u-email">{ev.targetEmail}</div>}
             </div>
            </div>
           ) : (
            <span className="acp-faint">—</span>
           )}
          </td>
          <td className="acp-muted" style={{ fontSize: 12.5 }}>
           {ev.kind === 'login' ? (
            <span className="acp-faint">—</span>
           ) : ev.kind === 'security' ? (
            <span className="acp-faint acp-num" dir="ltr">{typeof ev.meta?.ip === 'string' ? ev.meta.ip : '—'}</span>
           ) : (
            ev.actorEmail || t('admin_audit_system')
           )}
          </td>
          <td className="acp-muted acp-num" style={{ whiteSpace: 'nowrap' }}>
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
