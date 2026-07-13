'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';

// Password reset for accounts that have no email on file (username-only sign-ups) and so can't
// use the email-based /forgot-password flow. The user files a request; support verifies their
// identity out-of-band (via the trusted contact on file) and sends them a reset link.
export default function ResetRequestPage() {
 const router = useRouter();
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const [username, setUsername] = useState('');
 const [note, setNote] = useState('');
 const [error, setError] = useState('');
 const [sent, setSent] = useState(false);
 const [isSubmitting, setIsSubmitting] = useState(false);

 const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  setError('');
  setIsSubmitting(true);

  try {
   const response = await fetch('/api/auth/reset-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, note }),
   });

   const payload = (await response.json()) as { ok?: boolean; error?: string };

   if (!response.ok) {
    throw new Error(payload.error || t('reset_request_failed'));
   }

   setSent(true);
  } catch (requestError) {
   setError(requestError instanceof Error ? requestError.message : t('reset_request_failed'));
  } finally {
   setIsSubmitting(false);
  }
 };

 if (sent) {
  return (
   <main className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
    <div className="w-full max-w-sm">
     <div className="mb-6 text-center">
      <div className="inline-flex items-center justify-center rounded bg-blue-800 px-4 py-2 mb-3">
       <span className="text-lg font-bold tracking-widest text-white">ARKAM</span>
      </div>
     </div>
     <section className="rounded border border-gray-300 bg-white p-8 shadow-md text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-4xl">🛟</div>
      <h2 className="mb-2 text-base font-semibold text-gray-900">{t('reset_request_sent_title')}</h2>
      <p className="mb-4 text-sm text-gray-600">{t('reset_request_sent_desc')}</p>
      <p className="text-xs text-gray-400 mb-6">{t('reset_request_sent_note')}</p>
      <button
       type="button"
       onClick={() => router.push('/login')}
       className="text-sm text-blue-700 hover:underline"
      >
       {t('set_password_back_to_sign_in')}
      </button>
     </section>
    </div>
   </main>
  );
 }

 return (
  <main className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
   <div className="w-full max-w-sm">
    <div className="mb-6 text-center">
     <div className="inline-flex items-center justify-center rounded bg-blue-800 px-4 py-2 mb-3">
      <span className="text-lg font-bold tracking-widest text-white">ARKAM</span>
     </div>
    </div>
    <section className="rounded border border-gray-300 bg-white shadow-md">
     <div className="border-b border-gray-200 bg-gray-50 px-5 py-3">
      <h2 className="text-sm font-semibold text-gray-700">{t('reset_request_title')}</h2>
     </div>
     <div className="p-5">
      <p className="mb-4 text-sm text-gray-600">{t('reset_request_desc')}</p>
      <form className="space-y-4" onSubmit={(event) => void onSubmit(event)}>
       <div>
        <label className="mb-1 block text-xs font-semibold text-gray-600">{t('reset_request_username_label')}</label>
        <input
         type="text"
         value={username}
         onChange={(event) => setUsername(event.target.value)}
         placeholder={t('reset_request_username_placeholder')}
         autoComplete="username"
         className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
         required
        />
       </div>
       <div>
        <label className="mb-1 block text-xs font-semibold text-gray-600">{t('reset_request_note_label')}</label>
        <textarea
         value={note}
         onChange={(event) => setNote(event.target.value)}
         placeholder={t('reset_request_note_placeholder')}
         rows={3}
         className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
       </div>

       {error ? <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

       <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
       >
        {isSubmitting ? t('reset_request_submitting') : t('reset_request_submit')}
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
    </section>
   </div>
  </main>
 );
}
