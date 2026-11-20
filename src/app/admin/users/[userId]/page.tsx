'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useStableSession } from '@/hooks/useStableSession';
import { getSubscriptionState } from '@/app/admin/subscription';
import { useAdminI18n } from '../../_ui/useAdminI18n';
import { Icon } from '../../_ui/icons';
import { Avatar, AuthBadge, RoleBadge, SubscriptionBadge, StatTile, StateBlock, LinkDialog } from '../../_ui/primitives';
import { alertDialog, confirmDialog } from '@/components/ui/AppDialog';
import { formatDate, formatDateTime } from '../../_lib/format';
import type { DetailResponse } from '../../_lib/types';

// Section keys recorded by the client activity beacon map to admin_section_* i18n
// keys; unknown keys fall back to the raw section string.
function sectionLabel(section: string, t: (k: string) => string) {
 if (!section) return '—';
 const key = `admin_section_${section}`;
 const val = t(key);
 return val === key ? section : val;
}

// Mirrors the paid-plan durations in src/config/plan.ts.
const RENEW_QUICK_OPTIONS = [
 { labelKey: 'admin_ud_renew_30', days: 30 },
 { labelKey: 'admin_ud_renew_180', days: 180 },
 { labelKey: 'admin_ud_renew_365', days: 365 },
];

