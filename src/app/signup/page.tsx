'use client';

import { FormEvent, useEffect, useState } from 'react';
import { getProviders, signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useStableSession } from '@/hooks/useStableSession';
import SiteLayout from '@/components/marketing/SiteLayout';
import VerificationCodeForm from '@/components/auth/VerificationCodeForm';
import PasswordVisibilityToggle from '@/components/auth/PasswordVisibilityToggle';
import { COUNTRY_DIAL_CODES, DEFAULT_DIAL_CODE } from '@/shared/constants/countryDialCodes';
import { passwordProblem } from '@/shared/lib/passwordRules';
import { safeNextPath } from '@/shared/lib/safeNextPath';

type Pending = { pendingId: string; email: string };

async function postJson(url: string, body: unknown) {
 const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
 const payload = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; code?: string; pendingId?: string; email?: string };
 if (!res.ok || !payload.ok) {
  const error = new Error(payload.error || 'Request failed.') as Error & { code?: string };
  error.code = payload.code;
  throw error;
 }
 return payload;
}

// Two-step signup: details -> 6-digit code emailed to the address. The account (and its
// 14-day trial) only exists once the code is confirmed, so nobody can register an address
// they don't control.
export default function SignupPage() {
 const router = useRouter();
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const { status } = useStableSession();

 const [fullName, setFullName] = useState('');
 const [email, setEmail] = useState('');
 const [dialCode, setDialCode] = useState(DEFAULT_DIAL_CODE);
 const [phone, setPhone] = useState('');
 const [password, setPassword] = useState('');
 const [confirmPassword, setConfirmPassword] = useState('');
 const [showPassword, setShowPassword] = useState(false);
 const [error, setError] = useState('');
 const [isSubmitting, setIsSubmitting] = useState(false);
 const [isGoogleEnabled, setIsGoogleEnabled] = useState(false);
 const [pending, setPending] = useState<Pending | null>(null);
 const [nextPath, setNextPath] = useState('/');

 // Live password rules, recomputed on every keystroke to drive the inline checklist.
 const pwHasLength = password.length >= 8;
 const pwHasMix = /\p{L}/u.test(password) && /\p{Nd}/u.test(password);
 const pwConfirmMatch = confirmPassword.length > 0 && password === confirmPassword;

 // ?next= (e.g. back to an invite link after signing up) and ?email= (prefill from an invite).
 useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const prefill = params.get('email');
  setNextPath(safeNextPath(params.get('next')));
  if (prefill) setEmail(prefill);
 }, []);

 useEffect(() => {
  if (status === 'authenticated' && !pending) {
   window.location.replace(nextPath);
  }
 }, [status, pending, nextPath]);

 useEffect(() => {
  let isMounted = true;
  getProviders()
   .then((providers) => {
    if (isMounted) setIsGoogleEnabled(Boolean(providers?.google));
   })
   .catch(() => {
    if (isMounted) setIsGoogleEnabled(false);
   });
  return () => {
   isMounted = false;
  };
 }, []);

 const onSubmit = async (event: FormEvent) => {
  event.preventDefault();
  setError('');

  // Digits-only national number; drop a leading trunk '0' so we don't double it after the dial code.
  const nationalNumber = phone.replace(/\D/g, '').replace(/^0+/, '');
  if (nationalNumber.length < 6) {
   setError(t('signup_phone_invalid'));
   return;
  }
  const problem = passwordProblem(password);
  if (problem) {
   setError(t(problem));
   return;
  }
  if (password !== confirmPassword) {
   setError(t('signup_password_mismatch'));
   return;
  }

  setIsSubmitting(true);
  try {
   const payload = await postJson('/api/auth/signup', {
    name: fullName,
    email: email.trim(),
    password,
    phone: `${dialCode}${nationalNumber}`,
   });
   setPending({ pendingId: String(payload.pendingId), email: String(payload.email || email.trim()) });
  } catch (err) {
   setError(err instanceof Error ? err.message : t('signup_error_generic'));
  } finally {
   setIsSubmitting(false);
  }
 };

 const onVerify = async (code: string) => {
  if (!pending) return;
  try {
   await postJson('/api/auth/signup/verify', { pendingId: pending.pendingId, code });
  } catch (err) {
   const codeName = (err as { code?: string }).code;
   // Dead pending signup (too many tries / expired): back to the form, details kept.
   if (codeName === 'TOO_MANY_ATTEMPTS' || codeName === 'EXPIRED' || codeName === 'ALREADY_REGISTERED') {
    setPending(null);
    setError(err instanceof Error ? err.message : t('signup_error_generic'));
    return;
   }
   throw err;
  }
  const result = await signIn('credentials', { email: pending.email, password, remember: 'true', redirect: false });
  if (!result || result.error) {
   // Account exists but auto sign-in failed — send them to the login form, not a dead end.
   window.location.assign(`/login?authEmail=${encodeURIComponent(pending.email)}${nextPath !== '/' ? `&next=${encodeURIComponent(nextPath)}` : ''}`);
   return;
  }
  window.location.assign(nextPath);
 };

 const onResend = async () => {
  if (!pending) return;
  await postJson('/api/auth/signup/resend', { pendingId: pending.pendingId });
 };

 const inputClass =
  'w-full rounded border border-border-strong bg-surface px-3 py-2 text-sm text-fg outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500';

 if (status === 'loading' || (status === 'authenticated' && !pending)) {
  return (
   <SiteLayout>
    <div className="flex flex-1 items-center justify-center p-4">
     <div className="rounded border border-border-strong bg-surface px-6 py-4 text-sm text-fg-muted shadow-sm">{t('loading')}</div>
    </div>
   </SiteLayout>
  );
 }

 return (
  <SiteLayout>
   <div className="flex flex-1 items-center justify-center p-4">
    <div className="w-full max-w-sm">
     <div className="mb-6 text-center">
      <p className="text-sm text-fg-faint">{t('signup_create_account')}</p>
     </div>

     <section className="rounded border border-border-strong bg-surface shadow-md">
      <div className="flex items-center justify-between border-b border-border bg-surface-2 px-5 py-3">
       <h2 className="text-sm font-semibold text-fg-muted">{pending ? t('verify_code_title') : t('signup_heading')}</h2>
       <button
        type="button"
        onClick={() => router.push(nextPath !== '/' ? `/login?next=${encodeURIComponent(nextPath)}` : '/login')}
        className="text-sm text-accent transition hover:text-accent hover:underline"
       >
        {t('home_sign_in')}
       </button>
      </div>

      <div className="space-y-4 p-5">
       {pending ? (
        <VerificationCodeForm
         email={pending.email}
         onSubmit={onVerify}
         onResend={onResend}
         onBack={() => setPending(null)}
         submitLabel={t('signup_verify_submit')}
         compact
        />
       ) : (
        <>
         <p className="rounded border border-emerald-200 bg-good-bg px-3 py-2 text-center text-xs font-semibold text-good-text">
          {t('signup_trial_badge', { days: 14 })}
         </p>

         {isGoogleEnabled ? (
          <>
           <button
            type="button"
            onClick={() => {
             setError('');
             void signIn('google', { callbackUrl: nextPath });
            }}
            className="inline-flex w-full items-center justify-center gap-2 rounded border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-fg-muted shadow-sm transition hover:bg-surface-hover"
           >
            <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-blue-600 text-xs font-bold text-white">G</span>
            {t('signup_google')}
           </button>
           <div className="flex items-center gap-3 text-xs text-fg-faint">
            <span className="h-px flex-1 bg-border" />
            <span>{t('signup_or')}</span>
            <span className="h-px flex-1 bg-border" />
           </div>
          </>
         ) : null}

         <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
          <div>
           <label className="mb-1 block text-xs font-semibold text-fg-muted" htmlFor="signup-name">
            {t('signup_full_name')} <span className="font-normal text-fg-faint">({t('signup_optional')})</span>
           </label>
           <input
            id="signup-name"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder={t('signup_full_name')}
            className={inputClass}
            autoComplete="name"
            maxLength={120}
           />
          </div>
          <div>
           <label className="mb-1 block text-xs font-semibold text-fg-muted" htmlFor="signup-email">
            {t('signup_email_label')}
           </label>
           <input
            id="signup-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            className={inputClass}
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            dir="ltr"
            required
            maxLength={254}
           />
           <p className="mt-1 text-xs text-fg-faint">{t('signup_email_hint')}</p>
          </div>
          <div>
           <label className="mb-1 block text-xs font-semibold text-fg-muted" htmlFor="signup-phone">
            {t('signup_whatsapp_label')}
           </label>
           <div className="flex gap-2">
            <select
             value={dialCode}
             onChange={(e) => setDialCode(e.target.value)}
             className="w-28 shrink-0 rounded border border-border-strong bg-surface px-2 py-2 text-sm text-fg outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
             aria-label={t('signup_whatsapp_country')}
            >
             {COUNTRY_DIAL_CODES.map((c) => (
              <option key={c.code} value={c.dial}>
               {c.flag} {c.dial}
              </option>
             ))}
            </select>
            <input
             id="signup-phone"
             type="tel"
             value={phone}
             onChange={(e) => setPhone(e.target.value)}
             placeholder={t('signup_whatsapp_placeholder')}
             className={inputClass}
             autoComplete="tel-national"
             inputMode="tel"
             dir="ltr"
             required
             maxLength={20}
            />
           </div>
           <p className="mt-1 text-xs text-fg-faint">{t('signup_whatsapp_hint')}</p>
          </div>
          <div>
           <label className="mb-1 block text-xs font-semibold text-fg-muted" htmlFor="signup-password">
            {t('signup_password_label')}
           </label>
           <div className="relative">
            <input
             id="signup-password"
             type={showPassword ? 'text' : 'password'}
             value={password}
             onChange={(e) => setPassword(e.target.value)}
             placeholder={t('signup_password_placeholder')}
             className={`${inputClass} pr-10`}
             minLength={8}
             required
             autoComplete="new-password"
            />
            <PasswordVisibilityToggle
             shown={showPassword}
             onToggle={() => setShowPassword((current) => !current)}
             showLabel={t('password_show')}
             hideLabel={t('password_hide')}
            />
           </div>
           {password.length > 0 ? (
            <ul className="mt-1.5 space-y-0.5">
             <li className={`flex items-center gap-1.5 text-xs ${pwHasLength ? 'text-good-text' : 'text-fg-faint'}`}>
              <span aria-hidden>{pwHasLength ? '✓' : '○'}</span>
              {t('signup_password_req_length')}
             </li>
             <li className={`flex items-center gap-1.5 text-xs ${pwHasMix ? 'text-good-text' : 'text-fg-faint'}`}>
              <span aria-hidden>{pwHasMix ? '✓' : '○'}</span>
              {t('signup_password_req_mix')}
             </li>
            </ul>
           ) : null}
          </div>
          <div>
           <label className="mb-1 block text-xs font-semibold text-fg-muted" htmlFor="signup-password-confirm">
            {t('signup_confirm_password_label')}
           </label>
           <input
            id="signup-password-confirm"
            type={showPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder={t('signup_confirm_password_placeholder')}
            className={inputClass}
            minLength={8}
            required
            autoComplete="new-password"
           />
           {confirmPassword.length > 0 ? (
            <p className={`mt-1 flex items-center gap-1.5 text-xs font-medium ${pwConfirmMatch ? 'text-good-text' : 'text-bad-text'}`}>
             <span aria-hidden>{pwConfirmMatch ? '✓' : '✕'}</span>
             {pwConfirmMatch ? t('signup_password_match') : t('signup_password_mismatch')}
            </p>
           ) : null}
          </div>

          {error ? (
           <p role="alert" className="rounded border border-red-300 bg-bad-bg px-3 py-2 text-sm text-bad-text">
            {error}
           </p>
          ) : null}

          <button
           type="submit"
           disabled={isSubmitting}
           className="w-full rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
           {isSubmitting ? t('signup_sending_code') : t('signup_continue')}
          </button>
         </form>

         <div className="border-t border-border pt-4 text-center">
          <button
           type="button"
           onClick={() => router.push(nextPath !== '/' ? `/login?next=${encodeURIComponent(nextPath)}` : '/login')}
           className="text-sm text-accent transition hover:text-accent hover:underline"
          >
           {t('signup_already_have')}
          </button>
         </div>
        </>
       )}
      </div>
     </section>
    </div>
   </div>
  </SiteLayout>
 );
}
