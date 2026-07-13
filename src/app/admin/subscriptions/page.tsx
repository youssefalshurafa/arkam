'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStableSession } from '@/hooks/useStableSession';
import { alertDialog, confirmDialog, promptDialog } from '@/components/ui/AppDialog';
import { getSubscriptionState, type SubscriptionTone } from '@/app/admin/subscription';
import { useAdminI18n } from '../_ui/useAdminI18n';
import { Icon } from '../_ui/icons';
import { Avatar, SubscriptionBadge, RowMenu, Check, StateBlock } from '../_ui/primitives';
import { formatDateTime } from '../_lib/format';
import { renewSubscription, setSubscriptionDays } from '../_lib/subscriptionApi';
import type { AdminUser } from '../_lib/types';

type Filter = 'all' | 'active' | 'expiring' | 'expired' | 'none';

const RENEW_OPTIONS = [
 { labelKey: 'admin_ud_renew_30', days: 30 },
 { labelKey: 'admin_ud_renew_180', days: 180 },
 { labelKey: 'admin_ud_renew_365', days: 365 },
];

// Maps a subscription tone to the filter bucket it belongs to.
const toneToFilter = (tone: SubscriptionTone): Exclude<Filter, 'all'> => (tone === 'soon' ? 'expiring' : tone);

