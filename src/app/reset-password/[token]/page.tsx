'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import PasswordVisibilityToggle from '@/components/auth/PasswordVisibilityToggle';

export default function ResetPasswordPage() {
 const router = useRouter();
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const params = useParams<{ token: string }>();
 const token = params?.token || '';

 const [password, setPassword] = useState('');
 const [confirmPassword, setConfirmPassword] = useState('');
 const [showPassword, setShowPassword] = useState(false);
 const [showConfirmPassword, setShowConfirmPassword] = useState(false);
 const [error, setError] = useState('');
 const [success, setSuccess] = useState('');
 const [isTokenValid, setIsTokenValid] = useState(true);
 const [isValidating, setIsValidating] = useState(true);
 const [isSubmitting, setIsSubmitting] = useState(false);

 useEffect(() => {
  let isMounted = true;

  const validateToken = async () => {
   if (!token) {
    if (isMounted) {
     setIsTokenValid(false);
     setIsValidating(false);
    }
    return;
   }

   try {
    const response = await fetch(`/api/auth/reset-password?token=${encodeURIComponent(token)}`);
    const payload = (await response.json()) as { valid?: boolean };

    if (!isMounted) {
     return;
    }

    setIsTokenValid(Boolean(payload.valid));
   } catch {
    if (isMounted) {
     setIsTokenValid(false);
    }
   } finally {
    if (isMounted) {
     setIsValidating(false);
    }
   }
  };

  void validateToken();

  return () => {
   isMounted = false;
  };
 }, [token]);

 const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  setError('');
  setSuccess('');

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
   const response = await fetch('/api/auth/reset-password', {
    method: 'POST',
    headers: {
     'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token, password }),
   });

   const payload = (await response.json()) as { ok?: boolean; error?: string };

   if (!response.ok || !payload.ok) {
    throw new Error(payload.error || t('reset_password_failed'));
   }

   setSuccess(t('reset_password_success'));
   router.replace('/login');
   return;
  } catch (resetError) {
   setError(resetError instanceof Error ? resetError.message : t('reset_password_failed'));
  } finally {
   setIsSubmitting(false);
  }
 };

 return (
  <main className="flex min-h-screen items-center justify-center bg-surface-hover p-4">
   <div className="w-full max-w-sm">
    <div className="mb-6 text-center">
     <div className="inline-flex items-center justify-center rounded bg-blue-800 px-4 py-2 mb-3">
      <span className="text-lg font-bold tracking-widest text-white">ARKAM</span>
     </div>
    </div>
    <section className="rounded border border-border-strong bg-surface shadow-md">
     <div className="border-b border-border bg-surface-2 px-5 py-3">
      <h2 className="text-sm font-semibold text-fg-muted">{t('reset_password_title')}</h2>
     </div>
     <div className="p-5">
      {isValidating ? <p className="text-sm text-fg-faint">{t('reset_password_validating')}</p> : null}

      {!isValidating && !isTokenValid ? (
       <div className="rounded border border-red-300 bg-bad-bg px-3 py-2 text-sm text-bad-text">{t('reset_password_invalid')}</div>
      ) : null}

      {!isValidating && isTokenValid ? (
       <form
        className="space-y-4"
        onSubmit={(event) => void onSubmit(event)}
       >
        <div>
         <label className="mb-1 block text-xs font-semibold text-fg-muted">{t('set_password_new_label')}</label>
         <div className="relative">
          <input
           type={showPassword ? 'text' : 'password'}
           value={password}
           onChange={(event) => setPassword(event.target.value)}
           placeholder={t('set_password_new_label')}
           className="w-full rounded border border-border-strong px-3 py-2 pr-10 text-sm text-fg outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
           minLength={8}
           required
          />
          <PasswordVisibilityToggle
           shown={showPassword}
           onToggle={() => setShowPassword((current) => !current)}
           showLabel={t('password_show')}
           hideLabel={t('password_hide')}
          />
         </div>
        </div>
        <div>
         <label className="mb-1 block text-xs font-semibold text-fg-muted">{t('set_password_confirm_label')}</label>
         <div className="relative">
          <input
           type={showConfirmPassword ? 'text' : 'password'}
           value={confirmPassword}
           onChange={(event) => setConfirmPassword(event.target.value)}
           placeholder={t('set_password_confirm_label')}
           className="w-full rounded border border-border-strong px-3 py-2 pr-10 text-sm text-fg outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
           minLength={8}
           required
          />
          <PasswordVisibilityToggle
           shown={showConfirmPassword}
           onToggle={() => setShowConfirmPassword((current) => !current)}
           showLabel={t('password_show')}
           hideLabel={t('password_hide')}
          />
         </div>
        </div>

        {error ? <p className="rounded border border-red-300 bg-bad-bg px-3 py-2 text-sm text-bad-text">{error}</p> : null}
        {success ? <p className="rounded border border-green-300 bg-good-bg px-3 py-2 text-sm text-good-text">{success}</p> : null}

        <button
         type="submit"
         disabled={isSubmitting}
         className="w-full rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
         {isSubmitting ? t('reset_password_submitting') : t('reset_password_submit')}
        </button>
       </form>
      ) : null}

      <div className="mt-4 border-t border-border pt-4 text-center">
       <button
        type="button"
        onClick={() => router.push('/login')}
        className="text-sm text-accent transition hover:text-accent hover:underline"
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
