'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { renderIcon } from '@/shared/utils/icons';
import { panelClassName } from '@/shared/styles';

// Placeholder page for the upcoming "Treasury & Cashbox" (الخزينة و الصندوق) feature.
// Purely informational for now — a "coming soon" card so the navigation entry exists
// and users know the feature is planned.
export default function TreasurySection() {
 const { language } = useLanguage();
 const { t } = useTranslation(language);

 return (
  <div className={`${panelClassName} flex flex-col items-center justify-center gap-4 px-6 py-16 text-center`}>
   <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-500">
    {renderIcon('treasury', 'h-8 w-8')}
   </div>
   <span className="inline-flex items-center gap-2 rounded-full bg-warn-bg px-3 py-1 text-xs font-semibold uppercase tracking-wide text-warn-text">
    {t('coming_soon_badge')}
   </span>
   <h2 className="text-2xl font-bold text-fg">{t('treasury_title')}</h2>
   <p className="max-w-md text-sm text-fg-faint">{t('treasury_coming_soon')}</p>
  </div>
 );
}
