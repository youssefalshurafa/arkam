'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import PasswordVisibilityToggle from '@/components/auth/PasswordVisibilityToggle';
import { passwordProblem } from '@/shared/lib/passwordRules';

// Shared by the two single-use password links:
//   purpose 'reset' — /reset-password/[token], emailed by "Forgot password".
//   purpose 'setup' — /setup/[token], handed over by a super admin or workspace owner for a
//                     new account / admin reset. Replaces the old tokenless /set-password.
// On success the user is signed straight in with the password they just chose.
type Purpose = 'reset' | 'setup';

export default function PasswordTokenForm({ token, purpose }: { token: string; purpose: Purpose }) {
 const router = useRouter();
 const { language } = useLanguage();
 const { t } = useTranslation(language);

 const [password, setPassword] = useState('');
 const [confirmPassword, setConfirmPassword] = useState('');
 const [showPassword, setShowPassword] = useState(false);
 const [showConfirmPassword, setShowConfirmPassword] = useState(false);
 const [error, setError] = useState('');
 const [success, setSuccess] = useState('');
 const [identifier, setIdentifier] = useState<string | null>(null);
 const [isTokenValid, setIsTokenValid] = useState(true);
 const [isValidating, setIsValidating] = useState(true);
 const [isSubmitting, setIsSubmitting] = useState(false);

 useEffect(() => {
  let isMounted = true;
  const query = `token=${encodeURIComponent(token)}&purpose=${purpose}`;
  fetch(`/api/auth/reset-password?${query}`)
   .then((response) => response.json() as Promise<{ valid?: boolean; identifier?: string }>)
   .then((payload) => {
    if (!isMounted) return;
    setIsTokenValid(Boolean(payload.valid));
    setIdentifier(payload.identifier || null);
   })
   .catch(() => {
    if (isMounted) setIsTokenValid(false);
   })
   .finally(() => {
    if (isMounted) setIsValidating(false);
   });
  return () => {
   isMounted = false;
  };
 }, [token, purpose]);

 const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  setError('');
  setSuccess('');

  const problem = passwordProblem(password);
  if (problem) {
   setError(t(problem));
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password, purpose }),
   });
   const payload = (await response.json()) as { ok?: boolean; error?: string; identifier?: string };
   if (!response.ok || !payload.ok) {
    throw new Error(payload.error || t('reset_password_failed'));
   }

   setSuccess(purpose === 'setup' ? t('setup_password_success') : t('reset_password_success'));

   // Sign straight in. If that can't complete here (e.g. two-factor is on), fall back to the
   // login page with the identifier filled in.
   const result = payload.identifier
    ? await signIn('credentials', { email: payload.identifier, password, remember: 'true', redirect: false })
    : null;
   if (result && !result.error) {
    window.location.assign('/');
    return;
   }
   router.replace(payload.identifier ? `/login?authEmail=${encodeURIComponent(payload.identifier)}` : '/login');
  } catch (resetError) {
   setError(resetError instanceof Error ? resetError.message : t('reset_password_failed'));
  } finally {
   setIsSubmitting(false);
  }
 };

 const inputClass =
  'w-full rounded border border-border-strong bg-surface px-3 py-2 pr-10 text-sm text-fg outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500';

 return (
  <main className="flex min-h-screen items-center justify-center bg-surface-hover p-4">
   <div className="w-full max-w-sm">
    <div className="mb-6 text-center">
     <div className="mb-3 inline-flex items-center justify-center rounded bg-blue-800 px-4 py-2">
      <span className="text-lg font-bold tracking-widest text-white">ARKAM</span>
     </div>
    </div>
    <section className="rounded border border-border-strong bg-surface shadow-md">
     <div className="border-b border-border bg-surface-2 px-5 py-3">
      <h2 className="text-sm font-semibold text-fg-muted">{purpose === 'setup' ? t('setup_password_title') : t('reset_password_title')}</h2>
     </div>
     <div className="p-5">
      {isValidating ? <p className="text-sm text-fg-faint">{t('reset_password_validating')}</p> : null}

      {!isValidating && !isTokenValid ? (
       <div role="alert" className="rounded border border-red-300 bg-bad-bg px-3 py-2 text-sm text-bad-text">
        {purpose === 'setup' ? t('setup_password_invalid') : t('reset_password_invalid')}
       </div>
      ) : null}

      {!isValidating && isTokenValid ? (
       <form className="space-y-4" onSubmit={(event) => void onSubmit(event)}>
        {purpose === 'setup' ? (
         <p className="text-sm text-fg-muted">
          {t('setup_password_desc')}
          {identifier ? (
           <>
            {' '}
            <span className="font-semibold text-fg">{identifier}</span>
           </>
          ) : null}
         </p>
        ) : null}
        {/* Hidden username field so password managers file the new password under the right login. */}
        {identifier ? <input type="text" name="username" autoComplete="username" value={identifier} readOnly hidden /> : null}
        <div>
         <label className="mb-1 block text-xs font-semibold text-fg-muted" htmlFor="token-password">
          {t('set_password_new_label')}
         </label>
         <div className="relative">
          <input
           id="token-password"
           type={showPassword ? 'text' : 'password'}
           value={password}
           onChange={(event) => setPassword(event.target.value)}
           placeholder={t('set_password_new_label')}
           className={inputClass}
           minLength={8}
           required
           autoComplete="new-password"
          />
          <PasswordVisibilityToggle
           shown={showPassword}
           onToggle={() => setShowPassword((current) => !current)}
           showLabel={t('password_show')}
           hideLabel={t('password_hide')}
          />
         </div>
         <p className="mt-1 text-xs text-fg-faint">{t('password_requirements_hint')}</p>
        </div>
        <div>
         <label className="mb-1 block text-xs font-semibold text-fg-muted" htmlFor="token-password-confirm">
          {t('set_password_confirm_label')}
         </label>
         <div className="relative">
          <input
           id="token-password-confirm"
           type={showConfirmPassword ? 'text' : 'password'}
           value={confirmPassword}
           onChange={(event) => setConfirmPassword(event.target.value)}
           placeholder={t('set_password_confirm_label')}
           className={inputClass}
           minLength={8}
           required
           autoComplete="new-password"
          />
          <PasswordVisibilityToggle
           shown={showConfirmPassword}
           onToggle={() => setShowConfirmPassword((current) => !current)}
           showLabel={t('password_show')}
           hideLabel={t('password_hide')}
          />
         </div>
        </div>

        {error ? <p role="alert" className="rounded border border-red-300 bg-bad-bg px-3 py-2 text-sm text-bad-text">{error}</p> : null}
        {success ? <p className="rounded border border-green-300 bg-good-bg px-3 py-2 text-sm text-good-text">{success}</p> : null}

        <button
         type="submit"
         disabled={isSubmitting || Boolean(success)}
         className="w-full rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
         {isSubmitting ? t('reset_password_submitting') : purpose === 'setup' ? t('setup_password_submit') : t('reset_password_submit')}
        </button>
       </form>
      ) : null}

      <div className="mt-4 border-t border-border pt-4 text-center">
       <button type="button" onClick={() => router.push('/login')} className="text-sm text-accent transition hover:text-accent hover:underline">
        {t('set_password_back_to_sign_in')}
       </button>
      </div>
     </div>
    </section>
   </div>
  </main>
 );
}
