'use client';

import { FormEvent, Suspense, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import SiteLayout from '@/components/marketing/SiteLayout';

type VerifyResponse = {
 ok: true;
 email: string;
 name: string;
};

type PaymentInfo = {
 address: string;
 network: string;
 amount: string;
 planName: string;
 configured: boolean;
 qrDataUrl: string;
};

const MAX_PROOF_BYTES = 5 * 1024 * 1024;
const ALLOWED_PROOF_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

function CompleteForm() {
 const router = useRouter();
 const searchParams = useSearchParams();
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const { status } = useSession();
 const token = searchParams.get('token') ?? '';

 const [tokenState, setTokenState] = useState<'loading' | 'valid' | 'invalid'>('loading');
 const [verifiedEmail, setVerifiedEmail] = useState('');
 const [verifiedName, setVerifiedName] = useState('');
 const [password, setPassword] = useState('');
 const [showPassword, setShowPassword] = useState(false);
 const [txReference, setTxReference] = useState('');
 const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(null);
 const [proofFile, setProofFile] = useState<File | null>(null);
 const [proofPreview, setProofPreview] = useState('');
 const [addressCopied, setAddressCopied] = useState(false);
 const [error, setError] = useState('');
 const [isSubmitting, setIsSubmitting] = useState(false);
 const [submitted, setSubmitted] = useState(false);
 const fileInputRef = useRef<HTMLInputElement | null>(null);

 useEffect(() => {
  if (status === 'authenticated') {
   router.replace('/');
  }
 }, [status, router]);

 useEffect(() => {
  if (!token) {
   setTokenState('invalid');
   return;
  }

  let isMounted = true;
  const check = async () => {
   try {
    const res = await fetch(`/api/auth/signup/verify?token=${encodeURIComponent(token)}`);
    if (!isMounted) return;
    if (res.ok) {
     const data = (await res.json()) as VerifyResponse;
     setVerifiedEmail(data.email);
     setVerifiedName(data.name);
     setTokenState('valid');
    } else {
     setTokenState('invalid');
    }
   } catch {
    if (isMounted) setTokenState('invalid');
   }
  };

  void check();
  return () => {
   isMounted = false;
  };
 }, [token]);

 // Load payment instructions + QR once the token is valid.
 useEffect(() => {
  if (tokenState !== 'valid') return;
  let isMounted = true;
  const load = async () => {
   try {
    const res = await fetch('/api/payment-info');
    if (!isMounted) return;
    if (res.ok) setPaymentInfo((await res.json()) as PaymentInfo);
   } catch {
    // Non-fatal: the form still works, payment block just won't render details.
   }
  };
  void load();
  return () => {
   isMounted = false;
  };
 }, [tokenState]);

 const onFileChange = (file: File | null) => {
  setError('');
  if (proofPreview) URL.revokeObjectURL(proofPreview);
  if (!file) {
   setProofFile(null);
   setProofPreview('');
   return;
  }
  if (!ALLOWED_PROOF_TYPES.includes(file.type)) {
   setError(t('signup_proof_invalid_type'));
   setProofFile(null);
   setProofPreview('');
   return;
  }
  if (file.size > MAX_PROOF_BYTES) {
   setError(t('signup_proof_too_large'));
   setProofFile(null);
   setProofPreview('');
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
   // ignore clipboard failures
  }
 };

 const onSubmit = async (event: FormEvent) => {
  event.preventDefault();
  setError('');

  if (password.length < 8) {
   setError(t('signup_password_too_short'));
   return;
  }
  if (!proofFile) {
   setError(t('signup_proof_required'));
   return;
  }

  setIsSubmitting(true);
  try {
   const formData = new FormData();
   formData.append('token', token);
   formData.append('password', password);
   formData.append('txReference', txReference);
   formData.append('screenshot', proofFile);

   const res = await fetch('/api/auth/signup/complete', { method: 'POST', body: formData });
   const payload = (await res.json()) as { ok?: boolean; error?: string };
   if (!res.ok || !payload.ok) {
    throw new Error(payload.error || t('signup_submit_failed'));
   }

   setSubmitted(true);
  } catch (err) {
   setError(err instanceof Error ? err.message : t('signup_submit_failed'));
  } finally {
   setIsSubmitting(false);
  }
 };

 // Pending-approval confirmation screen.
 if (submitted) {
  return (
   <SiteLayout>
    <div className="flex flex-1 items-center justify-center p-4">
    <div className="w-full max-w-md">
     <section className="rounded border border-gray-300 bg-white p-8 shadow-md text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-4xl">⏳</div>
      <h2 className="mb-2 text-base font-semibold text-gray-900">{t('signup_pending_title')}</h2>
      <p className="mb-1 text-sm text-gray-600">{t('signup_pending_body')}</p>
      <p className="mb-5 text-sm font-semibold text-gray-900 break-all">{verifiedEmail}</p>
      <button
       type="button"
       onClick={() => router.push('/login')}
       className="rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800"
      >
       {t('home_sign_in')}
      </button>
     </section>
    </div>
    </div>
   </SiteLayout>
  );
 }

 return (
  <SiteLayout>
   <div className="flex flex-1 items-center justify-center p-4">
   <div className="w-full max-w-md">
    <div className="mb-6 text-center">
     <p className="text-sm text-gray-500">{t('signup_complete_subtitle')}</p>
    </div>

    <section className="rounded border border-gray-300 bg-white shadow-md">
     <div className="border-b border-gray-200 bg-gray-50 px-5 py-3">
      <h2 className="text-sm font-semibold text-gray-700">{t('signup_complete_heading')}</h2>
     </div>

     <div className="p-5">
      {tokenState === 'loading' && (
       <div className="flex items-center justify-center py-8">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
       </div>
      )}

      {tokenState === 'invalid' && (
       <div className="text-center py-6">
        <p className="text-sm text-red-600 mb-4">{t('signup_link_invalid')}</p>
        <button
         onClick={() => router.push('/signup')}
         className="rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800"
        >
         {t('signup_back_to_signup')}
        </button>
       </div>
      )}

      {tokenState === 'valid' && (
       <>
        <div className="mb-5 flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
         <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <polyline points="20 6 9 17 4 12" />
         </svg>
         <div className="min-w-0">
          <p className="text-xs font-semibold text-green-800 truncate">{verifiedName}</p>
          <p className="text-xs text-green-700 truncate">{verifiedEmail}</p>
         </div>
        </div>

        <form className="space-y-5" onSubmit={(e) => void onSubmit(e)}>
         {/* Password */}
         <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">{t('signup_password_label')}</label>
          <div className="relative">
           <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('signup_password_placeholder')}
            className="w-full rounded border border-gray-300 px-3 py-2 pr-10 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            minLength={8}
            required
           />
           <button
            type="button"
            onClick={() => setShowPassword((c) => !c)}
            className="absolute inset-y-0 right-0 inline-flex w-9 items-center justify-center text-gray-400 transition hover:text-gray-600"
           >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
             {showPassword ? (
              <>
               <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18" />
               <path strokeLinecap="round" strokeLinejoin="round" d="M10.58 10.58a2 2 0 102.83 2.83" />
              </>
             ) : (
              <>
               <path strokeLinecap="round" strokeLinejoin="round" d="M2.56 11.38C3.94 7.57 7.64 4.88 12 4.88s8.06 2.69 9.44 6.5c-1.38 3.81-5.08 6.5-9.44 6.5s-8.06-2.69-9.44-6.5z" />
               <circle cx="12" cy="11.38" r="3" />
              </>
             )}
            </svg>
           </button>
          </div>
         </div>

         {/* Payment block */}
         <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-4">
          <p className="text-sm font-semibold text-gray-900">{t('signup_payment_title')}</p>
          <p className="mt-1 text-xs text-gray-600">
           {t('signup_payment_amount_label')}: <span className="font-semibold text-gray-900">{paymentInfo?.amount ?? ''}</span>
          </p>

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
         </div>

         {/* Screenshot upload */}
         <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">{t('signup_proof_label')}</label>
          <input
           ref={fileInputRef}
           type="file"
           accept="image/png,image/jpeg,image/webp"
           onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
           className="hidden"
          />
          {proofPreview ? (
           <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={proofPreview} alt="payment proof preview" className="h-16 w-16 rounded border border-gray-200 object-cover" />
            <button
             type="button"
             onClick={() => fileInputRef.current?.click()}
             className="rounded border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
            >
             {t('signup_proof_change')}
            </button>
           </div>
          ) : (
           <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full rounded border border-dashed border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-600 transition hover:bg-gray-50"
           >
            {t('signup_proof_upload')}
           </button>
          )}
          <p className="mt-1 text-xs text-gray-400">{t('signup_proof_hint')}</p>
         </div>

         {/* Optional tx hash */}
         <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">{t('signup_tx_label')}</label>
          <input
           type="text"
           value={txReference}
           onChange={(e) => setTxReference(e.target.value)}
           placeholder={t('signup_tx_placeholder')}
           className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
         </div>

         {error && <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

         <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
         >
          {isSubmitting ? t('signup_submitting') : t('signup_submit')}
         </button>
        </form>
       </>
      )}
     </div>
    </section>
   </div>
   </div>
  </SiteLayout>
 );
}

export default function SignupCompletePage() {
 return (
  <Suspense>
   <CompleteForm />
  </Suspense>
 );
}
