'use client';

import { ReactNode } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';

const languageOptions: Array<{ code: 'en' | 'ar' | 'fr'; label: string }> = [
 { code: 'en', label: 'EN' },
 { code: 'ar', label: 'ع' },
 { code: 'fr', label: 'FR' },
];

// Shared public shell: top navbar (clickable ARKAM brand → home + language
// switcher + optional Sign in) and footer, wrapped around any page content.
export default function SiteLayout({ children, hideSignIn = false }: { children: ReactNode; hideSignIn?: boolean }) {
 const router = useRouter();
 const { language, setLanguage } = useLanguage();
 const { t } = useTranslation(language);

 return (
  <div className="flex min-h-screen flex-col bg-surface-hover text-fg">
   <header className="flex items-center justify-between border-b border-border bg-surface px-5 py-3">
    <button
     type="button"
     onClick={() => router.push('/')}
     title={t('home_back_home')}
     aria-label={t('home_back_home')}
     className="inline-flex items-center justify-center rounded transition hover:opacity-80"
    >
     <Image src="/logo/arkam-logo.png" alt="Arkam" width={720} height={876} priority className="h-11 w-auto" />
    </button>
    <div className="flex items-center gap-3">
     <button
      type="button"
      onClick={() => router.push('/pricing')}
      className="hidden rounded px-2 py-1 text-sm font-semibold text-fg-muted transition hover:text-accent sm:inline-block"
     >
      {t('nav_pricing')}
     </button>
     <div className="flex items-center gap-1 rounded border border-border p-0.5">
      {languageOptions.map((option) => (
       <button
        key={option.code}
        type="button"
        onClick={() => setLanguage(option.code)}
        className={`rounded px-2 py-1 text-xs font-semibold transition ${
         language === option.code ? 'bg-blue-700 text-white' : 'text-fg-faint hover:bg-surface-hover'
        }`}
       >
        {option.label}
       </button>
      ))}
     </div>
     {!hideSignIn && (
      <button
       type="button"
       onClick={() => router.push('/login')}
       className="rounded border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-fg-muted transition hover:bg-surface-hover"
      >
       {t('home_sign_in')}
      </button>
     )}
    </div>
   </header>

   <main className="flex flex-1 flex-col">{children}</main>

   <footer className="border-t border-border bg-surface px-5 py-8 text-sm text-fg-faint">
    <div className="mx-auto flex max-w-5xl flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
     <div>
      <p className="font-semibold text-fg-muted">Arkam</p>
      <p className="mt-1 text-xs text-fg-faint">{t('home_footer_tagline')}</p>
      <p className="mt-3 text-xs text-fg-faint">
       &copy; {new Date().getFullYear()} Arkam. {t('home_footer_rights')}
      </p>
     </div>
     <div className="flex flex-col gap-1.5 text-xs">
      <span className="mb-0.5 font-semibold uppercase tracking-wide text-fg-faint">{t('home_footer_links')}</span>
      <button type="button" onClick={() => router.push('/')} className="text-left text-fg-faint transition hover:text-accent hover:underline">
       {t('nav_home')}
      </button>
      <button type="button" onClick={() => router.push('/pricing')} className="text-left text-fg-faint transition hover:text-accent hover:underline">
       {t('nav_pricing')}
      </button>
      <button type="button" onClick={() => router.push('/login')} className="text-left text-fg-faint transition hover:text-accent hover:underline">
       {t('home_sign_in')}
      </button>
      <button type="button" onClick={() => router.push('/signup')} className="text-left text-fg-faint transition hover:text-accent hover:underline">
       {t('signup_link')}
      </button>
     </div>
     <div className="flex flex-col gap-1.5 text-xs">
      <span className="mb-0.5 font-semibold uppercase tracking-wide text-fg-faint">{t('home_footer_contact')}</span>
      <a href="mailto:support@arkam.app" className="text-fg-faint transition hover:text-accent hover:underline">
       support@arkam.app
      </a>
     </div>
    </div>
   </footer>
  </div>
 );
}
