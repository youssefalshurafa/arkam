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
  <div className="flex min-h-screen flex-col bg-gray-100 text-gray-900">
   <header className="flex items-center justify-between border-b border-gray-200 bg-white px-5 py-3">
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
     <div className="flex items-center gap-1 rounded border border-gray-200 p-0.5">
      {languageOptions.map((option) => (
       <button
        key={option.code}
        type="button"
        onClick={() => setLanguage(option.code)}
        className={`rounded px-2 py-1 text-xs font-semibold transition ${
         language === option.code ? 'bg-blue-700 text-white' : 'text-gray-500 hover:bg-gray-100'
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
       className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
      >
       {t('home_sign_in')}
      </button>
     )}
    </div>
   </header>

   <main className="flex flex-1 flex-col">{children}</main>

   <footer className="border-t border-gray-200 bg-white px-5 py-6 text-center text-xs text-gray-400">
    Arkam &mdash; {t('home_footer_tagline')}
   </footer>
  </div>
 );
}
