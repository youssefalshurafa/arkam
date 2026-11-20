'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';

const RESEND_COOLDOWN_SECONDS = 60;

// The "we emailed you a 6-digit code" step, shared by signup, legacy-account email
// verification and email change. The parent supplies the submit/resend calls; this owns the
// input, the resend cooldown and the error display.
export default function VerificationCodeForm({
 email,
 onSubmit,
 onResend,
 onBack,
 submitLabel,
 compact = false,
}: {
 email: string;
 onSubmit: (code: string) => Promise<void>;
 onResend: () => Promise<void>;
 onBack?: () => void;
 submitLabel?: string;
 compact?: boolean;
}) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const [code, setCode] = useState('');
 const [error, setError] = useState('');
 const [notice, setNotice] = useState('');
 const [isSubmitting, setIsSubmitting] = useState(false);
 const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);

 useEffect(() => {
  if (cooldown <= 0) return;
  const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
  return () => window.clearTimeout(timer);
 }, [cooldown]);

 const submit = async (event: FormEvent) => {
  event.preventDefault();
  setError('');
  setNotice('');
  setIsSubmitting(true);
  try {
   await onSubmit(code.replace(/\s+/g, ''));
  } catch (submitError) {
   setError(submitError instanceof Error ? submitError.message : t('verify_code_failed'));
  } finally {
   setIsSubmitting(false);
  }
 };

 const resend = async () => {
  setError('');
  setNotice('');
  try {
   await onResend();
   setNotice(t('verify_code_resent'));
   setCooldown(RESEND_COOLDOWN_SECONDS);
  } catch (resendError) {
   setError(resendError instanceof Error ? resendError.message : t('verify_code_failed'));
  }
 };

 return (
  <form className="space-y-4" onSubmit={(event) => void submit(event)}>
   {!compact ? <p className="text-sm font-semibold text-fg">{t('verify_code_title')}</p> : null}
   <p className="text-sm text-fg-muted">
    {t('verify_code_sent_to')} <span className="font-semibold text-fg" dir="ltr">{email}</span>
   </p>
   <div>
    <label className="mb-1 block text-xs font-semibold text-fg-muted" htmlFor="verification-code">
     {t('verify_code_label')}
    </label>
    <input
     id="verification-code"
     type="text"
     inputMode="numeric"
     pattern="[0-9 ]*"
     value={code}
     onChange={(event) => setCode(event.target.value.replace(/[^\d ]/g, '').slice(0, 7))}
     placeholder="000000"
     className="w-full rounded border border-border-strong bg-surface px-3 py-2 text-center font-mono text-lg tracking-[0.5em] text-fg outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
     required
     autoFocus
     autoComplete="one-time-code"
     dir="ltr"
    />
    <p className="mt-1 text-xs text-fg-faint">{t('verify_code_hint')}</p>
   </div>

   {error ? (
    <p role="alert" className="rounded border border-red-300 bg-bad-bg px-3 py-2 text-sm text-bad-text">
     {error}
    </p>
   ) : null}
   {notice ? <p className="rounded border border-green-300 bg-good-bg px-3 py-2 text-sm text-good-text">{notice}</p> : null}

   <button
    type="submit"
    disabled={isSubmitting || code.replace(/\s+/g, '').length !== 6}
    className="w-full rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
   >
    {isSubmitting ? t('loading') : submitLabel || t('verify_code_submit')}
   </button>

   <div className="flex items-center justify-between gap-2 text-sm">
    <button
     type="button"
     disabled={cooldown > 0}
     onClick={() => void resend()}
     className="text-accent transition hover:underline disabled:cursor-not-allowed disabled:text-fg-faint disabled:no-underline"
    >
     {cooldown > 0 ? t('verify_code_resend_in', { seconds: cooldown }) : t('verify_code_resend')}
    </button>
    {onBack ? (
     <button type="button" onClick={onBack} className="text-accent transition hover:underline">
      {t('verify_code_change_email')}
     </button>
    ) : null}
   </div>
  </form>
 );
}
