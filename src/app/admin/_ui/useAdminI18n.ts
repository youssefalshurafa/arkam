'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';

// Convenience hook: the active app language + its translator, used across the
// admin panel so every screen localizes through the same path as the main app.
export function useAdminI18n() {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 return { language, t };
}
