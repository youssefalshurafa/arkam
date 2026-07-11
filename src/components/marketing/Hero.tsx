'use client';

import { useRouter } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { MarketingMockup } from '@/components/marketing/MarketingMockup';
import { HeroMockup } from '@/components/marketing/Mockups';

export default function Hero() {
 const router = useRouter();
 const { language } = useLanguage();
 const { t } = useTranslation(language);

 return (
  <section className="relative overflow-hidden bg-white">
   {/* soft brand gradient wash */}
   <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-blue-50/70 via-white to-white" />
   <div aria-hidden className="pointer-events-none absolute -top-24 end-0 h-72 w-72 rounded-full bg-blue-200/40 blur-3xl" />

   <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-5 py-16 sm:py-20 lg:grid-cols-2 lg:gap-8">
    <div className="text-center lg:text-start">
     <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
      <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />
      {t('home_hero_eyebrow')}
     </span>
     <h1 className="mt-5 text-4xl font-bold leading-tight tracking-tight text-gray-900 sm:text-5xl">
      {t('home_hero_title')}
     </h1>
     <p className="mx-auto mt-5 max-w-xl text-base text-gray-600 sm:text-lg lg:mx-0">{t('home_hero_subtitle')}</p>
     <div className="mt-8 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
      <button
       type="button"
       onClick={() => router.push('/signup')}
       className="rounded-lg bg-blue-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800"
      >
       {t('home_get_started')}
      </button>
      <button
       type="button"
       onClick={() => router.push('/login')}
       className="rounded-lg border border-gray-300 bg-white px-6 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
      >
       {t('home_sign_in')}
      </button>
     </div>
     <p className="mt-4 text-xs font-medium text-gray-400">{t('home_hero_trial_note')}</p>
    </div>

    <MarketingMockup slot="hero" className="mx-auto w-full max-w-md lg:mb-6">
     <HeroMockup />
    </MarketingMockup>
   </div>
  </section>
 );
}
