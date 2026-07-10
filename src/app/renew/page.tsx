'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import SiteLayout from '@/components/marketing/SiteLayout';

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

export default function RenewPage() {
 const router = useRouter();
 const { language } = useLanguage();
 const { t } = useTranslation(language);

 const [email, setEmail] = useState('');
 const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(null);
 const [selectedPlanId, setSelectedPlanId] = useState('');
 const [proofFile, setProofFile] = useState<File | null>(null);
 const [proofPreview, setProofPreview] = useState('');
 const [txReference, setTxReference] = useState('');
 const [addressCopied, setAddressCopied] = useState(false);
 const [error, setError] = useState('');
 const [isSubmitting, setIsSubmitting] = useState(false);
 const [submitted, setSubmitted] = useState(false);
 const fileInputRef = useRef<HTMLInputElement | null>(null);

 useEffect(() => {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const prefilled = params.get('email');
  if (prefilled) setEmail(prefilled);
 }, []);

 useEffect(() => {
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
 }, []);

 const tierLabel = (tier: { id: string; name: string }) => {
  const key = `plan_tier_${tier.id}`;
  const label = t(key);
  return label === key ? tier.name : label;
 };

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
   return;
  }
  if (file.size > MAX_PROOF_BYTES) {
   setError(t('signup_proof_too_large'));
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

 const onSubmit = async (event: FormEvent) => {
  event.preventDefault();
  setError('');

  if (!email.trim()) {
   setError(t('renew_email_required'));
   return;
  }
  if (!proofFile) {
   setError(t('signup_proof_required'));
   return;
  }

  setIsSubmitting(true);
  try {
   const formData = new FormData();
   formData.append('email', email.trim());
   formData.append('plan', selectedPlanId);
   formData.append('txReference', txReference);
   formData.append('screenshot', proofFile);
   const res = await fetch('/api/auth/renew-request', { method: 'POST', body: formData });
   const data = (await res.json()) as { ok?: boolean; error?: string };
   if (!res.ok || !data.ok) {
    throw new Error(data.error || t('account_renew_failed'));
   }
   setSubmitted(true);
  } catch (err) {
   setError(err instanceof Error ? err.message : t('account_renew_failed'));
  } finally {
   setIsSubmitting(false);
  }
 };

 if (submitted) {
  return (
   <SiteLayout>
    <div className="flex flex-1 items-center justify-center p-4">
     <div className="w-full max-w-sm">
      <section className="rounded border border-gray-300 bg-white p-8 shadow-md text-center">
       <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-4xl">⏳</div>
       <h2 className="mb-2 text-base font-semibold text-gray-900">{t('signup_pending_title')}</h2>
       <p className="mb-5 text-sm text-gray-600">{t('signup_pending_body')}</p>
       <button
        type="button"
        onClick={() => router.push('/login')}
        className="text-sm text-blue-700 hover:underline"
       >
        {t('login_title')}
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
    <div className="w-full max-w-sm">
     <div className="mb-6 text-center">
      <p className="text-sm text-gray-500">{t('renew_title')}</p>
     </div>

     <section className="rounded border border-gray-300 bg-white shadow-md">
      <div className="border-b border-gray-200 bg-gray-50 px-5 py-3">
       <h2 className="text-sm font-semibold text-gray-700">{t('signup_payment_title')}</h2>
      </div>

      <form onSubmit={(e) => void onSubmit(e)} className="p-5 space-y-4">
       <div>
        <label className="mb-1 block text-xs font-semibold text-gray-600">{t('signup_email')}</label>
        <input
         type="text"
         value={email}
         onChange={(e) => setEmail(e.target.value)}
         placeholder={t('signup_email')}
         className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
         autoCapitalize="none"
         required
        />
       </div>

       {paymentInfo?.tiers?.length ? (
        <div className="grid grid-cols-1 gap-2">
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
          <img src={paymentInfo.qrDataUrl} alt="USDT wallet QR" className="mx-auto h-40 w-40 rounded border border-gray-200 bg-white p-1" />
         ) : null}
         <div>
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
         </div>
         <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
          {t('signup_payment_network_warning', { network: paymentInfo.network })}
         </p>
        </>
       ) : (
        <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">{t('signup_payment_not_configured')}</p>
       )}

       <div>
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

       <div className="border-t border-gray-200 pt-4 text-center">
        <button type="button" onClick={() => router.push('/login')} className="text-sm text-blue-700 transition hover:text-blue-900 hover:underline">
         {t('login_title')}
        </button>
       </div>
      </form>
     </section>
    </div>
   </div>
  </SiteLayout>
 );
}
