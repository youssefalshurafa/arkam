'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useTranslation } from '@/hooks/useTranslation';
import { panelClassName } from '@/shared/styles';
import type { ThemeChoice } from '@/shared/lib/localStorage';

// Small inline glyphs so the control reads at a glance without depending on the
// shared icon set (which has no sun/moon/monitor entries).
function ThemeGlyph({ choice }: { choice: ThemeChoice }) {
 const common = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
 };
 if (choice === 'light') {
  return (
   <svg {...common}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
   </svg>
  );
 }
 if (choice === 'dark') {
  return (
   <svg {...common}>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
   </svg>
  );
 }
 return (
  <svg {...common}>
   <rect x="2" y="3" width="20" height="14" rx="2" />
   <path d="M8 21h8M12 17v4" />
  </svg>
 );
}

export default function AppearanceSettings() {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const { theme, setTheme } = useTheme();

 const options: Array<{ value: ThemeChoice; label: string }> = [
  { value: 'light', label: t('appearance_theme_light') },
  { value: 'dark', label: t('appearance_theme_dark') },
  { value: 'system', label: t('appearance_theme_system') },
 ];

 return (
  <section className="flex flex-col gap-6">
   <div className={panelClassName}>
    <h2 className="text-2xl font-semibold">{t('settings_appearance_title')}</h2>
    <p className="mt-2 text-sm text-fg-muted">{t('settings_appearance_description')}</p>

    <div className="mt-6 max-w-md">
     <label className="block text-sm font-medium text-fg-muted">{t('appearance_theme_label')}</label>
     <div
      role="radiogroup"
      aria-label={t('appearance_theme_label')}
      className="mt-2 grid grid-cols-3 gap-2 rounded-lg border border-border bg-surface-2 p-1.5"
     >
      {options.map((option) => {
       const isActive = theme === option.value;
       return (
        <button
         key={option.value}
         type="button"
         role="radio"
         aria-checked={isActive}
         onClick={() => setTheme(option.value)}
         className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${
          isActive
           ? 'bg-accent text-accent-contrast shadow-sm'
           : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
         }`}
        >
         <ThemeGlyph choice={option.value} />
         {option.label}
        </button>
       );
      })}
     </div>
    </div>
   </div>
  </section>
 );
}
