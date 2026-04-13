const translations: Record<
  'en' | 'ar' | 'fr',
  Record<string, string>
> = {
  en: require('../../public/locales/en/common.json'),
  ar: require('../../public/locales/ar/common.json'),
  fr: require('../../public/locales/fr/common.json'),
};

export function useTranslation(lang: 'en' | 'ar' | 'fr') {
  return {
    t: (key: string) => translations[lang][key] || key,
  };
}
