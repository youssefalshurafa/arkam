'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useStableSession } from '@/hooks/useStableSession';
import SiteLayout from '@/components/marketing/SiteLayout';
import PasswordVisibilityToggle from '@/components/auth/PasswordVisibilityToggle';
import { accountingApi } from '@/lib/accountingApi';
import { signOutCleanly } from '@/shared/lib/signOut';
import { passwordProblem } from '@/shared/lib/passwordRules';

type Invitation = {
 status: 'valid' | 'expired' | 'used' | 'revoked' | 'invalid';
 workspaceName?: string;
 inviterName?: string;
 role?: 'admin' | 'member' | 'viewer';
 identifier?: string | null;
 emailable?: boolean;
};

const inputClass =
 'w-full rounded border border-border-strong bg-surface px-3 py-2 text-sm text-fg outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500';
const primaryButton =
 'w-full rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60';
const secondaryButton =
 'w-full rounded border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-fg-muted transition hover:bg-surface-hover';

// Accepting a workspace invitation. Signed in: one click to join. Signed out: sign in, sign up
// with a (verified) email, or — for teammates without an email — create a username account
// straight from this single-use link.
export default function InvitePage() {
 const router = useRouter();
 const params = useParams<{ token: string }>();
 const token = params?.token || '';
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const { status, data: session } = useStableSession();

 const [invitation, setInvitation] = useState<Invitation | null>(null);
 const [error, setError] = useState('');
 const [busy, setBusy] = useState(false);
 const [showUsernameForm, setShowUsernameForm] = useState(false);
 const [username, setUsername] = useState('');
 const [name, setName] = useState('');
 const [password, setPassword] = useState('');
 const [confirmPassword, setConfirmPassword] = useState('');
 const [showPassword, setShowPassword] = useState(false);

 useEffect(() => {
  let isMounted = true;
  fetch(`/api/invitations/${encodeURIComponent(token)}`)
   .then((res) => res.json() as Promise<Invitation>)
   .then((data) => {
    if (isMounted) setInvitation(data);
   })
   .catch(() => {
    if (isMounted) setInvitation({ status: 'invalid' });
   });
  return () => {
   isMounted = false;
  };
 }, [token]);

 const invitePath = `/invite/${token}`;
 const roleLabel = invitation?.role ? t(`team_role_${invitation.role}`) : '';

 const accept = async () => {
  setError('');
  setBusy(true);
  try {
   const res = await fetch(`/api/invitations/${encodeURIComponent(token)}`, { method: 'POST' });
   const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; workspaceId?: string };
   if (!res.ok || !data.ok) throw new Error(data.error || t('invite_accept_failed'));
   if (data.workspaceId) accountingApi.setActiveWorkspaceId(data.workspaceId);
   window.location.assign('/');
  } catch (err) {
   setError(err instanceof Error ? err.message : t('invite_accept_failed'));
   setBusy(false);
  }
 };

 const createUsernameAccount = async (event: FormEvent) => {
  event.preventDefault();
  setError('');
  const problem = passwordProblem(password);
  if (problem) {
   setError(t(problem));
   return;
  }
  if (password !== confirmPassword) {
   setError(t('signup_password_mismatch'));
   return;
  }
  setBusy(true);
  try {
   const res = await fetch(`/api/invitations/${encodeURIComponent(token)}/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username.trim().toLowerCase(), name: name.trim() || undefined, password }),
   });
   const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; username?: string };
   if (!res.ok || !data.ok) throw new Error(data.error || t('invite_accept_failed'));
   const result = await signIn('credentials', { email: data.username, password, remember: 'true', redirect: false });
   window.location.assign(result && !result.error ? '/' : `/login?authEmail=${encodeURIComponent(String(data.username))}`);
  } catch (err) {
   setError(err instanceof Error ? err.message : t('invite_accept_failed'));
   setBusy(false);
  }
 };

 const body = (() => {
  if (!invitation || status === 'loading') {
   return <p className="text-sm text-fg-faint">{t('loading')}</p>;
  }
  if (invitation.status !== 'valid') {
   const key = invitation.status === 'expired' ? 'invite_expired' : invitation.status === 'used' ? 'invite_used' : invitation.status === 'revoked' ? 'invite_revoked' : 'invite_invalid';
   return (
    <div className="space-y-4">
     <p role="alert" className="rounded border border-red-300 bg-bad-bg px-3 py-2 text-sm text-bad-text">
      {t(key)}
     </p>
     <button type="button" onClick={() => router.push('/login')} className={secondaryButton}>
      {t('home_sign_in')}
     </button>
    </div>
   );
  }

  const summary = (
   <p className="text-sm text-fg-muted">
    {t('invite_summary')
     .replace('{inviter}', invitation.inviterName || t('invite_someone'))
     .replace('{workspace}', invitation.workspaceName || '')
     .replace('{role}', roleLabel)}
   </p>
  );

  if (status === 'authenticated') {
   return (
    <div className="space-y-4">
     {summary}
     <button type="button" onClick={() => void accept()} disabled={busy} className={primaryButton}>
      {busy ? t('loading') : t('invite_join_as').replace('{account}', session?.user?.email || session?.user?.name || '')}
     </button>
     <button type="button" onClick={() => void signOutCleanly(invitePath)} className="block w-full text-center text-sm text-accent transition hover:underline">
      {t('invite_not_you')}
     </button>
    </div>
   );
  }

  if (showUsernameForm) {
   return (
    <form className="space-y-4" onSubmit={(event) => void createUsernameAccount(event)}>
     {summary}
     <p className="text-xs text-fg-faint">{t('invite_username_desc')}</p>
     <div>
      <label className="mb-1 block text-xs font-semibold text-fg-muted" htmlFor="invite-name">
       {t('signup_full_name')} <span className="font-normal text-fg-faint">({t('signup_optional')})</span>
      </label>
      <input id="invite-name" type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} autoComplete="name" maxLength={120} />
     </div>
     <div>
      <label className="mb-1 block text-xs font-semibold text-fg-muted" htmlFor="invite-username">
       {t('invite_username_label')}
      </label>
      <input
       id="invite-username"
       type="text"
       value={username}
       onChange={(e) => setUsername(e.target.value)}
       className={inputClass}
       autoComplete="username"
       autoCapitalize="none"
       spellCheck={false}
       dir="ltr"
       required
       pattern="[A-Za-z0-9._\-]{3,32}"
       maxLength={32}
      />
      <p className="mt-1 text-xs text-fg-faint">{t('invite_username_hint')}</p>
     </div>
     <div>
      <label className="mb-1 block text-xs font-semibold text-fg-muted" htmlFor="invite-password">
       {t('signup_password_label')}
      </label>
      <div className="relative">
       <input
        id="invite-password"
        type={showPassword ? 'text' : 'password'}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className={`${inputClass} pr-10`}
        autoComplete="new-password"
        minLength={8}
        required
       />
       <PasswordVisibilityToggle shown={showPassword} onToggle={() => setShowPassword((v) => !v)} showLabel={t('password_show')} hideLabel={t('password_hide')} />
      </div>
      <p className="mt-1 text-xs text-fg-faint">{t('password_requirements_hint')}</p>
     </div>
     <div>
      <label className="mb-1 block text-xs font-semibold text-fg-muted" htmlFor="invite-password-confirm">
       {t('signup_confirm_password_label')}
      </label>
      <input
       id="invite-password-confirm"
       type={showPassword ? 'text' : 'password'}
       value={confirmPassword}
       onChange={(e) => setConfirmPassword(e.target.value)}
       className={inputClass}
       autoComplete="new-password"
       minLength={8}
       required
      />
     </div>
     {error ? (
      <p role="alert" className="rounded border border-red-300 bg-bad-bg px-3 py-2 text-sm text-bad-text">
       {error}
      </p>
     ) : null}
     <button type="submit" disabled={busy} className={primaryButton}>
      {busy ? t('loading') : t('invite_create_and_join')}
     </button>
     <button type="button" onClick={() => setShowUsernameForm(false)} className="block w-full text-center text-sm text-accent transition hover:underline">
      {t('invite_back')}
     </button>
    </form>
   );
  }

  const signupHref = `/signup?next=${encodeURIComponent(invitePath)}${invitation.emailable && invitation.identifier ? `&email=${encodeURIComponent(invitation.identifier)}` : ''}`;
  return (
   <div className="space-y-3">
    {summary}
    <button type="button" onClick={() => router.push(`/login?next=${encodeURIComponent(invitePath)}`)} className={primaryButton}>
     {t('invite_sign_in')}
    </button>
    <button type="button" onClick={() => router.push(signupHref)} className={secondaryButton}>
     {t('invite_sign_up_email')}
    </button>
    <button type="button" onClick={() => setShowUsernameForm(true)} className={secondaryButton}>
     {t('invite_sign_up_username')}
    </button>
   </div>
  );
 })();

 return (
  <SiteLayout hideSignIn>
   <div className="flex flex-1 items-center justify-center p-4">
    <section className="w-full max-w-sm rounded border border-border-strong bg-surface shadow-md">
     <div className="border-b border-border bg-surface-2 px-5 py-3">
      <h2 className="text-sm font-semibold text-fg-muted">{t('invite_title')}</h2>
     </div>
     <div className="p-5">{body}</div>
    </section>
   </div>
  </SiteLayout>
 );
}