export default function AdminUserDetailPage() {
 const { status: sessionStatus, data: sessionData } = useStableSession();
 const sessionUserId = sessionData?.user?.id;
 const router = useRouter();
 const params = useParams<{ userId: string }>();
 const userId = params?.userId || '';
 const { t, language } = useAdminI18n();

 const [data, setData] = useState<DetailResponse | null>(null);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);

 const [daysInput, setDaysInput] = useState('');
 const [subMutating, setSubMutating] = useState(false);
 const [subError, setSubError] = useState('');

 const [phoneInput, setPhoneInput] = useState('');
 const [phoneMutating, setPhoneMutating] = useState(false);
 const [phoneError, setPhoneError] = useState('');
 const [phoneSaved, setPhoneSaved] = useState(false);

 const [aiMutating, setAiMutating] = useState(false);
 const [securityBusy, setSecurityBusy] = useState(false);
 const [setupLink, setSetupLink] = useState<{ title: string; description: string; url: string } | null>(null);
 const [aiError, setAiError] = useState('');

 useEffect(() => {
  const daysLeft = data ? getSubscriptionState(data.user.subscriptionEndsAt).daysLeft : null;
  setDaysInput(daysLeft != null && daysLeft > 0 ? String(daysLeft) : '0');
  setPhoneInput(data?.user.phone || '');
 }, [data]);

 const onSavePhone = async () => {
  setPhoneMutating(true);
  setPhoneError('');
  setPhoneSaved(false);
  try {
   const res = await fetch(`/api/admin/users/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: phoneInput.trim() }),
   });
   const result = (await res.json()) as { ok?: boolean; phone?: string; error?: string };
   if (!res.ok || !result.ok) {
    setPhoneError(result.error || 'Failed to save contact.');
    return;
   }
   setData((prev) => (prev ? { ...prev, user: { ...prev.user, phone: result.phone ?? phoneInput.trim() } } : prev));
   setPhoneSaved(true);
   setTimeout(() => setPhoneSaved(false), 2000);
  } catch {
   setPhoneError('Failed to save contact.');
  } finally {
   setPhoneMutating(false);
  }
 };

 const onToggleAiEnabled = async (next: boolean) => {
  setAiMutating(true);
  setAiError('');
  try {
   const res = await fetch(`/api/admin/users/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aiEnabled: next }),
   });
   const result = (await res.json()) as { ok?: boolean; aiEnabled?: boolean; error?: string };
   if (!res.ok || !result.ok) {
    setAiError(result.error || 'Failed to update AI access.');
    return;
   }
   setData((prev) => (prev ? { ...prev, user: { ...prev.user, aiEnabled: result.aiEnabled ?? next } } : prev));
  } catch {
   setAiError('Failed to update AI access.');
  } finally {
   setAiMutating(false);
  }
 };

 // Setup link / password reset / 2FA reset — all on POST /api/admin/users/[userId].
 const onSecurityAction = async (action: 'setup_link' | 'reset_password' | 'reset_mfa') => {
  const u = data?.user;
  if (!u) return;
  if (action === 'reset_password') {
   const ok = await confirmDialog({ title: t('admin_rp_title'), message: t('admin_rp_confirm').replace(/\{name\}/g, u.name).replace(/\{email\}/g, u.email) });
   if (!ok) return;
  }
  if (action === 'reset_mfa') {
   const ok = await confirmDialog({ title: t('admin_ud_reset_mfa'), message: t('admin_ud_reset_mfa_confirm').replace(/\{name\}/g, u.name) });
   if (!ok) return;
  }
  setSecurityBusy(true);
  try {
   const res = await fetch(`/api/admin/users/${userId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
   });
   const result = (await res.json()) as { ok?: boolean; error?: string; setupUrl?: string };
   if (!res.ok || !result.ok) {
    await alertDialog({ title: t('admin_err_title'), message: result.error || t('admin_rp_failed') });
    return;
   }
   if (result.setupUrl) {
    setSetupLink({
     title: action === 'setup_link' ? t('admin_ud_new_setup_link') : t('admin_rp_done_title'),
     description:
      action === 'setup_link'
       ? t('admin_setup_link_desc')
       : t('admin_rp_done_msg').replace(/\{name\}/g, u.name).replace(/\{email\}/g, u.email),
     url: result.setupUrl,
    });
   } else if (action === 'reset_mfa') {
    await alertDialog({ title: t('admin_ud_reset_mfa'), message: t('admin_ud_reset_mfa_done') });
   }
   void loadUser();
  } catch {
   await alertDialog({ title: t('admin_err_title'), message: t('admin_err_network') });
  } finally {
   setSecurityBusy(false);
  }
 };

 const applySubscriptionResult = (endsAt: string) => {
  setData((prev) => (prev ? { ...prev, user: { ...prev.user, status: 'approved', subscriptionEndsAt: endsAt } } : prev));
 };

 const onSetDays = async () => {
  const parsed = Number(daysInput.trim());
  if (!Number.isFinite(parsed) || parsed < 0) {
   setSubError('Enter a non-negative number of days.');
   return;
  }
  setSubMutating(true);
  setSubError('');
  try {
   const res = await fetch('/api/admin/access-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, action: 'setDays', days: parsed }),
   });
   const result = (await res.json()) as { ok?: boolean; subscriptionEndsAt?: string; error?: string };
   if (!res.ok || !result.ok || !result.subscriptionEndsAt) {
    setSubError(result.error || 'Failed to update subscription.');
    return;
   }
   applySubscriptionResult(result.subscriptionEndsAt);
  } catch {
   setSubError('Failed to update subscription.');
  } finally {
   setSubMutating(false);
  }
 };

 const onRenew = async (durationDays: number) => {
  setSubMutating(true);
  setSubError('');
  try {
   const res = await fetch('/api/admin/access-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, action: 'renew', durationDays }),
   });
   const result = (await res.json()) as { ok?: boolean; subscriptionEndsAt?: string; error?: string };
   if (!res.ok || !result.ok || !result.subscriptionEndsAt) {
    setSubError(result.error || 'Failed to renew subscription.');
    return;
   }
   applySubscriptionResult(result.subscriptionEndsAt);
  } catch {
   setSubError('Failed to renew subscription.');
  } finally {
   setSubMutating(false);
  }
 };

 useEffect(() => {
  if (sessionStatus === 'unauthenticated') router.replace('/login');
 }, [sessionStatus, router]);

 const loadUser = useCallback(async () => {
  setLoading(true);
  setError(null);
  try {
   const res = await fetch(`/api/admin/users/${userId}`);
   if (res.status === 403) {
    setError('forbidden');
    return;
   }
   if (res.status === 404) {
    setError('not_found');
    return;
   }
   if (!res.ok) throw new Error('Failed to load user.');
   setData((await res.json()) as DetailResponse);
  } catch {
   setError('Failed to load user.');
  } finally {
   setLoading(false);
  }
 }, [userId]);

 useEffect(() => {
  if (sessionStatus !== 'authenticated' || !userId) return;
  void loadUser();
 }, [sessionStatus, userId, loadUser]);

 const backLink = (
  <Link href="/admin/users" className="acp-link acp-flip" style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
   <Icon name="back" width={15} height={15} strokeWidth={2} />
   {t('admin_nav_users')}
  </Link>
 );

 if (sessionStatus === 'loading' || loading) return <StateBlock>{t('admin_loading')}</StateBlock>;
 if (error === 'forbidden') return <StateBlock>🚫 {t('admin_access_denied')}</StateBlock>;
 if (error === 'not_found' || !data) {
  return (
   <div className="acp-card acp-card-pad" style={{ textAlign: 'center', padding: '48px 24px' }}>
    <div style={{ fontSize: 15, fontWeight: 650 }}>{t('admin_user_not_found')}</div>
    <div style={{ marginTop: 10 }}>{backLink}</div>
   </div>
  );
 }

 const { user, workspaces, totals, pendingAccessRequest, activity } = data;

 return (
  <>
   <div>{backLink}</div>

   {/* Profile */}
   <div className="acp-card acp-card-pad acp-row" style={{ gap: 16 }}>
    <Avatar name={user.name} image={user.image} id={user.id} size={56} />
    <div style={{ flex: 1, minWidth: 0 }}>
     <div className="acp-row acp-wrap" style={{ gap: 8 }}>
      <h2 style={{ fontSize: 18, fontWeight: 650, margin: 0 }}>{user.name}</h2>
      <AuthBadge provider={user.authProvider} t={t} />
      <SubscriptionBadge endsAt={user.subscriptionEndsAt} />
     </div>
     <p className="acp-u-email" style={{ marginTop: 2 }}>{user.email}</p>
     <p className="acp-faint acp-num" style={{ fontSize: 12, marginTop: 4 }}>
      {t('admin_ud_joined').replace('{date}', formatDate(user.createdAt, language))}
      {user.subscriptionStartedAt ? ` · ${t('admin_started_label')} ${formatDate(user.subscriptionStartedAt, language)}` : ''}
      {user.subscriptionEndsAt ? ` · ${t('admin_ends_label')} ${formatDate(user.subscriptionEndsAt, language)}` : ''}
     </p>
    </div>
   </div>

   {/* Trusted contact */}
   <div className="acp-card acp-card-pad">
    <h3 className="acp-section-title" style={{ marginBottom: 2 }}>{t('admin_ud_trusted_contact')}</h3>
    <p className="acp-faint" style={{ fontSize: 12, marginBottom: 12 }}>{t('admin_ud_trusted_desc')}</p>
    {phoneError && <p style={{ color: 'var(--ad-bad-text)', fontSize: 13, marginBottom: 8 }}>{phoneError}</p>}
    <div className="acp-row" style={{ gap: 8 }}>
     <input
      className="acp-input"
      style={{ maxWidth: 260 }}
      type="text"
      value={phoneInput}
      onChange={(e) => setPhoneInput(e.target.value)}
      disabled={phoneMutating}
      placeholder="e.g. +20 100 000 0000"
     />
     <button className="acp-btn sm primary" onClick={() => void onSavePhone()} disabled={phoneMutating || phoneInput.trim() === (user.phone || '')}>
      {phoneSaved ? t('admin_saved') : t('admin_save')}
     </button>
    </div>
   </div>

   {/* Sign-in & security */}
   <div className="acp-card acp-card-pad">
    <h3 className="acp-section-title" style={{ marginBottom: 2 }}>{t('admin_ud_security_title')}</h3>
    <p className="acp-faint" style={{ fontSize: 12, marginBottom: 12 }}>{t('admin_ud_security_desc')}</p>
    <div className="acp-row acp-wrap" style={{ gap: 8, marginBottom: 12 }}>
     <span className={`acp-badge ${user.hasPassword ? 'good' : 'neutral'}`}>
      <span className="dot" />
      {user.hasPassword ? t('admin_ud_has_password') : t('admin_ud_no_password')}
     </span>
     <span className={`acp-badge ${user.googleLinked ? 'info' : 'neutral'}`}>
      <span className="dot" />
      {user.googleLinked ? t('admin_ud_google_linked') : t('admin_ud_google_not_linked')}
     </span>
     <span className={`acp-badge ${user.emailVerified ? 'good' : 'warn'}`}>
      <span className="dot" />
      {user.emailVerified ? t('admin_ud_email_verified') : t('admin_ud_email_unverified')}
     </span>
     <span className={`acp-badge ${user.mfaEnabled ? 'good' : 'neutral'}`}>
      <span className="dot" />
      {user.mfaEnabled ? t('admin_ud_mfa_on') : t('admin_ud_mfa_off')}
     </span>
    </div>
    <div className="acp-row acp-wrap" style={{ gap: 8 }}>
     {!user.hasPassword && (
      <button className="acp-btn sm" disabled={securityBusy} onClick={() => void onSecurityAction('setup_link')}>
       <Icon name="key" />
       {t('admin_ud_new_setup_link')}
      </button>
     )}
     <button className="acp-btn sm" disabled={securityBusy || sessionUserId === user.id} onClick={() => void onSecurityAction('reset_password')}>
      <Icon name="key" />
      {t('admin_reset_password')}
     </button>
     {user.mfaEnabled && (
      <button className="acp-btn sm danger" disabled={securityBusy || sessionUserId === user.id} onClick={() => void onSecurityAction('reset_mfa')}>
       {t('admin_ud_reset_mfa')}
      </button>
     )}
    </div>
   </div>

   {setupLink && <LinkDialog title={setupLink.title} description={setupLink.description} links={[{ url: setupLink.url }]} onClose={() => setSetupLink(null)} />}

   {/* AI features access */}
   <div className="acp-card acp-card-pad">
    <h3 className="acp-section-title" style={{ marginBottom: 2 }}>{t('admin_ud_ai_title')}</h3>
    <p className="acp-faint" style={{ fontSize: 12, marginBottom: 12 }}>{t('admin_ud_ai_desc')}</p>
    {aiError && <p style={{ color: 'var(--ad-bad-text)', fontSize: 13, marginBottom: 8 }}>{aiError}</p>}
    <label className="acp-row" style={{ gap: 8, cursor: aiMutating ? 'default' : 'pointer' }}>
     <input
      type="checkbox"
      checked={user.aiEnabled}
      disabled={aiMutating}
      onChange={(e) => void onToggleAiEnabled(e.target.checked)}
     />
     <span style={{ fontSize: 13 }}>{user.aiEnabled ? t('admin_ud_ai_on') : t('admin_ud_ai_off')}</span>
    </label>
   </div>

   {/* Pending access request */}
   {pendingAccessRequest && (
    <div className="acp-card acp-card-pad" style={{ borderColor: 'color-mix(in srgb, var(--ad-warn) 40%, var(--ad-border))', background: 'var(--ad-warn-bg)' }}>
     <div className="acp-row acp-wrap" style={{ justifyContent: 'space-between', gap: 12 }}>
      <div>
       <h3 className="acp-section-title" style={{ color: 'var(--ad-warn-text)' }}>{t('admin_ud_pending_title')}</h3>
       <p style={{ color: 'var(--ad-warn-text)', fontSize: 13, marginTop: 4 }}>
        {pendingAccessRequest.plan ? <strong>{pendingAccessRequest.plan}</strong> : null}
        {pendingAccessRequest.amount ? ` · ${pendingAccessRequest.amount}` : ''}
        {pendingAccessRequest.network ? ` · ${pendingAccessRequest.network}` : ''}
       </p>
       <p className="acp-num" style={{ color: 'var(--ad-warn-text)', fontSize: 12, marginTop: 4, opacity: 0.85 }}>
        {t('admin_ud_submitted').replace('{when}', formatDateTime(pendingAccessRequest.createdAt, language))}
        {pendingAccessRequest.txReference ? ` · tx: ${pendingAccessRequest.txReference}` : ''}
       </p>
      </div>
      <div className="acp-row" style={{ gap: 8 }}>
       {pendingAccessRequest.hasProof && (
        <a href={`/api/admin/access-requests/${pendingAccessRequest.id}/proof`} target="_blank" rel="noopener noreferrer" className="acp-btn sm">
         {t('admin_view_proof')}
        </a>
       )}
       <Link href="/admin/requests" className="acp-btn sm primary">
        {t('admin_req_title')}
       </Link>
      </div>
     </div>
    </div>
   )}

   {/* Subscription management */}
   <div className="acp-card acp-card-pad">
    <h3 className="acp-section-title" style={{ marginBottom: 12 }}>{t('admin_col_sub')}</h3>
    {subError && <p style={{ color: 'var(--ad-bad-text)', fontSize: 13, marginBottom: 8 }}>{subError}</p>}
    <div className="acp-row acp-wrap" style={{ gap: 28, alignItems: 'flex-end' }}>
     <div>
      <label className="acp-label">{t('admin_ud_days_remaining')}</label>
      <div className="acp-row" style={{ gap: 8 }}>
       <input
        className="acp-input acp-num"
        style={{ width: 96 }}
        type="number"
        min={0}
        value={daysInput}
        onChange={(e) => setDaysInput(e.target.value)}
        disabled={subMutating}
       />
       <button className="acp-btn sm primary" onClick={() => void onSetDays()} disabled={subMutating}>
        {t('admin_save')}
       </button>
      </div>
      <p className="acp-faint" style={{ fontSize: 12, marginTop: 6 }}>{t('admin_ud_days_replace')}</p>
     </div>
     <div>
      <label className="acp-label">{t('admin_ud_quick_renew')}</label>
      <div className="acp-row" style={{ gap: 8 }}>
       {RENEW_QUICK_OPTIONS.map((opt) => (
        <button key={opt.days} className="acp-btn sm outline-accent" onClick={() => void onRenew(opt.days)} disabled={subMutating}>
         {t(opt.labelKey)}
        </button>
       ))}
      </div>
      <p className="acp-faint" style={{ fontSize: 12, marginTop: 6 }}>{t('admin_ud_quick_renew_desc')}</p>
     </div>
    </div>
   </div>

   {/* Usage stats */}
   <div>
    <h3 className="acp-section-title" style={{ marginBottom: 12 }}>{t('admin_ud_usage')}</h3>
    <div className="acp-kpi-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
     <StatTile label={t('admin_col_ws')} value={workspaces.length} />
     <StatTile label={t('admin_stat_orgs')} value={totals.organizationCount} />
     <StatTile label={t('admin_stat_clients')} value={totals.clientCount} />
     <StatTile label={t('admin_stat_accounts')} value={totals.accountCount} />
     <StatTile label={t('admin_stat_transactions')} value={totals.transactionCount} />
     <StatTile
      label={t('admin_stat_last_activity')}
      value={totals.lastTransactionAt ? formatDate(totals.lastTransactionAt, language) : '—'}
      sub={totals.lastTransactionAt ? formatDateTime(totals.lastTransactionAt, language) : t('admin_ud_no_tx_yet')}
     />
    </div>
   </div>

   {/* App activity */}
   <div>
    <h3 className="acp-section-title" style={{ marginBottom: 12 }}>{t('admin_ud_app_activity')}</h3>
    <div className="acp-kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 16 }}>
     <StatTile
      label={t('admin_stat_app_opens')}
      value={activity.appOpenCount}
      sub={activity.lastAppOpenAt ? t('admin_ud_last').replace('{when}', formatDateTime(activity.lastAppOpenAt, language)) : t('admin_never')}
     />
     <StatTile
      label={t('admin_stat_logins')}
      value={activity.loginCount}
      sub={activity.lastLoginAt ? t('admin_ud_last').replace('{when}', formatDateTime(activity.lastLoginAt, language)) : t('admin_never')}
     />
     <StatTile
      label={t('admin_stat_last_active')}
      value={activity.lastActiveAt ? formatDate(activity.lastActiveAt, language) : '—'}
      sub={activity.lastActiveAt ? formatDateTime(activity.lastActiveAt, language) : t('admin_ud_no_activity_yet')}
     />
    </div>
    <div className="acp-card acp-table-wrap">
     {activity.sectionVisits.length === 0 ? (
      <StateBlock>{t('admin_ud_no_visits')}</StateBlock>
     ) : (
      <table className="acp-table hover">
       <thead>
        <tr>
         <th>{t('admin_col_section')}</th>
         <th className="center">{t('admin_col_visits_today')}</th>
         <th className="center">{t('admin_col_visits_total')}</th>
         <th>{t('admin_col_last_visited')}</th>
        </tr>
       </thead>
       <tbody>
        {activity.sectionVisits.map((visit) => (
         <tr key={visit.section || '(none)'}>
          <td className="acp-u-name">{sectionLabel(visit.section, t)}</td>
          <td className="center acp-num">{visit.todayCount}</td>
          <td className="center acp-num acp-muted">{visit.totalCount}</td>
          <td className="acp-muted acp-num" style={{ whiteSpace: 'nowrap' }}>{formatDateTime(visit.lastVisitAt, language)}</td>
         </tr>
        ))}
       </tbody>
      </table>
     )}
    </div>
   </div>

   {/* Workspaces */}
   <div>
    <h3 className="acp-section-title" style={{ marginBottom: 12 }}>{t('admin_col_ws')}</h3>
    <div className="acp-card acp-table-wrap">
     {workspaces.length === 0 ? (
      <StateBlock>{t('admin_ud_no_workspaces')}</StateBlock>
     ) : (
      <table className="acp-table hover">
       <thead>
        <tr>
         <th>{t('workspace_label')}</th>
         <th className="center">{t('admin_col_orgs')}</th>
         <th className="center">{t('admin_col_clients')}</th>
         <th className="center">{t('admin_col_accounts')}</th>
         <th className="center">{t('admin_col_transactions')}</th>
         <th>{t('admin_stat_last_activity')}</th>
        </tr>
       </thead>
       <tbody>
        {workspaces.map((ws) => (
         <tr key={ws.id}>
          <td>
           <div className="acp-u-name">
            {ws.name}
            <RoleBadge role={ws.role} t={t} />
           </div>
           <div className="acp-u-email">/{ws.slug}</div>
          </td>
          <td className="center acp-num">{ws.stats.organizationCount}</td>
          <td className="center acp-num">{ws.stats.clientCount}</td>
          <td className="center acp-num">{ws.stats.accountCount}</td>
          <td className="center acp-num">{ws.stats.transactionCount}</td>
          <td className="acp-muted acp-num" style={{ whiteSpace: 'nowrap' }}>{formatDateTime(ws.stats.lastTransactionAt, language)}</td>
         </tr>
        ))}
       </tbody>
      </table>
     )}
    </div>
   </div>
  </>
 );
}
