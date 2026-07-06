'use client';

import { FormEvent, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import SiteLayout from '@/components/marketing/SiteLayout';

export default function SetInitialPasswordPage() {
 const router = useRouter();
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const [email, setEmail] = useState('');
 const [password, setPassword] = useState('');
 const [confirmPassword, setConfirmPassword] = useState('');
 const [error, setError] = useState('');
 const [isSubmitting, setIsSubmitting] = useState(false);

 const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  setError('');

  if (password.length < 8) {
   setError(t('account_password_too_short'));
   return;
  }

  if (password !== confirmPassword) {
   setError(t('account_password_mismatch'));
   return;
  }

  setIsSubmitting(true);

  try {
   const response = await fetch('/api/auth/set-initial-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
   });

   const payload = (await response.json()) as { ok?: boolean; error?: string };

   if (!response.ok || !payload.ok) {
    throw new Error(payload.error || t('set_password_failed'));
   }

   // Log the user straight in with the password they just set, instead of sending
   // them back to the sign-in form to re-type everything.
   const result = await signIn('credentials', { email, password, redirect: false });

   if (!result || result.error) {
    // Password was saved even if this sign-in attempt failed — send them to the
    // normal login form rather than leaving them stuck here.
    router.replace('/login');
    return;
   }

   if (typeof window !== 'undefined') {
    window.localStorage.removeItem('arkam.activeWorkspaceId');
   }

   router.replace('/');
   router.refresh();
  } catch (submitError) {
   setError(submitError instanceof Error ? submitError.message : t('set_password_failed'));
  } finally {
   setIsSubmitting(false);
  }
 };

 return (
  <SiteLayout hideSignIn>
   <div className="flex flex-1 items-center justify-center p-4">
    <div className="w-full max-w-sm">
     <section className="rounded border border-gray-300 bg-white shadow-md">
      <div className="border-b border-gray-200 bg-gray-50 px-5 py-3">
       <h2 className="text-sm font-semibold text-gray-700">{t('set_password_title')}</h2>
      </div>
      <div className="p-5">
       <p className="mb-4 text-sm text-gray-600">{t('set_password_desc')}</p>

       <form className="space-y-4" onSubmit={(event) => void onSubmit(event)}>
        <div>
         <label className="mb-1 block text-xs font-semibold text-gray-600">{t('login_email')}</label>
         <input
          type="text"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={t('login_email')}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          required
         />
        </div>
        <div>
         <label className="mb-1 block text-xs font-semibold text-gray-600">{t('set_password_new_label')}</label>
         <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={t('set_password_new_label')}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          minLength={8}
          required
         />
        </div>
        <div>
         <label className="mb-1 block text-xs font-semibold text-gray-600">{t('set_password_confirm_label')}</label>
         <input
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          placeholder={t('set_password_confirm_label')}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          minLength={8}
          required
         />
        </div>

        {error ? <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

        <button
         type="submit"
         disabled={isSubmitting}
         className="w-full rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
         {isSubmitting ? t('set_password_submitting') : t('set_password_submit')}
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
   </div>
  </SiteLayout>
 );
}
