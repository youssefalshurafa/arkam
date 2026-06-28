'use client';

import { FormEvent, useEffect, useState } from 'react';
import { getProviders, signIn, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import SiteLayout from '@/components/marketing/SiteLayout';

export default function SignupPage() {
 const router = useRouter();
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const { status } = useSession();

 const [fullName, setFullName] = useState('');
 const [email, setEmail] = useState('');
 const [phone, setPhone] = useState('');
 const [company, setCompany] = useState('');
 const [country, setCountry] = useState('');
 const [error, setError] = useState('');
 const [isSubmitting, setIsSubmitting] = useState(false);
 const [isGoogleEnabled, setIsGoogleEnabled] = useState(false);
 const [emailSent, setEmailSent] = useState(false);

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
  setIsSubmitting(true);
  try {
   const res = await fetch('/api/auth/signup/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: fullName, email, phone, company, country }),
   });
   const payload = (await res.json()) as { ok?: boolean; error?: string };
   if (!res.ok || !payload.ok) {
    throw new Error(payload.error || t('signup_error_failed'));
   }
   setEmailSent(true);
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

 if (emailSent) {
  return (
   <SiteLayout>
    <div className="flex flex-1 items-center justify-center p-4">
     <div className="w-full max-w-sm">
      <section className="rounded border border-gray-300 bg-white p-8 shadow-md text-center">
       <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-4xl">✉️</div>
       <h2 className="mb-2 text-base font-semibold text-gray-900">{t('signup_check_inbox_title')}</h2>
       <p className="mb-1 text-sm text-gray-600">{t('signup_check_inbox_sent')}</p>
       <p className="mb-5 text-sm font-semibold text-gray-900 break-all">{email}</p>
       <p className="text-xs text-gray-400 mb-5">{t('signup_check_inbox_hint')}</p>
       <button
        type="button"
        onClick={() => {
         setEmailSent(false);
         setError('');
        }}
        className="text-sm text-blue-700 hover:underline"
       >
        {t('signup_wrong_email')}
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
         <label className="mb-1 block text-xs font-semibold text-gray-600">{t('signup_full_name')}</label>
         <input
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder={t('signup_full_name')}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          required
         />
        </div>
        <div>
         <label className="mb-1 block text-xs font-semibold text-gray-600">{t('signup_email')}</label>
         <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('signup_email')}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          required
         />
        </div>
        <div>
         <label className="mb-1 block text-xs font-semibold text-gray-600">
          {t('signup_phone')} <span className="font-normal text-gray-400">({t('signup_optional')})</span>
         </label>
         <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={t('signup_phone')}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          dir="ltr"
         />
        </div>
        <div>
         <label className="mb-1 block text-xs font-semibold text-gray-600">
          {t('signup_company')} <span className="font-normal text-gray-400">({t('signup_optional')})</span>
         </label>
         <input
          type="text"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder={t('signup_company')}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
         />
        </div>
        <div>
         <label className="mb-1 block text-xs font-semibold text-gray-600">
          {t('signup_country')} <span className="font-normal text-gray-400">({t('signup_optional')})</span>
         </label>
         <input
          type="text"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          placeholder={t('signup_country')}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
         />
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
