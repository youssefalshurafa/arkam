'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';

type AccountInfo = {
 email: string;
 name: string;
 status: 'pending' | 'approved' | 'rejected';
 subscriptionStartedAt: string | null;
 subscriptionEndsAt: string | null;
 pendingRenewal: { id: string; plan: string; amount: string; createdAt: string } | null;
};

type PlanTierInfo = {
 id: string;
 name: string;
 priceUsdt: number;
 originalUsdt: number | null;
 period: string;
 amount: string;
};

type PaymentInfo = {
 address: string;
 network: string;
 configured: boolean;
 qrDataUrl: string;
 tiers: PlanTierInfo[];
};

const MAX_PROOF_BYTES = 5 * 1024 * 1024;
const ALLOWED_PROOF_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

const panelClass = 'rounded-lg border border-gray-200 bg-white p-5 shadow-sm';

export default function AccountSettings({ hideSubscription = false }: { hideSubscription?: boolean }) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);

 const [info, setInfo] = useState<AccountInfo | null>(null);

 // Change email state
 const [emailOpen, setEmailOpen] = useState(false);
 const [newEmail, setNewEmail] = useState('');
 const [confirmEmail, setConfirmEmail] = useState('');
 const [emailPassword, setEmailPassword] = useState('');
 const [emailError, setEmailError] = useState('');
 const [emailSuccess, setEmailSuccess] = useState('');
 const [emailSubmitting, setEmailSubmitting] = useState(false);

 // Change password state
 const [currentPassword, setCurrentPassword] = useState('');
 const [newPassword, setNewPassword] = useState('');
 const [confirmPassword, setConfirmPassword] = useState('');
 const [pwdError, setPwdError] = useState('');
 const [pwdSuccess, setPwdSuccess] = useState('');
 const [pwdSubmitting, setPwdSubmitting] = useState(false);
 const [passwordOpen, setPasswordOpen] = useState(false);

 // "Forgot current password" support-approval request state
 const [resetRequesting, setResetRequesting] = useState(false);
 const [resetRequested, setResetRequested] = useState(false);
 const [resetError, setResetError] = useState('');

 // Renew state
 const [showRenew, setShowRenew] = useState(false);
 const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(null);
 const [selectedPlanId, setSelectedPlanId] = useState('');
 const [proofFile, setProofFile] = useState<File | null>(null);
 const [proofPreview, setProofPreview] = useState('');
 const [txReference, setTxReference] = useState('');
 const [addressCopied, setAddressCopied] = useState(false);
 const [renewError, setRenewError] = useState('');
 const [renewSubmitting, setRenewSubmitting] = useState(false);
 const [renewSubmitted, setRenewSubmitted] = useState(false);
 const fileInputRef = useRef<HTMLInputElement | null>(null);

 const fetchInfo = async () => {
  try {
   const res = await fetch('/api/account/subscription');
   if (res.ok) setInfo((await res.json()) as AccountInfo);
  } catch {
   // non-fatal
  }
 };

 useEffect(() => {
  void fetchInfo();
 }, []);

 // Load payment tiers/QR when the renew form is opened.
 useEffect(() => {
  if (!showRenew || paymentInfo) return;
  const load = async () => {
   try {
    const res = await fetch('/api/payment-info');
    if (res.ok) {
     const data = (await res.json()) as PaymentInfo;
     setPaymentInfo(data);
     setSelectedPlanId((current) => current || data.tiers?.[0]?.id || '');
    }
   } catch {
    // non-fatal
   }
  };
  void load();
 }, [showRenew, paymentInfo]);

 const subscriptionState = (() => {
  if (!info?.subscriptionEndsAt) return { tone: 'none' as const, daysLeft: null as number | null };
  const daysLeft = Math.ceil((new Date(info.subscriptionEndsAt).getTime() - Date.now()) / 86_400_000);
  if (daysLeft <= 0) return { tone: 'expired' as const, daysLeft };
  if (daysLeft <= 7) return { tone: 'soon' as const, daysLeft };
  return { tone: 'active' as const, daysLeft };
 })();

 const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(language, { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

 const onChangeEmail = async (event: FormEvent) => {
  event.preventDefault();
  setEmailError('');
  setEmailSuccess('');

  if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim())) {
   setEmailError(t('account_email_invalid'));
   return;
  }
  if (newEmail.trim().toLowerCase() !== confirmEmail.trim().toLowerCase()) {
   setEmailError(t('account_email_mismatch'));
   return;
  }

  setEmailSubmitting(true);
  try {
   const res = await fetch('/api/auth/change-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: emailPassword, newEmail: newEmail.trim() }),
   });
   const data = (await res.json()) as { ok?: boolean; error?: string };
   if (!res.ok || !data.ok) {
    throw new Error(data.error || t('account_email_failed'));
   }
   setEmailSuccess(t('account_email_changed'));
   setNewEmail('');
   setConfirmEmail('');
   setEmailPassword('');
   void fetchInfo();
  } catch (err) {
   setEmailError(err instanceof Error ? err.message : t('account_email_failed'));
  } finally {
   setEmailSubmitting(false);
  }
 };

 const onChangePassword = async (event: FormEvent) => {
  event.preventDefault();
  setPwdError('');
  setPwdSuccess('');

  if (newPassword.length < 8) {
   setPwdError(t('account_password_too_short'));
   return;
  }
  if (newPassword !== confirmPassword) {
   setPwdError(t('account_password_mismatch'));
   return;
  }

  setPwdSubmitting(true);
  try {
   const res = await fetch('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
   });
   const data = (await res.json()) as { ok?: boolean; error?: string };
   if (!res.ok || !data.ok) {
    throw new Error(data.error || t('account_password_failed'));
   }
   setPwdSuccess(t('account_password_changed'));
   setCurrentPassword('');
   setNewPassword('');
   setConfirmPassword('');
  } catch (err) {
   setPwdError(err instanceof Error ? err.message : t('account_password_failed'));
  } finally {
   setPwdSubmitting(false);
  }
 };

 // Files a support-approval reset request for the logged-in user who has forgotten their current
 // password (username-only accounts can't use the email reset link). Support verifies identity via
 // the trusted contact and hands over a one-time reset link.
 const onRequestReset = async () => {
  setResetError('');
  setResetRequesting(true);
  try {
   const res = await fetch('/api/auth/reset-request/authenticated', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
   });
   const data = (await res.json()) as { ok?: boolean; error?: string };
   if (!res.ok || !data.ok) {
    throw new Error(data.error || t('account_password_forgot_failed'));
   }
   setResetRequested(true);
  } catch (err) {
   setResetError(err instanceof Error ? err.message : t('account_password_forgot_failed'));
  } finally {
   setResetRequesting(false);
  }
 };

 const onFileChange = (file: File | null) => {
  setRenewError('');
  if (proofPreview) URL.revokeObjectURL(proofPreview);
  if (!file) {
   setProofFile(null);
   setProofPreview('');
   return;
  }
  if (!ALLOWED_PROOF_TYPES.includes(file.type)) {
   setRenewError(t('signup_proof_invalid_type'));
   return;
  }
  if (file.size > MAX_PROOF_BYTES) {
   setRenewError(t('signup_proof_too_large'));
   return;
  }
  setProofFile(file);
  setProofPreview(URL.createObjectURL(file));
 };

 const copyAddress = async () => {
  if (!paymentInfo?.address) return;
  try {
   await navigator.clipboard.writeText(paymentInfo.address);
   setAddressCopied(true);
   setTimeout(() => setAddressCopied(false), 2000);
  } catch {
   // ignore
  }
 };

 const onSubmitRenew = async (event: FormEvent) => {
  event.preventDefault();
  setRenewError('');
  if (!proofFile) {
   setRenewError(t('signup_proof_required'));
   return;
  }

  setRenewSubmitting(true);
  try {
   const formData = new FormData();
   formData.append('plan', selectedPlanId);
   formData.append('txReference', txReference);
   formData.append('screenshot', proofFile);
   const res = await fetch('/api/account/renew', { method: 'POST', body: formData });
   const data = (await res.json()) as { ok?: boolean; error?: string };
   if (!res.ok || !data.ok) {
    throw new Error(data.error || t('account_renew_failed'));
   }
   setRenewSubmitted(true);
   setShowRenew(false);
   setProofFile(null);
   setProofPreview('');
   setTxReference('');
   void fetchInfo();
  } catch (err) {
   setRenewError(err instanceof Error ? err.message : t('account_renew_failed'));
  } finally {
   setRenewSubmitting(false);
  }
 };

 const toneBadge =
  subscriptionState.tone === 'expired'
   ? 'bg-red-50 text-red-700'
   : subscriptionState.tone === 'soon'
    ? 'bg-amber-50 text-amber-800'
    : subscriptionState.tone === 'active'
     ? 'bg-green-50 text-green-700'
     : 'bg-gray-100 text-gray-500';

 const toneLabel =
  subscriptionState.tone === 'expired'
   ? t('account_status_expired')
   : subscriptionState.tone === 'none'
    ? t('account_status_none')
    : t('account_days_left', { days: subscriptionState.daysLeft ?? 0 });

 // Tier names come from the server (config/plan.ts) as plain English; translate by id,
 // falling back to the server's name if a tier has no matching translation key yet.
 const tierLabel = (tier: { id: string; name: string }) => {
  const key = `plan_tier_${tier.id}`;
  const label = t(key);
  return label === key ? tier.name : label;
 };

 return (
  <section className="flex flex-col gap-6">
   {/* Subscription */}
   {!hideSubscription && (
   <div className={panelClass}>
    <h2 className="text-2xl font-semibold">{t('account_subscription_title')}</h2>
    <p className="mt-2 text-sm text-slate-600">{t('account_subscription_desc')}</p>

    <div className="mt-5 grid gap-4 sm:grid-cols-3">
     <div className="rounded border border-gray-200 bg-gray-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('account_status')}</p>
      <span className={`mt-2 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${toneBadge}`}>{toneLabel}</span>
     </div>
     <div className="rounded border border-gray-200 bg-gray-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('account_started')}</p>
      <p className="mt-2 text-sm text-slate-900">{formatDate(info?.subscriptionStartedAt ?? null)}</p>
     </div>
     <div className="rounded border border-gray-200 bg-gray-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('account_ends')}</p>
      <p className="mt-2 text-sm text-slate-900">{formatDate(info?.subscriptionEndsAt ?? null)}</p>
     </div>
    </div>

    {renewSubmitted || info?.pendingRenewal ? (
     <div className="mt-4 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{t('account_renew_pending')}</div>
    ) : null}

    {!showRenew ? (
     <button
      type="button"
      onClick={() => setShowRenew(true)}
      className="mt-5 rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800"
     >
      {t('account_renew_button')}
     </button>
    ) : (
     <form onSubmit={(e) => void onSubmitRenew(e)} className="mt-5 rounded-lg border border-blue-200 bg-blue-50/60 p-4">
      <div className="flex items-center justify-between">
       <p className="text-sm font-semibold text-gray-900">{t('signup_payment_title')}</p>
       <button type="button" onClick={() => setShowRenew(false)} className="text-xs font-semibold text-slate-500 hover:text-slate-700">
        {t('cancel')}
       </button>
      </div>

      {/* Tier selector */}
      {paymentInfo?.tiers?.length ? (
       <div className="mt-3 grid grid-cols-1 gap-2">
        {paymentInfo.tiers.map((tier) => {
         const selected = tier.id === selectedPlanId;
         return (
          <button
           key={tier.id}
           type="button"
           onClick={() => setSelectedPlanId(tier.id)}
           className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left transition ${
            selected ? 'border-blue-600 bg-white ring-1 ring-blue-600' : 'border-gray-300 bg-white hover:border-gray-400'
           }`}
          >
           <span className="text-sm font-semibold text-gray-900">{tierLabel(tier)}</span>
           <span className="flex items-baseline gap-1.5">
            {tier.originalUsdt && <span className="text-xs text-gray-400 line-through">{tier.originalUsdt}</span>}
            <span className="text-sm font-bold text-gray-900">{tier.amount}</span>
           </span>
          </button>
         );
        })}
       </div>
      ) : null}

      {paymentInfo?.configured ? (
       <>
        {paymentInfo.qrDataUrl ? (
         // eslint-disable-next-line @next/next/no-img-element
         <img src={paymentInfo.qrDataUrl} alt="USDT wallet QR" className="mx-auto my-3 h-40 w-40 rounded border border-gray-200 bg-white p-1" />
        ) : null}
        <label className="mb-1 block text-xs font-semibold text-gray-600">
         {t('signup_payment_address_label')} ({paymentInfo.network})
        </label>
        <div className="flex items-stretch gap-2">
         <code className="min-w-0 flex-1 truncate rounded border border-gray-300 bg-white px-2 py-2 text-xs text-gray-800">{paymentInfo.address}</code>
         <button
          type="button"
          onClick={() => void copyAddress()}
          className="shrink-0 rounded border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
         >
          {addressCopied ? t('signup_payment_copied') : t('signup_payment_copy')}
         </button>
        </div>
        <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
         {t('signup_payment_network_warning', { network: paymentInfo.network })}
        </p>
       </>
      ) : (
       <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">{t('signup_payment_not_configured')}</p>
      )}

      {/* Screenshot */}
      <div className="mt-3">
       <label className="mb-1 block text-xs font-semibold text-gray-600">{t('signup_proof_label')}</label>
       <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => onFileChange(e.target.files?.[0] ?? null)} className="hidden" />
       {proofPreview ? (
        <div className="flex items-center gap-3">
         {/* eslint-disable-next-line @next/next/no-img-element */}
         <img src={proofPreview} alt="payment proof preview" className="h-16 w-16 rounded border border-gray-200 object-cover" />
         <button type="button" onClick={() => fileInputRef.current?.click()} className="rounded border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-50">
          {t('signup_proof_change')}
         </button>
        </div>
       ) : (
        <button type="button" onClick={() => fileInputRef.current?.click()} className="w-full rounded border border-dashed border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-600 transition hover:bg-gray-50">
         {t('signup_proof_upload')}
        </button>
       )}
       <p className="mt-1 text-xs text-gray-400">{t('signup_proof_hint')}</p>
      </div>

      {/* Tx hash */}
      <div className="mt-3">
       <label className="mb-1 block text-xs font-semibold text-gray-600">{t('signup_tx_label')}</label>
       <input
        type="text"
        value={txReference}
        onChange={(e) => setTxReference(e.target.value)}
        placeholder={t('signup_tx_placeholder')}
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
       />
      </div>

      {renewError && <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{renewError}</p>}

      <button
       type="submit"
       disabled={renewSubmitting}
       className="mt-4 w-full rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
       {renewSubmitting ? t('signup_submitting') : t('signup_submit')}
      </button>
     </form>
    )}
   </div>
   )}

   {/* Change email */}
   <div className={panelClass}>
    <h2 className="text-2xl font-semibold">{t('account_email_title')}</h2>
    <p className="mt-2 text-sm text-slate-600">{t('account_email_desc')}</p>
    {info?.email ? (
     <p className="mt-2 text-sm text-slate-900">
      <span className="font-mono">{info.email}</span>
     </p>
    ) : null}

    {!emailOpen ? (
     <button
      type="button"
      onClick={() => setEmailOpen(true)}
      className="mt-5 rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800"
     >
      {t('account_email_change')}
     </button>
    ) : (
     <form onSubmit={(e) => void onChangeEmail(e)} className="mt-5 max-w-sm space-y-4">
      <div>
       <label className="mb-1 block text-xs font-semibold text-gray-600">{t('account_email_new')}</label>
       <input
        type="email"
        value={newEmail}
        onChange={(e) => setNewEmail(e.target.value)}
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        autoComplete="email"
        required
       />
      </div>
      <div>
       <label className="mb-1 block text-xs font-semibold text-gray-600">{t('account_email_confirm')}</label>
       <input
        type="email"
        value={confirmEmail}
        onChange={(e) => setConfirmEmail(e.target.value)}
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        autoComplete="email"
        required
       />
      </div>
      <div>
       <label className="mb-1 block text-xs font-semibold text-gray-600">{t('account_current_password')}</label>
       <input
        type="password"
        value={emailPassword}
        onChange={(e) => setEmailPassword(e.target.value)}
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        autoComplete="current-password"
       />
      </div>

      {emailError && <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{emailError}</p>}
      {emailSuccess && <p className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700">{emailSuccess}</p>}

      <div className="flex items-center gap-3">
       <button
        type="submit"
        disabled={emailSubmitting}
        className="rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
       >
        {emailSubmitting ? t('account_email_saving') : t('account_email_save')}
       </button>
       <button
        type="button"
        onClick={() => {
         setEmailOpen(false);
         setEmailError('');
         setEmailSuccess('');
         setNewEmail('');
         setConfirmEmail('');
         setEmailPassword('');
        }}
        className="text-sm font-semibold text-slate-500 transition hover:text-slate-700"
       >
        {t('cancel')}
       </button>
      </div>
     </form>
    )}
   </div>

   {/* Change password */}
   <div className={panelClass}>
    <h2 className="text-2xl font-semibold">{t('account_password_title')}</h2>
    <p className="mt-2 text-sm text-slate-600">{t('account_password_desc')}</p>

    {!passwordOpen ? (
     <button
      type="button"
      onClick={() => setPasswordOpen(true)}
      className="mt-5 rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800"
     >
      {t('account_password_change')}
     </button>
    ) : (
    <form onSubmit={(e) => void onChangePassword(e)} className="mt-5 max-w-sm space-y-4">
     <div>
      <label className="mb-1 block text-xs font-semibold text-gray-600">{t('account_current_password')}</label>
      <input
       type="password"
       value={currentPassword}
       onChange={(e) => setCurrentPassword(e.target.value)}
       className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
       autoComplete="current-password"
      />
     </div>
     <div>
      <label className="mb-1 block text-xs font-semibold text-gray-600">{t('account_new_password')}</label>
      <input
       type="password"
       value={newPassword}
       onChange={(e) => setNewPassword(e.target.value)}
       className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
       minLength={8}
       autoComplete="new-password"
       required
      />
     </div>
     <div>
      <label className="mb-1 block text-xs font-semibold text-gray-600">{t('account_confirm_password')}</label>
      <input
       type="password"
       value={confirmPassword}
       onChange={(e) => setConfirmPassword(e.target.value)}
       className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
       minLength={8}
       autoComplete="new-password"
       required
      />
     </div>

     {pwdError && <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{pwdError}</p>}
     {pwdSuccess && <p className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700">{pwdSuccess}</p>}

     <div className="flex items-center gap-3">
      <button
       type="submit"
       disabled={pwdSubmitting}
       className="rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
       {pwdSubmitting ? t('account_password_saving') : t('account_password_save')}
      </button>
      <button
       type="button"
       onClick={() => {
        setPasswordOpen(false);
        setPwdError('');
        setPwdSuccess('');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
       }}
       className="text-sm font-semibold text-slate-500 transition hover:text-slate-700"
      >
       {t('cancel')}
      </button>
     </div>
    </form>
    )}

    {/* Forgot current password — support-approval reset for logged-in users (esp. username-only). */}
    <div className="mt-5 border-t border-gray-100 pt-4">
     {resetRequested ? (
      <p className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700">
       {t('account_password_forgot_done')}
      </p>
     ) : (
      <>
       <button
        type="button"
        onClick={() => void onRequestReset()}
        disabled={resetRequesting}
        className="text-sm font-semibold text-blue-700 transition hover:text-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
       >
        {resetRequesting ? t('account_password_forgot_submit') : t('account_password_forgot')}
       </button>
       {resetError && (
        <p className="mt-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{resetError}</p>
       )}
      </>
     )}
    </div>
   </div>
  </section>
 );
}
