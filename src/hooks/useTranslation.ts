const translations: Record<'en' | 'ar' | 'fr', Record<string, string>> = {
 en: require('../../public/locales/en/common.json'),
 ar: require('../../public/locales/ar/common.json'),
 fr: require('../../public/locales/fr/common.json'),
};

import { useCallback } from 'react';

export function useTranslation(lang: 'en' | 'ar' | 'fr') {
 const t = useCallback(
  (key: string, params?: Record<string, string | number>) => {
   const template = translations[lang][key] || key;
   if (!params) return template;
   return template.replace(/\{\{(\w+)\}\}/g, (match, name) => (name in params ? String(params[name]) : match));
  },
  [lang],
 );
 return { t };
}
