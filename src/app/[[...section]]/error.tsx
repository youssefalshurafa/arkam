'use client';

import { useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';

/**
 * Route-level error boundary for the main app shell. This catches anything the
 * per-section SectionErrorBoundary didn't — a throw from the page component itself,
 * or from the shared hooks/stores that live above the section switch.
 *
 * layout.tsx (and therefore AuthSessionProvider/QueryProvider/ThemeProvider/
 * LanguageProvider) stays mounted around this, so the translation and theme hooks are
 * safe to use here. The last-resort case where the layout itself fails is handled by
 * global-error.tsx instead, which cannot rely on any of that.
 */
export default function SectionRouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);

 useEffect(() => {
  console.error('[app/error] route render failed', error);
 }, [error]);

 return (
  <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
   <div className="flex w-full max-w-lg flex-col gap-3 rounded border border-border-strong bg-surface p-6">
    <h1 className="text-lg font-semibold text-fg">{t('section_error_title')}</h1>
    <p className="text-sm text-fg-muted">{t('section_error_body')}</p>

    <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-border bg-surface-2 p-3 text-xs text-fg-faint">{error.message}</pre>

    <div className="flex flex-wrap items-center gap-2">
     <button type="button" onClick={reset} className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-accent-contrast transition hover:bg-accent-strong">
      {t('section_error_retry')}
     </button>
     <button
      type="button"
      onClick={() => window.location.reload()}
      className="rounded border border-border-strong bg-surface px-3 py-1.5 text-sm font-semibold text-fg transition hover:bg-surface-hover"
     >
      {t('section_error_reload')}
     </button>
    </div>
   </div>
  </div>
 );
}
