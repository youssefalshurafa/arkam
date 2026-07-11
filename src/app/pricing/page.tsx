'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import SiteLayout from '@/components/marketing/SiteLayout';
import PricingCards from '@/components/marketing/PricingCards';
import Faq from '@/components/marketing/Faq';

const PRICING_FAQ = [
 { q: 'pricing_faq_q1', a: 'pricing_faq_a1' },
 { q: 'pricing_faq_q2', a: 'pricing_faq_a2' },
 { q: 'pricing_faq_q3', a: 'pricing_faq_a3' },
 { q: 'pricing_faq_q4', a: 'pricing_faq_a4' },
];

export default function PricingPage() {
 const { language } = useLanguage();
 const { t } = useTranslation(language);

 const steps = [
  { title: 'pricing_how_step1_title', body: 'pricing_how_step1_body' },
  { title: 'pricing_how_step2_title', body: 'pricing_how_step2_body' },
  { title: 'pricing_how_step3_title', body: 'pricing_how_step3_body' },
 ];

 return (
  <SiteLayout>
   {/* Header */}
   <section className="relative overflow-hidden bg-white">
    <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-blue-50/70 to-white" />
    <div className="relative mx-auto w-full max-w-5xl px-5 pb-4 pt-16 text-center sm:pt-20">
     <span className="inline-block rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">
      {t('pricing_trial_badge')}
     </span>
     <h1 className="mt-4 text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">{t('home_pricing_title')}</h1>
     <p className="mx-auto mt-4 max-w-xl text-base text-gray-600">{t('pricing_page_subtitle')}</p>
    </div>
   </section>

   {/* Cards */}
   <section className="bg-white">
    <div className="mx-auto w-full max-w-5xl px-5 pb-8 pt-6">
     <PricingCards />
     <p className="mt-6 text-center text-xs text-gray-400">{t('home_pricing_note')}</p>
    </div>
   </section>

   {/* How billing works */}
   <section className="border-t border-gray-200 bg-gray-50">
    <div className="mx-auto w-full max-w-5xl px-5 py-16">
     <h2 className="text-center text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">{t('pricing_how_title')}</h2>
     <div className="mt-10 grid gap-6 sm:grid-cols-3">
      {steps.map((step, i) => (
       <div key={step.title} className="rounded-xl border border-gray-200 bg-white p-6 text-center">
        <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-blue-700 text-sm font-bold text-white">
         {i + 1}
        </span>
        <h3 className="mt-4 text-sm font-semibold text-gray-900">{t(step.title)}</h3>
        <p className="mt-2 text-sm text-gray-600">{t(step.body)}</p>
       </div>
      ))}
     </div>
     <p className="mx-auto mt-8 max-w-xl text-center text-sm text-gray-500">{t('pricing_trial_note')}</p>
    </div>
   </section>

   {/* Billing FAQ */}
   <Faq titleKey="pricing_faq_title" pairs={PRICING_FAQ} />
  </SiteLayout>
 );
}
