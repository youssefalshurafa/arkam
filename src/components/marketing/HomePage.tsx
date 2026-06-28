'use client';

import { useRouter } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { APP_PLAN } from '@/config/plan';
import SiteLayout from '@/components/marketing/SiteLayout';

export default function HomePage() {
 const router = useRouter();
 const { language } = useLanguage();
 const { t } = useTranslation(language);

 return (
  <SiteLayout>
   {/* Hero */}
   <section className="mx-auto w-full max-w-5xl px-5 py-16 text-center">
    <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">{t('home_hero_title')}</h1>
    <p className="mx-auto mt-4 max-w-2xl text-base text-gray-600">{t('home_hero_subtitle')}</p>
    <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
     <button
      type="button"
      onClick={() => router.push('/signup')}
      className="rounded border border-blue-700 bg-blue-700 px-6 py-3 text-sm font-semibold text-white transition hover:bg-blue-800"
     >
      {t('home_get_started')}
     </button>
     <button
      type="button"
      onClick={() => router.push('/login')}
      className="rounded border border-gray-300 bg-white px-6 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
     >
      {t('home_sign_in')}
     </button>
    </div>
   </section>

   {/* About / features */}
   <section className="mx-auto w-full max-w-5xl px-5 pb-8">
    <div className="grid gap-4 sm:grid-cols-3">
     {[
      { title: t('home_feature_ledgers_title'), body: t('home_feature_ledgers_body') },
      { title: t('home_feature_multicurrency_title'), body: t('home_feature_multicurrency_body') },
      { title: t('home_feature_exports_title'), body: t('home_feature_exports_body') },
     ].map((feature) => (
      <div key={feature.title} className="rounded border border-gray-200 bg-white p-5">
       <h3 className="text-sm font-semibold text-gray-900">{feature.title}</h3>
       <p className="mt-2 text-sm text-gray-600">{feature.body}</p>
      </div>
     ))}
    </div>
   </section>

   {/* Pricing */}
   <section className="mx-auto w-full max-w-5xl px-5 py-12">
    <div className="text-center">
     <h2 className="text-2xl font-bold text-gray-900">{t('home_pricing_title')}</h2>
     <p className="mt-2 text-sm text-gray-600">{t('home_pricing_subtitle')}</p>
    </div>

    <div className="mx-auto mt-8 max-w-md">
     <div className="overflow-hidden rounded-xl border border-blue-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 bg-blue-50 px-6 py-5 text-center">
       <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">{APP_PLAN.name}</p>
       <p className="mt-2 text-4xl font-bold text-gray-900">
        {APP_PLAN.priceUsdt} <span className="text-lg font-semibold text-gray-500">USDT</span>
       </p>
       <p className="mt-1 text-xs text-gray-500">{APP_PLAN.period}</p>
       <p className="mt-3 text-sm text-gray-600">{APP_PLAN.tagline}</p>
      </div>
      <div className="px-6 py-6">
       <ul className="space-y-3">
        {APP_PLAN.features.map((feature) => (
         <li key={feature} className="flex items-start gap-2 text-sm text-gray-700">
          <svg className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
           <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>{feature}</span>
         </li>
        ))}
       </ul>
       <button
        type="button"
        onClick={() => router.push('/signup')}
        className="mt-6 w-full rounded border border-blue-700 bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800"
       >
        {t('home_get_started')}
       </button>
       <p className="mt-3 text-center text-xs text-gray-400">{t('home_pricing_note')}</p>
      </div>
     </div>
    </div>
   </section>
  </SiteLayout>
 );
}
