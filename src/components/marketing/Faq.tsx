'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';

// Reused by the homepage and the pricing page. Pass the translation keys for the
// section title and the Q/A pairs to show.
export default function Faq({ titleKey, pairs }: { titleKey: string; pairs: Array<{ q: string; a: string }> }) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);

 return (
  <section className="border-t border-border bg-surface">
   <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:py-20">
    <h2 className="text-center text-3xl font-bold tracking-tight text-fg sm:text-4xl">{t(titleKey)}</h2>
    <div className="mt-10 divide-y divide-border rounded-xl border border-border">
     {pairs.map((pair) => (
      <details key={pair.q} className="group px-5 py-4">
       <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-fg">
        <span>{t(pair.q)}</span>
        <svg
         className="h-4 w-4 shrink-0 text-fg-faint transition group-open:rotate-180"
         viewBox="0 0 24 24"
         fill="none"
         stroke="currentColor"
         strokeWidth="2"
         strokeLinecap="round"
         strokeLinejoin="round"
         aria-hidden
        >
         <polyline points="6 9 12 15 18 9" />
        </svg>
       </summary>
       <p className="mt-3 text-sm leading-relaxed text-fg-muted">{t(pair.a)}</p>
      </details>
     ))}
    </div>
   </div>
  </section>
 );
}
