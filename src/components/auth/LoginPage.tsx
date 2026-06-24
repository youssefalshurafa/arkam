'use client';

import { FormEvent, useEffect, useState } from 'react';
import { getProviders, signIn, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';

const rememberedEmailStorageKey = 'arkam.rememberedEmail';
const rememberedPasswordStorageKey = 'arkam.rememberedPassword';

function getLoginErrorMessage(message: string, t: (key: string) => string) {
 if (message === 'CredentialsSignin') {
  return t('login_invalid_credentials');
 }

 return message;
}

export default function LoginPage() {
 const router = useRouter();
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const { status } = useSession();

 const [email, setEmail] = useState('');
 const [password, setPassword] = useState('');
 const [rememberMe, setRememberMe] = useState(false);
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
  if (typeof window === 'undefined') {
   return;
  }

  const rememberedEmail = window.localStorage.getItem(rememberedEmailStorageKey);
  if (!rememberedEmail) {
   return;
  }

  setEmail(rememberedEmail);
  const rememberedPassword = window.localStorage.getItem(rememberedPasswordStorageKey);
  if (rememberedPassword) {
   setPassword(rememberedPassword);
  }
  setRememberMe(true);
 }, []);

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
   if (typeof window !== 'undefined') {
    if (rememberMe) {
     window.localStorage.setItem(rememberedEmailStorageKey, email.trim());
     window.localStorage.setItem(rememberedPasswordStorageKey, password);
    } else {
     window.localStorage.removeItem(rememberedEmailStorageKey);
     window.localStorage.removeItem(rememberedPasswordStorageKey);
    }
   }

   const result = await signIn('credentials', {
    email,
    password,
    redirect: false,
   });

   if (!result || result.error) {
    throw new Error(getLoginErrorMessage(result?.error || t('login_failed'), t));
   }

   // Clear any stale workspace ID from a previous session so the
   // session's defaultWorkspaceId (scoped to the new user) is used.
   if (typeof window !== 'undefined') {
    window.localStorage.removeItem('arkam.activeWorkspaceId');
   }

   router.replace('/');
   router.refresh();
  } catch (loginError) {
   setError(loginError instanceof Error ? loginError.message : t('login_failed'));
  } finally {
   setIsSubmitting(false);
  }
 };

 if (status === 'loading') {
  return (
   <main className="flex min-h-screen items-center justify-center bg-gray-100">
    <div className="rounded border border-gray-300 bg-white px-6 py-4 text-sm text-gray-700 shadow-sm">{t('loading')}</div>
   </main>
  );
 }

 return (
  <main className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
   <div className="w-full max-w-sm">
    {/* App header */}
    <div className="mb-6 text-center">
     <div className="inline-flex items-center justify-center rounded bg-blue-800 px-4 py-2 mb-3">
      <span className="text-lg font-bold tracking-widest text-white">ARKAM</span>
     </div>
     <p className="text-sm text-gray-500">{t('app_description')}</p>
    </div>

    {/* Login card */}
    <section className="rounded border border-gray-300 bg-white shadow-md">
     {/* Card title bar */}
     <div className="border-b border-gray-200 bg-gray-50 px-5 py-3">
      <h2 className="text-sm font-semibold text-gray-700">{t('login_title')}</h2>
     </div>

     <div className="p-5">
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
         <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">G</span>
         {t('login_google')}
        </button>
        <div className="my-4 flex items-center gap-3 text-xs text-gray-400">
         <span className="h-px flex-1 bg-gray-200" />
         <span>{t('login_or')}</span>
         <span className="h-px flex-1 bg-gray-200" />
        </div>
       </>
      ) : null}

      <form
       className="space-y-4"
       onSubmit={(event) => void onLogin(event)}
      >
       <div>
        <label className="mb-1 block text-xs font-semibold text-gray-600">{t('login_email')}</label>
        <input
         type="email"
         value={email}
         onChange={(event) => setEmail(event.target.value)}
         placeholder={t('login_email')}
         className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
         required
        />
       </div>

       <div>
        <label className="mb-1 block text-xs font-semibold text-gray-600">{t('login_password')}</label>
        <div className="relative">
         <input
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={t('login_password')}
          className="w-full rounded border border-gray-300 px-3 py-2 pr-10 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          minLength={8}
          required
         />
         <button
          type="button"
          onClick={() => setShowPassword((current) => !current)}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
          className="absolute inset-y-0 right-0 inline-flex w-9 items-center justify-center text-gray-400 transition hover:text-gray-600"
         >
          {showPassword ? (
           <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            width="16"
            height="16"
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
            width="16"
            height="16"
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

       <div className="flex items-center justify-between">
        <label className="inline-flex items-center gap-2 text-sm text-gray-600">
         <input
          type="checkbox"
          checked={rememberMe}
          onChange={(event) => setRememberMe(event.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
         />
         Remember me
        </label>
        <button
         type="button"
         onClick={() => router.push('/forgot-password')}
         className="text-sm text-blue-700 transition hover:text-blue-900 hover:underline"
        >
         Forgot password?
        </button>
       </div>

       {error ? <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

       <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
       >
        {isSubmitting ? t('loading') : t('login_submit')}
       </button>
      </form>

      <div className="mt-4 border-t border-gray-200 pt-4 text-center">
       <button
        type="button"
        onClick={() => router.push('/signup')}
        className="text-sm text-blue-700 transition hover:text-blue-900 hover:underline"
       >
        {t('login_signup_prompt')}
       </button>
      </div>
     </div>
    </section>
   </div>
  </main>
 );
}
