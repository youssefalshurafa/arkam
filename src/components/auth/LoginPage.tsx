'use client';

import { FormEvent, useEffect, useState } from 'react';
import { getProviders, signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useStableSession } from '@/hooks/useStableSession';
import SiteLayout from '@/components/marketing/SiteLayout';
import { safeNextPath } from '@/shared/lib/safeNextPath';

// Login hints that belong to the DEVICE, not the account, so they deliberately avoid the
// `arkam:` / `arkam.` prefixes that the cache purges wipe. Only the identifier is ever kept —
// the old "Remember me" also stored the plaintext password in localStorage.
const rememberedIdentifierKey = 'arkam-login:identifier';
const keepSignedInKey = 'arkam-login:keep-signed-in';
const legacyRememberedKeys = ['arkam.rememberedEmail', 'arkam.rememberedPassword'];

function readStorage(key: string): string | null {
 try {
  return window.localStorage.getItem(key);
 } catch {
  return null;
 }
}

function writeStorage(key: string, value: string | null) {
 try {
  if (value === null) window.localStorage.removeItem(key);
  else window.localStorage.setItem(key, value);
 } catch {
  /* private mode — non-essential */
 }
}

function getLoginErrorMessage(code: string, t: (key: string, params?: Record<string, string | number>) => string) {
 if (code === 'CredentialsSignin') return t('login_invalid_credentials');
 if (code === 'PENDING_APPROVAL') return t('login_pending_approval');
 if (code === 'ACCESS_REJECTED') return t('login_access_rejected');
 if (code === 'SUBSCRIPTION_EXPIRED') return t('login_subscription_expired');
 if (code === 'MFA_INVALID') return t('login_mfa_invalid');
 if (code === 'MFA_LOCKED') return t('login_mfa_locked');
 if (code === 'GOOGLE_EMAIL_UNVERIFIED') return t('login_google_unverified');
 if (code === 'GOOGLE_ACCOUNT_CONFLICT') return t('login_google_conflict');
 if (code === 'MFA_CHALLENGE_EXPIRED') return t('login_mfa_challenge_expired');
 if (code.startsWith('LOGIN_LOCKED')) {
  const minutes = Number(code.split(':')[1]) || 15;
  return t('login_locked', { minutes });
 }
 return t('login_failed');
}

