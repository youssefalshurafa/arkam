'use client';

import { useRouter } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';

export default function PricingTeaser() {
 const router = useRouter();
 const { language } = useLanguage();
 const { t } = useTranslation(language);

 return (
  <section className="bg-white">
   <div className="mx-auto w-full max-w-5xl px-5 py-16">
    <div className="overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-white px-6 py-10 text-center sm:px-12">
     <h2 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">{t('home_pricing_teaser_title')}</h2>
     <p className="mx-auto mt-3 max-w-xl text-base text-gray-600">{t('home_pricing_teaser_body')}</p>
     <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
      <button
       type="button"
       onClick={() => router.push('/pricing')}
       className="rounded-lg bg-blue-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800"
      >
       {t('home_pricing_teaser_cta')}
      </button>
      <button
       type="button"
       onClick={() => router.push('/signup')}
       className="rounded-lg border border-gray-300 bg-white px-6 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
      >
       {t('home_get_started')}
      </button>
     </div>
    </div>
   </div>
  </section>
 );
}
