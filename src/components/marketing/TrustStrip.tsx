'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';

export default function TrustStrip() {
 const { language } = useLanguage();
 const { t } = useTranslation(language);

 const stats = [
  { value: t('home_stat_1_value'), label: t('home_stat_1_label') },
  { value: t('home_stat_2_value'), label: t('home_stat_2_label') },
  { value: t('home_stat_3_value'), label: t('home_stat_3_label') },
  { value: t('home_stat_4_value'), label: t('home_stat_4_label') },
 ];

 return (
  <section className="border-y border-border bg-surface-2">
   <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-6 px-5 py-10 md:grid-cols-4">
    {stats.map((s) => (
     <div key={s.label} className="text-center">
      <p className="text-xl font-bold text-accent sm:text-2xl">{s.value}</p>
      <p className="mt-1 text-xs text-fg-faint sm:text-sm">{s.label}</p>
     </div>
    ))}
   </div>
  </section>
 );
}
