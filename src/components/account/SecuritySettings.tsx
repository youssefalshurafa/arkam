'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';

// Settings -> Account -> Security: two-factor authentication, backup codes, signing out other
// devices, and recent security activity. Everything goes through /api/account/security.

type SecurityEvent = { id: number; event: string; ip: string | null; userAgent: string | null; createdAt: string };
type SecurityState = { mfa: { enabled: boolean; enabledAt: string | null; backupCodesLeft: number }; events: SecurityEvent[] };
type Enrollment = { secret: string; qrDataUrl: string };
type Mode = 'idle' | 'enroll-password' | 'enroll-scan' | 'disable' | 'regenerate' | 'revoke';

const panelClass = 'rounded-lg border border-border bg-surface p-5 shadow-sm';
const inputClass =
 'w-full rounded border border-border-strong bg-surface px-3 py-2 text-sm text-fg outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500';
const primaryButton =
 'rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60';
const secondaryButton =
 'rounded border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-fg-muted transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60';

async function postSecurity(body: Record<string, unknown>) {
 const res = await fetch('/api/account/security', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
 });
 const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; secret?: string; qrDataUrl?: string; backupCodes?: string[] };
 if (!res.ok || !data.ok) throw new Error(data.error || 'Request failed.');
 return data;
}

function describeAgent(userAgent: string | null): string {
 if (!userAgent) return '';
 const browser = /Edg\//.test(userAgent) ? 'Edge' : /Chrome\//.test(userAgent) ? 'Chrome' : /Firefox\//.test(userAgent) ? 'Firefox' : /Safari\//.test(userAgent) ? 'Safari' : '';
 const os = /Windows/.test(userAgent) ? 'Windows' : /Android/.test(userAgent) ? 'Android' : /iPhone|iPad/.test(userAgent) ? 'iOS' : /Mac OS X/.test(userAgent) ? 'macOS' : /Linux/.test(userAgent) ? 'Linux' : '';
 return [browser, os].filter(Boolean).join(' · ');
}

