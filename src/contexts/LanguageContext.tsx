'use client';

import { createContext, useContext, useEffect, useState } from 'react';

export type Language = 'en' | 'ar' | 'fr';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  isRTL: boolean;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // Default to Arabic for first-time visitors (no saved preference yet).
  const [language, setLanguageState] = useState<Language>('ar');

  useEffect(() => {
    const stored = localStorage.getItem('arkam_language') as Language | null;
    const lang = stored || 'ar';
    setLanguageState(lang);
  }, []);

  useEffect(() => {
    updateLanguage(language);
  }, [language]);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('arkam_language', lang);
    updateLanguage(lang);
  };

  const updateLanguage = (lang: Language) => {
    const isRTL = lang === 'ar';
    document.documentElement.lang = lang;
    document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
  };

  const isRTL = language === 'ar';

  return (
    <LanguageContext.Provider value={{ language, setLanguage, isRTL }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return context;
}
