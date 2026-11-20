'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';

// One recovery form for every account type. The server answers the same way whether the
// identifier exists or not (no account enumeration) and picks the route itself: an email
// account gets a reset link, a username account becomes a support request.
export default function ForgotPasswordPage() {
 const router = useRouter();
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const [identifier, setIdentifier] = useState('');
 const [note, setNote] = useState('');
 const [error, setError] = useState('');
 const [submittedFor, setSubmittedFor] = useState<string | null>(null);
 const [isSubmitting, setIsSubmitting] = useState(false);

 const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.trim());

 const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  setError('');
  setIsSubmitting(true);
  try {
   const response = await fetch('/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: identifier.trim(), note: note.trim() || undefined }),
   });
   const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
   if (!response.ok || !payload.ok) {
    throw new Error(payload.error || t('forgot_password_failed'));
   }
   setSubmittedFor(identifier.trim());
  } catch (submitError) {
   setError(submitError instanceof Error ? submitError.message : t('forgot_password_failed'));
  } finally {
   setIsSubmitting(false);
  }
 };

 const inputClass =
  'w-full rounded border border-border-strong bg-surface px-3 py-2 text-sm text-fg outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500';

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
      <h2 className="text-sm font-semibold text-fg-muted">{t('forgot_password_title')}</h2>
     </div>
     <div className="p-5">
      {submittedFor ? (
       <div className="space-y-3 text-sm text-fg-muted">
        <p className="font-semibold text-fg">{t('forgot_password_sent_title')}</p>
        <p>{t('forgot_password_uniform_sent').replace('{identifier}', submittedFor)}</p>
        <ul className="list-disc space-y-1 ps-5 text-xs text-fg-faint">
         <li>{t('forgot_password_uniform_email_hint')}</li>
         <li>{t('forgot_password_uniform_username_hint')}</li>
        </ul>
       </div>
      ) : (
       <form className="space-y-4" onSubmit={(event) => void onSubmit(event)}>
        <p className="text-sm text-fg-muted">{t('forgot_password_desc')}</p>
        <div>
         <label className="mb-1 block text-xs font-semibold text-fg-muted" htmlFor="forgot-identifier">
          {t('login_email')}
         </label>
         <input
          id="forgot-identifier"
          type="text"
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          placeholder={t('login_email')}
          className={inputClass}
          required
          autoFocus
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
         />
        </div>
        {identifier.trim() && !looksLikeEmail ? (
         <div>
          <label className="mb-1 block text-xs font-semibold text-fg-muted" htmlFor="forgot-note">
           {t('reset_request_note_label')}
          </label>
          <textarea
           id="forgot-note"
           value={note}
           onChange={(event) => setNote(event.target.value)}
           placeholder={t('reset_request_note_placeholder')}
           className={inputClass}
           rows={2}
           maxLength={500}
          />
          <p className="mt-1 text-xs text-fg-faint">{t('forgot_password_username_route_hint')}</p>
         </div>
        ) : null}

        {error ? (
         <p role="alert" className="rounded border border-red-300 bg-bad-bg px-3 py-2 text-sm text-bad-text">
          {error}
         </p>
        ) : null}

        <button
         type="submit"
         disabled={isSubmitting}
         className="w-full rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
         {isSubmitting ? t('forgot_password_submitting') : t('forgot_password_continue')}
        </button>
       </form>
      )}

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
