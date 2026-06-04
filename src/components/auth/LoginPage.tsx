'use client';

import { FormEvent, useEffect, useState } from 'react';
import { getProviders, signIn, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';

export default function LoginPage() {
 const router = useRouter();
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const { status } = useSession();

 const [email, setEmail] = useState('');
 const [password, setPassword] = useState('');
 const [showPassword, setShowPassword] = useState(false);
 const [error, setError] = useState('');
 const [isSubmitting, setIsSubmitting] = useState(false);
 const [isGoogleEnabled, setIsGoogleEnabled] = useState(false);

 useEffect(() => {
  if (status === 'authenticated') {
   router.replace('/');
  }
 }, [router, status]);

 useEffect(() => {
  let isMounted = true;

  const loadProviders = async () => {
   try {
    const providers = await getProviders();
    if (!isMounted) {
     return;
    }
    setIsGoogleEnabled(Boolean(providers?.google));
   } catch {
    if (!isMounted) {
     return;
    }
    setIsGoogleEnabled(false);
   }
  };

  void loadProviders();

  return () => {
   isMounted = false;
  };
 }, []);

 const onLogin = async (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  setError('');
  setIsSubmitting(true);

  try {
   const result = await signIn('credentials', {
    email,
    password,
    redirect: false,
   });

   if (!result || result.error) {
    throw new Error(result?.error || 'Login failed.');
   }

   router.replace('/');
   router.refresh();
  } catch (loginError) {
   setError(loginError instanceof Error ? loginError.message : 'Login failed.');
  } finally {
   setIsSubmitting(false);
  }
 };

 if (status === 'loading') {
  return (
   <main
    className="flex min-h-screen items-center justify-center p-6"
    style={{
     background:
      'radial-gradient(circle at top, rgba(34,211,238,0.14), transparent 34%), radial-gradient(circle at bottom right, rgba(59,130,246,0.18), transparent 30%), linear-gradient(180deg, #020617 0%, #0f172a 100%)',
    }}
   >
    <div className="rounded-3xl border border-white/10 bg-slate-900/95 px-6 py-4 text-sm text-slate-200 shadow-sm">{t('loading')}</div>
   </main>
  );
 }

 return (
  <main
   className="flex min-h-screen items-center justify-center p-4 text-slate-900 sm:p-6 lg:p-8"
   style={{
    background:
     'radial-gradient(circle at top, rgba(34,211,238,0.14), transparent 34%), radial-gradient(circle at bottom right, rgba(59,130,246,0.18), transparent 30%), linear-gradient(180deg, #020617 0%, #0f172a 100%)',
   }}
  >
   <section className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900/95 p-6 text-slate-100 shadow-[0_24px_60px_-32px_rgba(15,23,42,0.35)] sm:p-8 lg:p-9">
    <div className="flex items-start justify-between gap-4">
     <div>
      <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-100">
       {t('login_title')}
      </div>
      <h2 className="mt-4 text-2xl font-semibold tracking-tight text-white">{t('login_title')}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-300">{t('login_description')}</p>
     </div>
    </div>

    <button
     type="button"
     onClick={() => {
      if (!isGoogleEnabled) {
       setError('Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, then restart the app.');
       return;
      }

      setError('');
      void signIn('google', { callbackUrl: '/' });
     }}
     disabled={!isGoogleEnabled}
     className="mt-7 inline-flex w-auto items-center justify-center gap-3 self-start rounded-2xl border border-white/15 bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_30px_-18px_rgba(15,23,42,0.65)] transition hover:bg-slate-900"
    >
     <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-xs font-bold">G</span>
     {isGoogleEnabled ? t('login_google') : 'Google unavailable'}
    </button>

    <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-[0.24em] text-slate-400">
     <span className="h-px flex-1 bg-white/15" />
     <span>{t('login_or')}</span>
     <span className="h-px flex-1 bg-white/15" />
    </div>

    <form
     className="space-y-4"
     onSubmit={(event) => void onLogin(event)}
    >
     <div className="space-y-2">
      <label className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-300">{t('login_email')}</label>
      <input
       type="email"
       value={email}
       onChange={(event) => setEmail(event.target.value)}
       placeholder={t('login_email')}
       className="w-full rounded-2xl border border-white/15 bg-slate-800 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-400 focus:border-cyan-300/70 focus:bg-slate-800 focus:ring-4 focus:ring-cyan-300/20"
       required
      />
     </div>

     <div className="space-y-2">
      <label className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-300">{t('login_password')}</label>
      <div
       className="relative"
       style={{ position: 'relative' }}
      >
       <input
        type={showPassword ? 'text' : 'password'}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder={t('login_password')}
        className="w-full rounded-2xl border border-white/15 bg-slate-800 px-4 py-3 pr-14 text-sm text-slate-100 outline-none transition placeholder:text-slate-400 focus:border-cyan-300/70 focus:bg-slate-800 focus:ring-4 focus:ring-cyan-300/20"
        style={{ paddingRight: '3.5rem' }}
        minLength={8}
        required
       />
       <button
        type="button"
        onClick={() => setShowPassword((current) => !current)}
        aria-label={showPassword ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-0 inline-flex w-12 items-center justify-center rounded-r-2xl text-slate-400 transition hover:text-slate-200"
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0 }}
       >
        {showPassword ? (
         <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="h-5 w-5"
          aria-hidden="true"
         >
          <path
           strokeLinecap="round"
           strokeLinejoin="round"
           d="M3 3l18 18"
          />
          <path
           strokeLinecap="round"
           strokeLinejoin="round"
           d="M10.58 10.58a2 2 0 102.83 2.83"
          />
          <path
           strokeLinecap="round"
           strokeLinejoin="round"
           d="M9.88 5.09A9.77 9.77 0 0112 4.88c4.36 0 8.06 2.69 9.44 6.5a9.73 9.73 0 01-4.02 5.01"
          />
          <path
           strokeLinecap="round"
           strokeLinejoin="round"
           d="M6.61 6.61A9.75 9.75 0 002.56 11.38 10.75 10.75 0 006.5 16.2"
          />
         </svg>
        ) : (
         <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="h-5 w-5"
          aria-hidden="true"
         >
          <path
           strokeLinecap="round"
           strokeLinejoin="round"
           d="M2.56 11.38C3.94 7.57 7.64 4.88 12 4.88s8.06 2.69 9.44 6.5c-1.38 3.81-5.08 6.5-9.44 6.5s-8.06-2.69-9.44-6.5z"
          />
          <circle
           cx="12"
           cy="11.38"
           r="3"
          />
         </svg>
        )}
       </button>
      </div>
     </div>

     {error ? <p className="rounded-2xl border border-red-400/35 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p> : null}

     <button
      type="submit"
      disabled={isSubmitting}
      className="inline-flex w-auto items-center justify-center self-start rounded-2xl bg-blue-700 px-6 py-3 text-sm font-semibold text-white shadow-[0_14px_30px_-18px_rgba(29,78,216,0.9)] transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-70"
     >
      {isSubmitting ? t('loading') : t('login_submit')}
     </button>
    </form>

    <button
     type="button"
     onClick={() => router.push('/signup')}
     className="mt-5 inline-flex text-sm font-medium text-blue-700 underline decoration-blue-300 underline-offset-4 transition hover:text-blue-800"
    >
     {t('login_signup_prompt')}
    </button>
   </section>
  </main>
 );
}
