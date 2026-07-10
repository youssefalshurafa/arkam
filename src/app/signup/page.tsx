'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { getProviders, signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useStableSession } from '@/hooks/useStableSession';
import SiteLayout from '@/components/marketing/SiteLayout';

export default function SignupPage() {
 const router = useRouter();
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const { status } = useStableSession();

 const [fullName, setFullName] = useState('');
 const [email, setEmail] = useState('');
 const [password, setPassword] = useState('');
 const [confirmPassword, setConfirmPassword] = useState('');
 const [error, setError] = useState('');
 const [isSubmitting, setIsSubmitting] = useState(false);
 const [isGoogleEnabled, setIsGoogleEnabled] = useState(false);
 const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
 // The identifier value the in-flight availability check was fired for, so a slow
 // response for an old value can't overwrite the status of what's now in the box.
 const usernameCheckedFor = useRef('');

 // Live password rules, recomputed on every keystroke to drive the inline checklist.
 const pwHasLength = password.length >= 8;
 const pwHasMix = /[a-zA-Z]/.test(password) && /[0-9]/.test(password);
 const pwConfirmMatch = confirmPassword.length > 0 && password === confirmPassword;

 const checkUsername = async () => {
  const value = email.trim();
  if (!value) {
   setUsernameStatus('idle');
   return;
  }
  usernameCheckedFor.current = value;
  setUsernameStatus('checking');
  try {
   const res = await fetch(`/api/auth/check-username?value=${encodeURIComponent(value)}`);
   const data = (await res.json()) as { available?: boolean };
   // Ignore a stale response if the field changed while this request was in flight.
   if (usernameCheckedFor.current !== value) return;
   setUsernameStatus(data.available ? 'available' : 'taken');
  } catch {
   if (usernameCheckedFor.current === value) setUsernameStatus('idle');
  }
 };

 useEffect(() => {
  if (status === 'authenticated') {
   router.replace('/');
  }
 }, [status, router]);

 useEffect(() => {
  let isMounted = true;
  const loadProviders = async () => {
   try {
    const providers = await getProviders();
    if (!isMounted) return;
    setIsGoogleEnabled(Boolean(providers?.google));
   } catch {
    if (!isMounted) return;
    setIsGoogleEnabled(false);
   }
  };
  void loadProviders();
  return () => {
   isMounted = false;
  };
 }, []);

 const onSubmit = async (event: FormEvent) => {
  event.preventDefault();
  setError('');

  if (usernameStatus === 'taken') {
   setError(t('signup_username_taken'));
   return;
  }
  if (password.length < 8) {
   setError(t('signup_password_too_short'));
   return;
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
   setError(t('signup_password_complexity'));
   return;
  }
  if (password !== confirmPassword) {
   setError(t('signup_password_mismatch'));
   return;
  }

  setIsSubmitting(true);
  try {
   const res = await fetch('/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: fullName, email, password }),
   });
   const payload = (await res.json()) as { ok?: boolean; error?: string };
   if (!res.ok || !payload.ok) {
    throw new Error(payload.error || t('signup_error_failed'));
   }

   const result = await signIn('credentials', { email, password, redirect: false });
   if (!result || result.error) {
    // Account was created but auto sign-in failed for some reason — send them
    // to the login form instead of leaving them stuck on a dead-end screen.
    router.replace('/login');
    return;
   }

   window.localStorage.removeItem('arkam.activeWorkspaceId');
   router.replace('/');
   router.refresh();
  } catch (err) {
   setError(err instanceof Error ? err.message : t('signup_error_generic'));
  } finally {
   setIsSubmitting(false);
  }
 };

 if (status === 'authenticated') {
  return (
   <SiteLayout>
    <div className="flex flex-1 items-center justify-center p-4">
     <div className="w-full max-w-sm">
      <section className="rounded border border-gray-300 bg-white p-6 shadow-md">
       <h2 className="mb-4 text-sm font-semibold text-gray-700">{t('signup_already_signed_in')}</h2>
       <button
        type="button"
        onClick={() => router.push('/')}
        className="rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800"
       >
        {t('signup_go_dashboard')}
       </button>
      </section>
     </div>
    </div>
   </SiteLayout>
  );
 }

 return (
  <SiteLayout>
   <div className="flex flex-1 items-center justify-center p-4">
    <div className="w-full max-w-sm">
     <div className="mb-6 text-center">
      <p className="text-sm text-gray-500">{t('signup_create_account')}</p>
     </div>

     <section className="rounded border border-gray-300 bg-white shadow-md">
      <div className="border-b border-gray-200 bg-gray-50 px-5 py-3 flex items-center justify-between">
       <h2 className="text-sm font-semibold text-gray-700">{t('signup_heading')}</h2>
       <button
        type="button"
        onClick={() => router.push('/login')}
        className="text-sm text-blue-700 transition hover:text-blue-900 hover:underline"
       >
        {t('home_sign_in')}
       </button>
      </div>

      <div className="p-5 space-y-4">
       <p className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-center text-xs font-semibold text-emerald-700">
        {t('signup_trial_badge', { days: 14 })}
       </p>

       {isGoogleEnabled ? (
        <>
         <button
          type="button"
          onClick={() => {
           setError('');
           void signIn('google', { callbackUrl: '/' });
          }}
          className="inline-flex w-full items-center justify-center gap-2 rounded border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50"
         >
          <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-blue-600 text-xs font-bold text-white">G</span>
          {t('signup_google')}
         </button>
         <div className="flex items-center gap-3 text-xs text-gray-400">
          <span className="h-px flex-1 bg-gray-200" />
          <span>{t('signup_or')}</span>
          <span className="h-px flex-1 bg-gray-200" />
         </div>
        </>
       ) : null}

       <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
        <div>
         <label className="mb-1 block text-xs font-semibold text-gray-600">
          {t('signup_full_name')} <span className="font-normal text-gray-400">({t('signup_optional')})</span>
         </label>
         <input
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder={t('signup_full_name')}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
         />
        </div>
        <div>
         <label className="mb-1 block text-xs font-semibold text-gray-600">{t('signup_email')}</label>
         <input
          type="text"
          value={email}
          onChange={(e) => {
           setEmail(e.target.value);
           setUsernameStatus('idle');
          }}
          onBlur={() => void checkUsername()}
          placeholder={t('signup_email')}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          autoComplete="username"
          autoCapitalize="none"
          required
         />
         {usernameStatus === 'checking' ? (
          <p className="mt-1 text-xs text-gray-400">{t('signup_username_checking')}</p>
         ) : usernameStatus === 'available' ? (
          <p className="mt-1 text-xs font-medium text-emerald-600">✓ {t('signup_username_available')}</p>
         ) : usernameStatus === 'taken' ? (
          <p className="mt-1 text-xs font-medium text-red-600">✕ {t('signup_username_taken')}</p>
         ) : null}
        </div>
        <div>
         <label className="mb-1 block text-xs font-semibold text-gray-600">{t('signup_password_label')}</label>
         <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('signup_password_placeholder')}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          minLength={8}
          required
          autoComplete="new-password"
         />
         {password.length > 0 ? (
          <ul className="mt-1.5 space-y-0.5">
           <li className={`flex items-center gap-1.5 text-xs ${pwHasLength ? 'text-emerald-600' : 'text-gray-400'}`}>
            <span aria-hidden>{pwHasLength ? '✓' : '○'}</span>
            {t('signup_password_req_length')}
           </li>
           <li className={`flex items-center gap-1.5 text-xs ${pwHasMix ? 'text-emerald-600' : 'text-gray-400'}`}>
            <span aria-hidden>{pwHasMix ? '✓' : '○'}</span>
            {t('signup_password_req_mix')}
           </li>
          </ul>
         ) : null}
        </div>
        <div>
         <label className="mb-1 block text-xs font-semibold text-gray-600">{t('signup_confirm_password_label')}</label>
         <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder={t('signup_confirm_password_placeholder')}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          minLength={8}
          required
          autoComplete="new-password"
         />
         {confirmPassword.length > 0 ? (
          <p className={`mt-1 flex items-center gap-1.5 text-xs font-medium ${pwConfirmMatch ? 'text-emerald-600' : 'text-red-600'}`}>
           <span aria-hidden>{pwConfirmMatch ? '✓' : '✕'}</span>
           {pwConfirmMatch ? t('signup_password_match') : t('signup_password_mismatch')}
          </p>
         ) : null}
        </div>

        {error ? <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

        <button
         type="submit"
         disabled={isSubmitting}
         className="w-full rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
         {isSubmitting ? t('signup_sending') : t('signup_continue')}
        </button>
       </form>

       <div className="border-t border-gray-200 pt-4 text-center">
        <button
         type="button"
         onClick={() => router.push('/login')}
         className="text-sm text-blue-700 transition hover:text-blue-900 hover:underline"
        >
         {t('signup_already_have')}
        </button>
       </div>
      </div>
     </section>
    </div>
   </div>
  </SiteLayout>
 );
}
