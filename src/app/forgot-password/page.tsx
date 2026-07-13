'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';

type CheckStatus = 'idle' | 'checking' | 'found' | 'notfound';

export default function ForgotPasswordPage() {
 const router = useRouter();
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const [identifier, setIdentifier] = useState('');
 const [error, setError] = useState('');
 const [emailSent, setEmailSent] = useState(false);
 const [needsSupport, setNeedsSupport] = useState(false);
 const [isSubmitting, setIsSubmitting] = useState(false);
 const [checkStatus, setCheckStatus] = useState<CheckStatus>('idle');

 // Live account lookup: debounce the typed identifier and ask the server whether an account exists
 // so the user gets immediate "no account found" feedback before submitting.
 useEffect(() => {
  const value = identifier.trim();
  if (!value) {
   setCheckStatus('idle');
   return;
  }

  setCheckStatus('checking');
  const controller = new AbortController();
  const timer = setTimeout(() => {
   void (async () => {
    try {
     const response = await fetch('/api/auth/check-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: value }),
      signal: controller.signal,
     });
     const payload = (await response.json()) as { exists?: boolean };
     setCheckStatus(payload.exists ? 'found' : 'notfound');
    } catch (checkError) {
     if (!(checkError instanceof DOMException && checkError.name === 'AbortError')) {
      // If the check fails, don't block the user — let submit be the source of truth.
      setCheckStatus('idle');
     }
    }
   })();
  }, 400);

  return () => {
   controller.abort();
   clearTimeout(timer);
  };
 }, [identifier]);

 const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  setError('');
  setIsSubmitting(true);

  try {
   const response = await fetch('/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: identifier.trim() }),
   });

   const payload = (await response.json()) as { ok?: boolean; emailable?: boolean; error?: string };

   if (response.status === 404 || payload.error === 'no_account') {
    setCheckStatus('notfound');
    throw new Error(t('forgot_password_user_not_found'));
   }

   if (!response.ok) {
    throw new Error(payload.error || t('forgot_password_failed'));
   }

   // Account exists but has no deliverable email (username-only) — route to the support flow.
   if (payload.emailable === false) {
    setNeedsSupport(true);
    return;
   }

   setEmailSent(true);
  } catch (requestError) {
   setError(requestError instanceof Error ? requestError.message : t('forgot_password_failed'));
  } finally {
   setIsSubmitting(false);
  }
 };

 const cardShell = (children: React.ReactNode) => (
  <main className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
   <div className="w-full max-w-sm">
    <div className="mb-6 text-center">
     <div className="inline-flex items-center justify-center rounded bg-blue-800 px-4 py-2 mb-3">
      <span className="text-lg font-bold tracking-widest text-white">ARKAM</span>
     </div>
    </div>
    {children}
   </div>
  </main>
 );

 if (emailSent) {
  return cardShell(
   <section className="rounded border border-gray-300 bg-white p-8 shadow-md text-center">
    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-4xl">
     ✉️
    </div>
    <h2 className="mb-2 text-base font-semibold text-gray-900">{t('forgot_password_sent_title')}</h2>
    <p className="mb-1 text-sm text-gray-600">{t('forgot_password_sent_line1')}</p>
    <p className="mb-4 text-sm font-semibold text-gray-900 break-all">{identifier}</p>
    <p className="text-xs text-gray-400 mb-6">{t('forgot_password_sent_line2')}</p>
    <button
     type="button"
     onClick={() => router.push('/login')}
     className="text-sm text-blue-700 hover:underline"
    >
     {t('set_password_back_to_sign_in')}
    </button>
   </section>,
  );
 }

 if (needsSupport) {
  return cardShell(
   <section className="rounded border border-gray-300 bg-white p-8 shadow-md text-center">
    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-4xl">
     🛟
    </div>
    <h2 className="mb-2 text-base font-semibold text-gray-900">{t('forgot_password_no_email_title')}</h2>
    <p className="mb-6 text-sm text-gray-600">{t('forgot_password_no_email_desc')}</p>
    <button
     type="button"
     onClick={() => router.push(`/reset-request?username=${encodeURIComponent(identifier.trim())}`)}
     className="mb-4 inline-block w-full rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800"
    >
     {t('forgot_password_no_email_cta')}
    </button>
    <button
     type="button"
     onClick={() => router.push('/login')}
     className="text-sm text-blue-700 hover:underline"
    >
     {t('set_password_back_to_sign_in')}
    </button>
   </section>,
  );
 }

 return cardShell(
  <section className="rounded border border-gray-300 bg-white shadow-md">
   <div className="border-b border-gray-200 bg-gray-50 px-5 py-3">
    <h2 className="text-sm font-semibold text-gray-700">{t('forgot_password_title')}</h2>
   </div>
   <div className="p-5">
    <p className="mb-4 text-sm text-gray-600">{t('forgot_password_desc')}</p>
    <form className="space-y-4" onSubmit={(event) => void onSubmit(event)}>
     <div>
      <label className="mb-1 block text-xs font-semibold text-gray-600">{t('login_email')}</label>
      <input
       type="text"
       value={identifier}
       onChange={(event) => setIdentifier(event.target.value)}
       placeholder={t('login_email')}
       autoComplete="username"
       className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
       required
      />
      {checkStatus === 'checking' ? (
       <p className="mt-1 text-xs text-gray-400">{t('forgot_password_checking')}</p>
      ) : null}
      {checkStatus === 'found' ? (
       <p className="mt-1 text-xs text-green-600">{t('forgot_password_user_found')}</p>
      ) : null}
      {checkStatus === 'notfound' ? (
       <p className="mt-1 text-xs text-red-600">{t('forgot_password_user_not_found')}</p>
      ) : null}
     </div>

     {error ? <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

     <button
      type="submit"
      disabled={isSubmitting || checkStatus === 'notfound' || !identifier.trim()}
      className="w-full rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
     >
      {isSubmitting ? t('forgot_password_submitting') : t('forgot_password_submit')}
     </button>
    </form>

    <div className="mt-4 border-t border-gray-200 pt-4 text-center">
     <button
      type="button"
      onClick={() => router.push('/login')}
      className="text-sm text-blue-700 transition hover:text-blue-900 hover:underline"
     >
      {t('set_password_back_to_sign_in')}
     </button>
    </div>
   </div>
  </section>,
 );
}
