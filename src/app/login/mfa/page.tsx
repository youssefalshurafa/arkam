'use client';

import { FormEvent, useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import SiteLayout from '@/components/marketing/SiteLayout';

// Second step of a Google sign-in for an account with two-factor on. The signIn callback
// (auth-options.ts) refuses to create a session and sends the browser here with a signed,
// 5-minute challenge; trading it plus a valid code through the 'mfa-challenge' provider is
// what finally signs the user in.
export default function GoogleMfaPage() {
 const router = useRouter();
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const [challenge, setChallenge] = useState('');
 const [code, setCode] = useState('');
 const [errorCode, setErrorCode] = useState('');
 const [isSubmitting, setIsSubmitting] = useState(false);

 useEffect(() => {
  setChallenge(new URLSearchParams(window.location.search).get('c') || '');
 }, []);

 const onSubmit = async (event: FormEvent) => {
  event.preventDefault();
  setErrorCode('');
  setIsSubmitting(true);
  try {
   const result = await signIn('mfa-challenge', { challenge, otp: code.replace(/\s+/g, ''), redirect: false });
   if (!result || result.error) {
    setErrorCode(result?.error || 'MFA_INVALID');
    return;
   }
   window.location.assign('/');
  } finally {
   setIsSubmitting(false);
  }
 };

 const expired = errorCode === 'MFA_CHALLENGE_EXPIRED';
 const message =
  errorCode === 'MFA_LOCKED' ? t('login_mfa_locked') : expired ? t('login_mfa_challenge_expired') : errorCode ? t('login_mfa_invalid') : '';

 return (
  <SiteLayout hideSignIn>
   <div className="flex flex-1 items-center justify-center p-4">
    <section className="w-full max-w-sm rounded border border-border-strong bg-surface shadow-md">
     <div className="border-b border-border bg-surface-2 px-5 py-3">
      <h2 className="text-sm font-semibold text-fg-muted">{t('login_mfa_title')}</h2>
     </div>
     <form className="space-y-4 p-5" onSubmit={(event) => void onSubmit(event)}>
      <p className="text-sm text-fg-muted">{t('login_mfa_desc')}</p>
      <div>
       <label className="mb-1 block text-xs font-semibold text-fg-muted" htmlFor="google-mfa-code">
        {t('login_mfa_code')}
       </label>
       <input
        id="google-mfa-code"
        type="text"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        placeholder="123456"
        className="w-full rounded border border-border-strong bg-surface px-3 py-2 text-sm tracking-widest text-fg outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        required
        autoFocus
        autoComplete="one-time-code"
        dir="ltr"
        maxLength={20}
       />
      </div>
      {message ? (
       <p role="alert" className="rounded border border-red-300 bg-bad-bg px-3 py-2 text-sm text-bad-text">
        {message}
       </p>
      ) : null}
      <button
       type="submit"
       disabled={isSubmitting || !challenge || expired}
       className="w-full rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
       {isSubmitting ? t('loading') : t('login_mfa_verify')}
      </button>
      <button type="button" onClick={() => router.replace('/login')} className="block w-full text-center text-sm text-accent transition hover:underline">
       {t('login_mfa_back')}
      </button>
     </form>
    </section>
   </div>
  </SiteLayout>
 );
}
