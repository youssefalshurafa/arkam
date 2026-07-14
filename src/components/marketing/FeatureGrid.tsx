'use client';

import { ReactNode } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';

type Item = { icon: ReactNode; titleKey: string; bodyKey: string };

// Minimal line icons (inherit currentColor).
const I = {
 import: (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
   <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
   <polyline points="7 10 12 15 17 10" />
   <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
 ),
 reorder: (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
   <polyline points="8 6 12 2 16 6" />
   <polyline points="8 18 12 22 16 18" />
   <line x1="12" y1="2" x2="12" y2="22" />
  </svg>
 ),
 sum: (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
   <path d="M18 4H6l6 8-6 8h12" />
  </svg>
 ),
 highlight: (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
   <path d="M12 2l2.4 7.4H22l-6 4.5 2.3 7.1-6.3-4.6L5.7 21 8 14 2 9.4h7.6z" />
  </svg>
 ),
 columns: (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
   <rect x="3" y="3" width="18" height="18" rx="2" />
   <line x1="9" y1="3" x2="9" y2="21" />
   <line x1="15" y1="3" x2="15" y2="21" />
  </svg>
 ),
 context: (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
   <circle cx="12" cy="5" r="1" />
   <circle cx="12" cy="12" r="1" />
   <circle cx="12" cy="19" r="1" />
  </svg>
 ),
 writeoff: (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
   <circle cx="12" cy="12" r="9" />
   <line x1="8" y1="12" x2="16" y2="12" />
  </svg>
 ),
 sync: (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
   <polyline points="23 4 23 10 17 10" />
   <polyline points="1 20 1 14 7 14" />
   <path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15" />
  </svg>
 ),
 reconcile: (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
   <rect x="3" y="11" width="18" height="11" rx="2" />
   <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
 ),
};

const ITEMS: Item[] = [
 { icon: I.import, titleKey: 'home_grid_import_title', bodyKey: 'home_grid_import_body' },
 { icon: I.reorder, titleKey: 'home_grid_reorder_title', bodyKey: 'home_grid_reorder_body' },
 { icon: I.sum, titleKey: 'home_grid_sum_title', bodyKey: 'home_grid_sum_body' },
 { icon: I.highlight, titleKey: 'home_grid_highlight_title', bodyKey: 'home_grid_highlight_body' },
 { icon: I.columns, titleKey: 'home_grid_columns_title', bodyKey: 'home_grid_columns_body' },
 { icon: I.context, titleKey: 'home_grid_context_title', bodyKey: 'home_grid_context_body' },
 { icon: I.writeoff, titleKey: 'home_grid_writeoff_title', bodyKey: 'home_grid_writeoff_body' },
 { icon: I.sync, titleKey: 'home_grid_sync_title', bodyKey: 'home_grid_sync_body' },
 { icon: I.reconcile, titleKey: 'home_grid_reconcile_title', bodyKey: 'home_grid_reconcile_body' },
];

export default function FeatureGrid() {
 const { language } = useLanguage();
 const { t } = useTranslation(language);

 return (
  <section className="border-t border-border bg-surface-2">
   <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:py-20">
    <div className="mx-auto max-w-2xl text-center">
     <h2 className="text-3xl font-bold tracking-tight text-fg sm:text-4xl">{t('home_grid_title')}</h2>
     <p className="mt-3 text-base text-fg-muted">{t('home_grid_subtitle')}</p>
    </div>
    <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
     {ITEMS.map((item) => (
      <div key={item.titleKey} className="rounded-xl border border-border bg-surface p-5 transition hover:border-blue-200 hover:shadow-sm">
       <span className="grid h-10 w-10 place-items-center rounded-lg bg-accent-weak text-accent">
        <span className="h-5 w-5">{item.icon}</span>
       </span>
       <h3 className="mt-4 text-sm font-semibold text-fg">{t(item.titleKey)}</h3>
       <p className="mt-1.5 text-sm text-fg-muted">{t(item.bodyKey)}</p>
      </div>
     ))}
    </div>
   </div>
  </section>
 );
}