export default function AdminSubscriptionsPage() {
 const { status } = useStableSession();
 const router = useRouter();
 const { t, language } = useAdminI18n();

 const [users, setUsers] = useState<AdminUser[]>([]);
 const [loading, setLoading] = useState(true);
 const [filter, setFilter] = useState<Filter>('all');
 const [search, setSearch] = useState('');
 const [busyId, setBusyId] = useState<string | null>(null);
 const [sel, setSel] = useState<Set<string>>(new Set());
 const [bulkBusy, setBulkBusy] = useState(false);

 const load = useCallback(async () => {
  setLoading(true);
  try {
   const res = await fetch('/api/admin/users');
   if (!res.ok) return;
   const data = (await res.json()) as { users: AdminUser[] };
   setUsers(data.users);
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

 const patchUser = (userId: string, subscriptionEndsAt: string) =>
  setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, subscriptionEndsAt, status: 'approved' } : u)));

 const counts = useMemo(() => {
  const c = { all: users.length, active: 0, expiring: 0, expired: 0, none: 0 };
  for (const u of users) c[toneToFilter(getSubscriptionState(u.subscriptionEndsAt).tone)] += 1;
  return c;
 }, [users]);

 // Sort by soonest expiry first (expired/expiring float up); no-subscription rows sink.
 const rows = useMemo(() => {
  const q = search.trim().toLowerCase();
  return users
   .filter((u) => (filter === 'all' ? true : toneToFilter(getSubscriptionState(u.subscriptionEndsAt).tone) === filter))
   .filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
   .sort((a, b) => {
    const ta = a.subscriptionEndsAt ? new Date(a.subscriptionEndsAt).getTime() : Infinity;
    const tb = b.subscriptionEndsAt ? new Date(b.subscriptionEndsAt).getTime() : Infinity;
    return ta - tb;
   });
 }, [users, filter, search]);

 const selectedInView = rows.filter((u) => sel.has(u.id));
 const toggle = (id: string) =>
  setSel((prev) => {
   const n = new Set(prev);
   if (n.has(id)) n.delete(id);
   else n.add(id);
   return n;
  });
 const toggleAll = () => setSel(selectedInView.length === rows.length && rows.length > 0 ? new Set() : new Set(rows.map((u) => u.id)));
 const clearSel = () => setSel(new Set());

 const doRenew = async (u: AdminUser, days: number) => {
  setBusyId(u.id);
  const r = await renewSubscription(u.id, days);
  setBusyId(null);
  if (!r.ok || !r.subscriptionEndsAt) {
   await alertDialog({ title: t('admin_err_title'), message: r.error === 'network' ? t('admin_err_network') : r.error || t('admin_rq_update_failed') });
   return;
  }
  patchUser(u.id, r.subscriptionEndsAt);
 };

 const doSetDays = async (u: AdminUser) => {
  const current = getSubscriptionState(u.subscriptionEndsAt).daysLeft;
  const input = await promptDialog({
   title: t('admin_rq_setdays_title'),
   message: t('admin_rq_setdays_msg').replace('{name}', u.name).replace('{email}', u.email),
   defaultValue: current != null && current > 0 ? String(current) : '30',
   placeholder: t('admin_rq_setdays_ph'),
  });
  if (input === null) return;
  const parsed = Number(input.trim());
  if (!Number.isFinite(parsed) || parsed < 0) {
   await alertDialog({ title: t('admin_err_title'), message: t('admin_rq_days_nonneg') });
   return;
  }
  setBusyId(u.id);
  const r = await setSubscriptionDays(u.id, parsed);
  setBusyId(null);
  if (!r.ok || !r.subscriptionEndsAt) {
   await alertDialog({ title: t('admin_err_title'), message: r.error === 'network' ? t('admin_err_network') : r.error || t('admin_rq_update_failed') });
   return;
  }
  patchUser(u.id, r.subscriptionEndsAt);
 };

 const bulkExtend = async (labelKey: string, days: number) => {
  const targets = selectedInView;
  if (targets.length === 0) return;
  const ok = await confirmDialog({
   title: t('admin_ud_quick_renew'),
   message: t('admin_bulk_extend_confirm').replace('{label}', t(labelKey)).replace('{count}', String(targets.length)),
  });
  if (!ok) return;
  setBulkBusy(true);
  let done = 0;
  for (const u of targets) {
   const r = await renewSubscription(u.id, days);
   if (r.ok && r.subscriptionEndsAt) {
    patchUser(u.id, r.subscriptionEndsAt);
    done += 1;
   }
  }
  setBulkBusy(false);
  clearSel();
  await alertDialog({ title: t('admin_ud_quick_renew'), message: t('admin_bulk_done').replace('{done}', String(done)).replace('{total}', String(targets.length)) });
 };

 const chips: { key: Filter; labelKey: string; count: number }[] = [
  { key: 'all', labelKey: 'admin_filter_all', count: counts.all },
  { key: 'active', labelKey: 'admin_filter_active', count: counts.active },
  { key: 'expiring', labelKey: 'admin_filter_expiring', count: counts.expiring },
  { key: 'expired', labelKey: 'admin_filter_expired', count: counts.expired },
  { key: 'none', labelKey: 'admin_filter_none', count: counts.none },
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
    <div className="ad-search" style={{ width: 240 }}>
     <Icon name="search" />
     <input type="text" placeholder={t('admin_search_users_ph')} value={search} onChange={(e) => setSearch(e.target.value)} />
    </div>
    <button className="ad-btn" onClick={() => void load()}>
     <Icon name="refresh" />
     {t('admin_refresh')}
    </button>
   </div>

   {selectedInView.length > 0 && (
    <div className="ad-bulk-bar">
     <span className="cnt ad-num">{t('admin_selected').replace('{count}', String(selectedInView.length))}</span>
     <span className="sep" />
     {RENEW_OPTIONS.map((opt) => (
      <button key={opt.days} className="bbtn" disabled={bulkBusy} onClick={() => void bulkExtend(opt.labelKey, opt.days)}>
       <Icon name="refresh" />
       {t(opt.labelKey)}
      </button>
     ))}
     <button className="bbtn close" onClick={clearSel} aria-label={t('admin_clear')}>
      <Icon name="x" strokeWidth={2} />
     </button>
    </div>
   )}

   <div className="ad-card ad-table-wrap">
    {loading ? (
     <StateBlock>{t('admin_loading')}</StateBlock>
    ) : rows.length === 0 ? (
     <StateBlock>{t('admin_subs_no_results')}</StateBlock>
    ) : (
     <table className="ad-table hover">
      <thead>
       <tr>
        <th style={{ width: 20 }}>
         <Check on={selectedInView.length === rows.length && rows.length > 0} onClick={toggleAll} />
        </th>
        <th>{t('admin_col_user')}</th>
        <th>{t('admin_col_sub')}</th>
        <th>{t('admin_ends_label')}</th>
        <th className="center">{t('admin_col_days_left')}</th>
        <th />
       </tr>
      </thead>
      <tbody>
       {rows.map((u) => {
        const s = getSubscriptionState(u.subscriptionEndsAt);
        return (
         <tr key={u.id} className={`clickable ${sel.has(u.id) ? 'selected' : ''}`} onClick={() => router.push(`/admin/users/${u.id}`)}>
          <td onClick={(e) => e.stopPropagation()}>
           <Check on={sel.has(u.id)} onClick={() => toggle(u.id)} />
          </td>
          <td>
           <div className="ad-u-cell">
            <Avatar name={u.name} image={u.image} id={u.id} size={32} />
            <div>
             <div className="ad-u-name">{u.name}</div>
             <div className="ad-u-email">{u.email}</div>
            </div>
           </div>
          </td>
          <td>
           <SubscriptionBadge endsAt={u.subscriptionEndsAt} />
          </td>
          <td className="ad-muted ad-num" style={{ whiteSpace: 'nowrap' }}>
           {u.subscriptionEndsAt ? formatDateTime(u.subscriptionEndsAt, language) : '—'}
          </td>
          <td className="center ad-num">{s.daysLeft != null ? s.daysLeft : '—'}</td>
          <td className="end" onClick={(e) => e.stopPropagation()}>
           <RowMenu
            ariaLabel={u.name}
            items={[
             ...RENEW_OPTIONS.map((opt) => ({ label: t(opt.labelKey), icon: 'refresh' as const, onClick: () => void doRenew(u, opt.days) })),
             { label: t('admin_set_days'), icon: 'clock' as const, onClick: () => void doSetDays(u) },
             { label: t('admin_view_details'), icon: 'user' as const, onClick: () => router.push(`/admin/users/${u.id}`) },
            ]}
           />
           {busyId === u.id && <span className="ad-faint" style={{ marginInlineStart: 8, fontSize: 11 }}>…</span>}
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
