'use client';

import { useRouter } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';

export default function CtaBand() {
 const router = useRouter();
 const { language } = useLanguage();
 const { t } = useTranslation(language);

 return (
  <section className="bg-gradient-to-br from-blue-700 to-blue-900">
   <div className="mx-auto w-full max-w-4xl px-5 py-16 text-center sm:py-20">
    <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">{t('home_cta_title')}</h2>
    <p className="mx-auto mt-4 max-w-xl text-base text-blue-100">{t('home_cta_body')}</p>
    <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
     <button
      type="button"
      onClick={() => router.push('/signup')}
      className="rounded-lg bg-white px-6 py-3 text-sm font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50"
     >
      {t('home_get_started')}
     </button>
     <button
      type="button"
      onClick={() => router.push('/pricing')}
      className="rounded-lg border border-blue-300/60 bg-transparent px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
     >
      {t('home_cta_secondary')}
     </button>
    </div>
   </div>
  </section>
 );
}
