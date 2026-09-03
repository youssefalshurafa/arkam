'use client';

import { Component, type ReactNode } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';

/**
 * Catches render/lifecycle errors from one section of the app shell so a crash in a
 * single section (the ledger, transactions, settings…) doesn't white-screen the whole
 * app. The sidebar and header live OUTSIDE this boundary in page.tsx, so the user can
 * still navigate away from a broken section instead of being forced to reload.
 *
 * Mount it with `key={section}` — React remounts a component when its key changes, so
 * navigating to another section clears a caught error automatically and no manual reset
 * on route change is needed.
 *
 * Note this only catches errors thrown during render, in lifecycle methods, and in
 * constructors. It does NOT catch errors inside event handlers, async callbacks, or
 * effects that resolve later — those still reach window.onerror. Data-fetch failures
 * are already surfaced by the section's own `error` state, not here.
 */

type Props = {
 children: ReactNode;
};

type State = {
 error: Error | null;
};

class SectionErrorBoundaryInner extends Component<Props & { fallback: (error: Error, reset: () => void) => ReactNode }, State> {
 state: State = { error: null };

 static getDerivedStateFromError(error: Error): State {
  return { error };
 }

 componentDidCatch(error: Error, info: { componentStack?: string | null }) {
  // Kept as console.error (not the app's toast/dialog host) on purpose: the dialog host
  // may itself be inside the failed tree, and this needs to work when everything else is
  // already broken.
  console.error('[SectionErrorBoundary] section render failed', error, info?.componentStack);
 }

 reset = () => {
  this.setState({ error: null });
 };

 render() {
  if (this.state.error) {
   return this.props.fallback(this.state.error, this.reset);
  }

  return this.props.children;
 }
}

/**
 * The fallback UI. Split out as a function component so it can use the language/
 * translation hooks — the boundary itself must be a class (React only exposes
 * getDerivedStateFromError/componentDidCatch to classes).
 */
function SectionErrorFallback({ error, reset }: { error: Error; reset: () => void }) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);

 return (
  <div className="flex flex-col gap-4 p-4">
   <div className="flex flex-col gap-3 rounded border border-border-strong bg-surface p-6">
    <h2 className="text-base font-semibold text-fg">{t('section_error_title')}</h2>
    <p className="text-sm text-fg-muted">{t('section_error_body')}</p>

    {/* The raw message is shown because this app's users report problems directly to the
        developer; it's a local render error, not server internals (see route.ts for the
        server-side masking of database errors). */}
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

export function SectionErrorBoundary({ children }: Props) {
 return <SectionErrorBoundaryInner fallback={(error, reset) => <SectionErrorFallback error={error} reset={reset} />}>{children}</SectionErrorBoundaryInner>;
}