export default function SecuritySettings({ hasPassword }: { hasPassword: boolean }) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);

 const [state, setState] = useState<SecurityState | null>(null);
 const [mode, setMode] = useState<Mode>('idle');
 const [password, setPassword] = useState('');
 const [code, setCode] = useState('');
 const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
 const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState('');
 const [notice, setNotice] = useState('');

 const load = useCallback(async () => {
  try {
   const res = await fetch('/api/account/security');
   if (res.ok) setState((await res.json()) as SecurityState);
  } catch {
   /* non-fatal */
  }
 }, []);

 useEffect(() => {
  void load();
 }, [load]);

 const reset = (next: Mode = 'idle') => {
  setMode(next);
  setPassword('');
  setCode('');
  setError('');
 };

 const run = async (fn: () => Promise<void>) => {
  setBusy(true);
  setError('');
  setNotice('');
  try {
   await fn();
  } catch (err) {
   setError(err instanceof Error ? err.message : t('security_failed'));
  } finally {
   setBusy(false);
  }
 };

 const startEnrollment = (event?: FormEvent) => {
  event?.preventDefault();
  void run(async () => {
   const data = await postSecurity({ action: 'mfa_start', password: password || undefined });
   setEnrollment({ secret: String(data.secret), qrDataUrl: String(data.qrDataUrl) });
   setPassword('');
   setMode('enroll-scan');
  });
 };

 const confirmEnrollment = (event: FormEvent) => {
  event.preventDefault();
  void run(async () => {
   const data = await postSecurity({ action: 'mfa_confirm', code });
   setBackupCodes(data.backupCodes || []);
   setEnrollment(null);
   reset();
   setNotice(t('security_mfa_enabled_notice'));
   await load();
  });
 };

 const disable = (event: FormEvent) => {
  event.preventDefault();
  void run(async () => {
   await postSecurity({ action: 'mfa_disable', password: password || undefined, code });
   setBackupCodes(null);
   reset();
   setNotice(t('security_mfa_disabled_notice'));
   await load();
  });
 };

 const regenerate = (event: FormEvent) => {
  event.preventDefault();
  void run(async () => {
   const data = await postSecurity({ action: 'backup_codes', code });
   setBackupCodes(data.backupCodes || []);
   reset();
   await load();
  });
 };

 const revoke = (event: FormEvent) => {
  event.preventDefault();
  void run(async () => {
   await postSecurity({ action: 'revoke_sessions', password: password || undefined });
   reset();
   setNotice(t('security_sessions_revoked_notice'));
   await load();
  });
 };

 const copyCodes = async () => {
  if (!backupCodes) return;
  try {
   await navigator.clipboard.writeText(backupCodes.join('\n'));
   setNotice(t('security_backup_copied'));
  } catch {
   /* user can select manually */
  }
 };

 const downloadCodes = () => {
  if (!backupCodes) return;
  const blob = new Blob([`Arkam backup codes\n\n${backupCodes.join('\n')}\n\nEach code works once.\n`], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'arkam-backup-codes.txt';
  a.click();
  URL.revokeObjectURL(url);
 };

 const eventLabel = (event: string) => {
  const key = `security_event_${event}`;
  const label = t(key);
  return label === key ? event : label;
 };

 const formatWhen = (iso: string) => new Date(iso).toLocaleString(language, { dateStyle: 'medium', timeStyle: 'short' });

 const mfaEnabled = state?.mfa.enabled === true;

 const passwordField = hasPassword ? (
  <div>
   <label className="mb-1 block text-xs font-semibold text-fg-muted" htmlFor="security-password">
    {t('account_current_password')}
   </label>
   <input
    id="security-password"
    type="password"
    value={password}
    onChange={(e) => setPassword(e.target.value)}
    className={inputClass}
    autoComplete="current-password"
    required
   />
  </div>
 ) : null;

 const codeField = (
  <div>
   <label className="mb-1 block text-xs font-semibold text-fg-muted" htmlFor="security-code">
    {t('login_mfa_code')}
   </label>
   <input
    id="security-code"
    type="text"
    inputMode="numeric"
    value={code}
    onChange={(e) => setCode(e.target.value)}
    placeholder="123456"
    className={`${inputClass} tracking-widest`}
    autoComplete="one-time-code"
    dir="ltr"
    required
    maxLength={20}
   />
  </div>
 );

 const formButtons = (submitLabel: string) => (
  <div className="flex items-center gap-3">
   <button type="submit" disabled={busy} className={primaryButton}>
    {busy ? t('loading') : submitLabel}
   </button>
   <button type="button" onClick={() => reset()} className="text-sm font-semibold text-fg-faint transition hover:text-fg-muted">
    {t('cancel')}
   </button>
  </div>
 );

 return (
  <>
   {/* Two-factor authentication */}
   <div className={panelClass}>
    <div className="flex flex-wrap items-center gap-2">
     <h2 className="text-2xl font-semibold">{t('security_mfa_title')}</h2>
     {state ? (
      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${mfaEnabled ? 'bg-good-bg text-good-text' : 'bg-surface-hover text-fg-faint'}`}>
       {mfaEnabled ? t('security_mfa_on') : t('security_mfa_off')}
      </span>
     ) : null}
    </div>
    <p className="mt-2 text-sm text-fg-muted">{t('security_mfa_desc')}</p>

    {backupCodes ? (
     <div className="mt-5 max-w-md rounded border border-amber-200 bg-warn-bg p-4">
      <p className="text-sm font-semibold text-warn-text">{t('security_backup_title')}</p>
      <p className="mt-1 text-xs text-warn-text">{t('security_backup_desc')}</p>
      <ul className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm text-fg" dir="ltr">
       {backupCodes.map((backupCode) => (
        <li key={backupCode} className="rounded border border-border bg-surface px-2 py-1 text-center">
         {backupCode}
        </li>
       ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
       <button type="button" onClick={() => void copyCodes()} className={secondaryButton}>
        {t('security_backup_copy')}
       </button>
       <button type="button" onClick={downloadCodes} className={secondaryButton}>
        {t('security_backup_download')}
       </button>
       <button type="button" onClick={() => setBackupCodes(null)} className={primaryButton}>
        {t('security_backup_done')}
       </button>
      </div>
     </div>
    ) : null}

    {mode === 'idle' && state ? (
     <div className="mt-5 flex flex-wrap items-center gap-3">
      {mfaEnabled ? (
       <>
        <p className="w-full text-sm text-fg-muted">{t('security_backup_left', { count: state.mfa.backupCodesLeft })}</p>
        <button type="button" onClick={() => reset('regenerate')} className={secondaryButton}>
         {t('security_backup_regenerate')}
        </button>
        <button type="button" onClick={() => reset('disable')} className={secondaryButton}>
         {t('security_mfa_disable')}
        </button>
       </>
      ) : (
       <button type="button" onClick={() => (hasPassword ? reset('enroll-password') : startEnrollment())} disabled={busy} className={primaryButton}>
        {t('security_mfa_enable')}
       </button>
      )}
     </div>
    ) : null}

    {mode === 'enroll-password' ? (
     <form onSubmit={startEnrollment} className="mt-5 max-w-sm space-y-4">
      <p className="text-sm text-fg-muted">{t('security_reauth_prompt')}</p>
      {passwordField}
      {formButtons(t('security_continue'))}
     </form>
    ) : null}

    {mode === 'enroll-scan' && enrollment ? (
     <form onSubmit={confirmEnrollment} className="mt-5 max-w-sm space-y-4">
      <ol className="list-decimal space-y-1 ps-5 text-sm text-fg-muted">
       <li>{t('security_mfa_step_install')}</li>
       <li>{t('security_mfa_step_scan')}</li>
       <li>{t('security_mfa_step_code')}</li>
      </ol>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={enrollment.qrDataUrl} alt={t('security_mfa_qr_alt')} className="h-44 w-44 rounded border border-border bg-white p-1" />
      <div>
       <p className="text-xs text-fg-faint">{t('security_mfa_manual_key')}</p>
       <code className="mt-1 block break-all rounded border border-border bg-surface-2 px-2 py-1 font-mono text-xs text-fg" dir="ltr">
        {enrollment.secret.replace(/(.{4})/g, '$1 ').trim()}
       </code>
      </div>
      {codeField}
      {formButtons(t('security_mfa_confirm'))}
     </form>
    ) : null}

    {mode === 'disable' ? (
     <form onSubmit={disable} className="mt-5 max-w-sm space-y-4">
      <p className="text-sm text-fg-muted">{t('security_mfa_disable_prompt')}</p>
      {passwordField}
      {codeField}
      {formButtons(t('security_mfa_disable'))}
     </form>
    ) : null}

    {mode === 'regenerate' ? (
     <form onSubmit={regenerate} className="mt-5 max-w-sm space-y-4">
      <p className="text-sm text-fg-muted">{t('security_backup_regenerate_prompt')}</p>
      {codeField}
      {formButtons(t('security_backup_regenerate'))}
     </form>
    ) : null}

    {error && mode !== 'revoke' ? (
     <p role="alert" className="mt-4 rounded border border-red-300 bg-bad-bg px-3 py-2 text-sm text-bad-text">
      {error}
     </p>
    ) : null}
    {notice && mode === 'idle' ? <p className="mt-4 rounded border border-green-300 bg-good-bg px-3 py-2 text-sm text-good-text">{notice}</p> : null}
   </div>

   {/* Sessions & activity */}
   <div className={panelClass}>
    <h2 className="text-2xl font-semibold">{t('security_sessions_title')}</h2>
    <p className="mt-2 text-sm text-fg-muted">{t('security_sessions_desc')}</p>

    {mode === 'revoke' ? (
     <form onSubmit={revoke} className="mt-5 max-w-sm space-y-4">
      {hasPassword ? <p className="text-sm text-fg-muted">{t('security_reauth_prompt')}</p> : null}
      {passwordField}
      {error ? (
       <p role="alert" className="rounded border border-red-300 bg-bad-bg px-3 py-2 text-sm text-bad-text">
        {error}
       </p>
      ) : null}
      {formButtons(t('security_sessions_revoke'))}
     </form>
    ) : (
     <button type="button" onClick={() => reset('revoke')} className={`mt-5 ${secondaryButton}`}>
      {t('security_sessions_revoke')}
     </button>
    )}

    <h3 className="mt-6 text-sm font-semibold text-fg">{t('security_activity_title')}</h3>
    {state && state.events.length > 0 ? (
     <ul className="mt-2 divide-y divide-border rounded border border-border">
      {state.events.map((event) => (
       <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
        <span className="text-fg">{eventLabel(event.event)}</span>
        {/* Each part isolated with <bdi> so a localized (e.g. Arabic) date and an LTR IP
            don't reorder each other in an RTL layout. */}
        <span className="flex flex-wrap gap-x-2 text-xs text-fg-faint">
         {describeAgent(event.userAgent) ? <bdi>{describeAgent(event.userAgent)}</bdi> : null}
         {event.ip ? <bdi dir="ltr">{event.ip}</bdi> : null}
         <bdi>{formatWhen(event.createdAt)}</bdi>
        </span>
       </li>
      ))}
     </ul>
    ) : (
     <p className="mt-2 text-sm text-fg-faint">{t('security_activity_empty')}</p>
    )}
   </div>
  </>
 );
}
