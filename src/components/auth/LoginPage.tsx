'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
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
 const [error, setError] = useState('');
 const [isSubmitting, setIsSubmitting] = useState(false);
 const [isGoogleEnabled, setIsGoogleEnabled] = useState(false);

 const title = useMemo(() => t('app_title'), [t]);

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
   <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
    <div className="rounded-3xl border border-slate-200 bg-white px-6 py-4 text-sm text-slate-600 shadow-sm">{t('loading')}</div>
   </main>
  );
 }

 return (
  <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(30,64,175,0.16),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(34,211,238,0.12),transparent_28%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] px-4 py-5 text-slate-900 sm:px-6 lg:px-8">
   <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] w-full max-w-6xl items-center">
    <div className="grid w-full gap-6 overflow-hidden rounded-4xl border border-slate-800 bg-slate-950 shadow-[0_28px_80px_-40px_rgba(15,23,42,0.85)] lg:grid-cols-[1fr_0.92fr] lg:gap-10">
     <section className="relative overflow-hidden bg-linear-to-br from-slate-950 via-slate-900 to-cyan-950 p-8 text-white sm:p-10 lg:p-12">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.22),transparent_36%),radial-gradient(circle_at_20%_80%,rgba(59,130,246,0.18),transparent_28%)]" />
      <div className="relative flex h-full flex-col">
       <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100">
        <span className="h-2 w-2 rounded-full bg-cyan-300" />
        Private access
       </div>

       <div className="mt-10 max-w-xl space-y-6 lg:mt-16">
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-200">Arkam</p>
        <h1 className="text-4xl font-semibold leading-tight tracking-tight text-white sm:text-5xl lg:text-[3.4rem]">{title}</h1>
        <p className="max-w-lg text-sm leading-7 text-slate-300 sm:text-base">{t('app_description')}</p>
       </div>

       <div className="mt-10 grid gap-3 sm:max-w-2xl sm:grid-cols-3 lg:mt-14">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur">
         <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Secure</p>
         <p className="mt-2 text-sm leading-6 text-slate-200">Session-gated access</p>
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur">
         <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Workspace</p>
         <p className="mt-2 text-sm leading-6 text-slate-200">One account, one data space</p>
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur">
         <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Local</p>
         <p className="mt-2 text-sm leading-6 text-slate-200">SQLite-backed app data</p>
        </div>
       </div>

       <div className="mt-10 flex flex-wrap items-center gap-3 text-sm text-slate-300 lg:mt-auto lg:pt-16">
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">Fast sign in</span>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">Arabic and French ready</span>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">Desktop-friendly</span>
       </div>

       <button
        type="button"
        onClick={() => router.push('/signup')}
        className="mt-12 inline-flex w-auto max-w-max shrink-0 items-center justify-center self-start rounded-2xl border border-cyan-300/20 bg-cyan-400/10 px-4 py-2.5 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-400/15"
       >
        {t('signup_link')}
       </button>
      </div>
     </section>

     <section className="flex items-center bg-slate-50 p-5 sm:p-7 lg:p-10">
      <div className="w-full">
       <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-[0_24px_60px_-32px_rgba(15,23,42,0.35)] sm:p-8 lg:p-9">
        <div className="flex items-start justify-between gap-4">
         <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-700">
           {t('login_title')}
          </div>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">{t('login_title')}</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-slate-600">{t('login_description')}</p>
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
         className="mt-7 inline-flex w-auto items-center justify-center gap-3 self-start rounded-2xl border border-slate-200 bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_30px_-18px_rgba(15,23,42,0.65)] transition hover:bg-slate-900"
        >
         <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-xs font-bold">G</span>
         {isGoogleEnabled ? t('login_google') : 'Google unavailable'}
        </button>

        <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-[0.24em] text-slate-400">
         <span className="h-px flex-1 bg-slate-200" />
         <span>{t('login_or')}</span>
         <span className="h-px flex-1 bg-slate-200" />
        </div>

        <form
         className="space-y-4"
         onSubmit={(event) => void onLogin(event)}
        >
         <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">{t('login_email')}</label>
          <input
           type="email"
           value={email}
           onChange={(event) => setEmail(event.target.value)}
           placeholder={t('login_email')}
           className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:bg-white focus:ring-4 focus:ring-cyan-300/20"
           required
          />
         </div>

         <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">{t('login_password')}</label>
          <input
           type="password"
           value={password}
           onChange={(event) => setPassword(event.target.value)}
           placeholder={t('login_password')}
           className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:bg-white focus:ring-4 focus:ring-cyan-300/20"
           minLength={8}
           required
          />
         </div>

         {error ? <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

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
       </div>
      </div>
     </section>
    </div>
   </div>
  </main>
 );
}
