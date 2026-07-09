'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import CustomSelect from '@/shared/components/CustomSelect';
import { panelClassName } from '@/shared/styles';

export default function LanguageSettings() {
 const { language, setLanguage } = useLanguage();
 const { t } = useTranslation(language);

 return (
  <section className="flex flex-col gap-6">
   <div className={panelClassName}>
    <h2 className="text-2xl font-semibold">{t('settings_language_title')}</h2>
    <p className="mt-2 text-sm text-slate-600">{t('settings_language_description')}</p>

    <div className="mt-6 max-w-md">
     <label className="block text-sm font-medium text-slate-700">{t('select_language')}</label>
     <CustomSelect
      value={language}
      onChange={(value) => setLanguage(value)}
      options={[
       { value: 'en', label: t('english') },
       { value: 'ar', label: t('arabic') },
       { value: 'fr', label: t('french') },
      ]}
      className="mt-2 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
     />
    </div>
   </div>
  </section>
 );
}
