'use client';

import { FormEvent, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import SiteLayout from '@/components/marketing/SiteLayout';

// Matches the eye/eye-off icon on the login page's password field.
function PasswordVisibilityToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
 return (
  <button
   type="button"
   onClick={onToggle}
   aria-label={shown ? 'Hide password' : 'Show password'}
   className="absolute inset-y-0 right-0 inline-flex w-9 items-center justify-center text-gray-400 transition hover:text-gray-600"
  >
   {shown ? (
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
 );
}

export default function SetInitialPasswordPage() {
 const router = useRouter();
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const [email, setEmail] = useState('');
 const [password, setPassword] = useState('');
 const [confirmPassword, setConfirmPassword] = useState('');
 const [showPassword, setShowPassword] = useState(false);
 const [showConfirmPassword, setShowConfirmPassword] = useState(false);
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
         <div className="relative">
          <input
           type={showPassword ? 'text' : 'password'}
           value={password}
           onChange={(event) => setPassword(event.target.value)}
           placeholder={t('set_password_new_label')}
           className="w-full rounded border border-gray-300 px-3 py-2 pr-10 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
           minLength={8}
           required
          />
          <PasswordVisibilityToggle
           shown={showPassword}
           onToggle={() => setShowPassword((current) => !current)}
          />
         </div>
        </div>
        <div>
         <label className="mb-1 block text-xs font-semibold text-gray-600">{t('set_password_confirm_label')}</label>
         <div className="relative">
          <input
           type={showConfirmPassword ? 'text' : 'password'}
           value={confirmPassword}
           onChange={(event) => setConfirmPassword(event.target.value)}
           placeholder={t('set_password_confirm_label')}
           className="w-full rounded border border-gray-300 px-3 py-2 pr-10 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
           minLength={8}
           required
          />
          <PasswordVisibilityToggle
           shown={showConfirmPassword}
           onToggle={() => setShowConfirmPassword((current) => !current)}
          />
         </div>
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