export default function LoginPage() {
 const router = useRouter();
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const { status } = useStableSession();

 const [email, setEmail] = useState('');
 const [password, setPassword] = useState('');
 const [keepSignedIn, setKeepSignedIn] = useState(true);
 const [showPassword, setShowPassword] = useState(false);
 const [mfaStep, setMfaStep] = useState(false);
 const [otp, setOtp] = useState('');
 const [errorCode, setErrorCode] = useState('');
 const [isSubmitting, setIsSubmitting] = useState(false);
 const [isGoogleEnabled, setIsGoogleEnabled] = useState(false);
 const [nextPath, setNextPath] = useState('/');

 useEffect(() => {
  if (status === 'authenticated') {
   window.location.replace(nextPath);
  }
 }, [status, nextPath]);

 // Google sign-in can't surface an error inline (it's a full redirect), so a blocked
 // OAuth login lands back here with ?authError=...&authEmail=... from the signIn
 // callback in auth-options.ts instead. ?next= carries a post-login destination
 // (e.g. an invite link), validated to a same-site path.
 useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const next = safeNextPath(params.get('next'));
  const authError = params.get('authError');
  const authEmail = params.get('authEmail');

  for (const key of legacyRememberedKeys) writeStorage(key, null);
  const remembered = readStorage(rememberedIdentifierKey);
  const keep = readStorage(keepSignedInKey);

  // One batched update from the URL/storage snapshot (no cascading effect renders).
  setNextPath(next);
  if (authError) setErrorCode(authError);
  if (authEmail) setEmail(authEmail);
  else if (remembered) setEmail(remembered);
  if (keep === 'false') setKeepSignedIn(false);
 }, []);

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

 const onLogin = async (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  setErrorCode('');
  setIsSubmitting(true);

  try {
   writeStorage(keepSignedInKey, keepSignedIn ? 'true' : 'false');
   writeStorage(rememberedIdentifierKey, keepSignedIn ? email.trim() : null);

   const result = await signIn('credentials', {
    email,
    password,
    remember: keepSignedIn ? 'true' : 'false',
    ...(mfaStep ? { otp: otp.replace(/\s+/g, '') } : {}),
    redirect: false,
   });

   if (!result || result.error) {
    const code = result?.error || 'LOGIN_FAILED';
    if (code === 'MFA_REQUIRED') {
     setMfaStep(true);
     setOtp('');
     return;
    }
    setErrorCode(code);
    return;
   }

   // Full page load (not a router transition): nothing from a previous session — the
   // SessionProvider's cached session, React Query's in-memory data — survives into this one.
   window.location.assign(nextPath);
  } catch {
   setErrorCode('LOGIN_FAILED');
  } finally {
   setIsSubmitting(false);
  }
 };

 const displayedError = errorCode ? getLoginErrorMessage(errorCode, t) : '';

 if (status === 'loading' || status === 'authenticated') {
  return (
   <SiteLayout hideSignIn>
    <div className="flex flex-1 items-center justify-center p-4">
     <div className="rounded border border-border-strong bg-surface px-6 py-4 text-sm text-fg-muted shadow-sm">{t('loading')}</div>
    </div>
   </SiteLayout>
  );
 }

 const inputClass =
  'w-full rounded border border-border-strong bg-surface px-3 py-2 text-sm text-fg outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500';

 return (
  <SiteLayout hideSignIn>
   <div className="flex flex-1 items-center justify-center p-4">
    <div className="w-full max-w-sm">
     <div className="mb-6 text-center">
      <p className="text-sm text-fg-faint">{t('app_description')}</p>
     </div>

     <section className="rounded border border-border-strong bg-surface shadow-md">
      <div className="border-b border-border bg-surface-2 px-5 py-3">
       <h2 className="text-sm font-semibold text-fg-muted">{mfaStep ? t('login_mfa_title') : t('login_title')}</h2>
      </div>

      <div className="p-5">
       {isGoogleEnabled && !mfaStep ? (
        <>
         <button
          type="button"
          onClick={() => {
           setErrorCode('');
           void signIn('google', { callbackUrl: nextPath });
          }}
          className="inline-flex w-full items-center justify-center gap-2 rounded border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-fg-muted shadow-sm transition hover:bg-surface-hover"
         >
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">G</span>
          {t('login_google')}
         </button>
         <div className="my-4 flex items-center gap-3 text-xs text-fg-faint">
          <span className="h-px flex-1 bg-border" />
          <span>{t('login_or')}</span>
          <span className="h-px flex-1 bg-border" />
         </div>
        </>
       ) : null}

       <form className="space-y-4" onSubmit={(event) => void onLogin(event)}>
        {mfaStep ? (
         <div>
          <p className="mb-3 text-sm text-fg-muted">{t('login_mfa_desc')}</p>
          <label className="mb-1 block text-xs font-semibold text-fg-muted" htmlFor="login-otp">
           {t('login_mfa_code')}
          </label>
          <input
           id="login-otp"
           type="text"
           inputMode="text"
           value={otp}
           onChange={(event) => setOtp(event.target.value)}
           placeholder="123456"
           className={`${inputClass} tracking-widest`}
           required
           autoFocus
           autoComplete="one-time-code"
           autoCapitalize="none"
           autoCorrect="off"
           spellCheck={false}
           maxLength={20}
          />
         </div>
        ) : (
         <>
          <div>
           <label className="mb-1 block text-xs font-semibold text-fg-muted" htmlFor="login-identifier">
            {t('login_email')}
           </label>
           <input
            id="login-identifier"
            type="text"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={t('login_email')}
            className={inputClass}
            required
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
           />
          </div>

          <div>
           <label className="mb-1 block text-xs font-semibold text-fg-muted" htmlFor="login-password">
            {t('login_password')}
           </label>
           <div className="relative">
            <input
             id="login-password"
             type={showPassword ? 'text' : 'password'}
             value={password}
             onChange={(event) => setPassword(event.target.value)}
             placeholder={t('login_password')}
             className={`${inputClass} pr-10`}
             required
             autoComplete="current-password"
             autoCapitalize="none"
             autoCorrect="off"
             spellCheck={false}
            />
            <button
             type="button"
             onClick={() => setShowPassword((current) => !current)}
             aria-label={showPassword ? t('login_hide_password') : t('login_show_password')}
             className="absolute inset-y-0 right-0 inline-flex w-9 items-center justify-center text-fg-faint transition hover:text-fg-muted"
            >
             <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
              {showPassword ? (
               <>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.58 10.58a2 2 0 102.83 2.83" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.88 5.09A9.77 9.77 0 0112 4.88c4.36 0 8.06 2.69 9.44 6.5a9.73 9.73 0 01-4.02 5.01" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.61 6.61A9.75 9.75 0 002.56 11.38 10.75 10.75 0 006.5 16.2" />
               </>
              ) : (
               <>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.56 11.38C3.94 7.57 7.64 4.88 12 4.88s8.06 2.69 9.44 6.5c-1.38 3.81-5.08 6.5-9.44 6.5s-8.06-2.69-9.44-6.5z" />
                <circle cx="12" cy="11.38" r="3" />
               </>
              )}
             </svg>
            </button>
           </div>
          </div>

          <div className="flex items-center justify-between gap-2">
           <label className="inline-flex items-center gap-2 text-sm text-fg-muted">
            <input
             type="checkbox"
             checked={keepSignedIn}
             onChange={(event) => setKeepSignedIn(event.target.checked)}
             className="h-4 w-4 rounded border-border-strong text-accent focus:ring-blue-500"
            />
            {t('login_keep_signed_in')}
           </label>
           <button
            type="button"
            onClick={() => router.push('/forgot-password')}
            className="text-sm text-accent transition hover:text-accent hover:underline"
           >
            {t('login_forgot_password')}
           </button>
          </div>
         </>
        )}

        {displayedError ? (
         <div role="alert" className="rounded border border-red-300 bg-bad-bg px-3 py-2 text-sm text-bad-text">
          <p>{displayedError}</p>
          {errorCode === 'SUBSCRIPTION_EXPIRED' ? (
           <button
            type="button"
            onClick={() => router.push(`/renew${email ? `?email=${encodeURIComponent(email)}` : ''}`)}
            className="mt-2 inline-flex rounded border border-red-700 bg-red-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-800"
           >
            {t('subscription_banner_renew')}
           </button>
          ) : null}
         </div>
        ) : null}

        <button
         type="submit"
         disabled={isSubmitting}
         className="w-full rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
         {isSubmitting ? t('loading') : mfaStep ? t('login_mfa_verify') : t('login_submit')}
        </button>

        {mfaStep ? (
         <button
          type="button"
          onClick={() => {
           setMfaStep(false);
           setOtp('');
           setPassword('');
           setErrorCode('');
          }}
          className="block w-full text-center text-sm text-accent transition hover:underline"
         >
          {t('login_mfa_back')}
         </button>
        ) : null}
       </form>

       {!mfaStep ? (
        <div className="mt-4 border-t border-border pt-4 text-center">
         <button
          type="button"
          onClick={() => router.push(nextPath !== '/' ? `/signup?next=${encodeURIComponent(nextPath)}` : '/signup')}
          className="text-sm text-accent transition hover:text-accent hover:underline"
         >
          {t('login_signup_prompt')}
         </button>
        </div>
       ) : null}
      </div>
     </section>
    </div>
   </div>
  </SiteLayout>
 );
}
