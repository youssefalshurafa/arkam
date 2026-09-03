'use client';

import { useEffect } from 'react';

/**
 * Last-resort boundary: catches failures in the root layout itself (or in any of the
 * providers it mounts). Next.js REPLACES the root layout when this renders, so this
 * file must supply its own <html>/<body> — and it cannot use LanguageProvider,
 * ThemeProvider, or the translation hook, since a layout-level failure may mean none of
 * them ever mounted.
 *
 * For the same reason the styling here is inline rather than Tailwind semantic tokens:
 * if globals.css failed to load, class names would render as unstyled text. The copy is
 * hardcoded Arabic (the app's default language, see LanguageProvider) with an English
 * line under it, because there is no language context to read a preference from.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
 useEffect(() => {
  console.error('[app/global-error] root layout render failed', error);
 }, [error]);

 return (
  <html lang="ar" dir="rtl">
   <body style={{ margin: 0, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', background: '#f3f4f6', color: '#111827', fontFamily: 'system-ui, sans-serif' }}>
    <div style={{ maxWidth: '32rem', width: '100%', display: 'flex', flexDirection: 'column', gap: '12px', border: '1px solid #cbd5e1', borderRadius: '4px', background: '#ffffff', padding: '24px' }}>
     <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>حدث خطأ غير متوقع</h1>
     <p style={{ margin: 0, fontSize: '14px', color: '#475569' }}>تعذّر تحميل التطبيق. لم يتم فقدان أي بيانات محفوظة.</p>
     <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }} dir="ltr">
      Something went wrong loading the app. No saved data was lost.
     </p>

     <pre style={{ margin: 0, maxHeight: '10rem', overflow: 'auto', whiteSpace: 'pre-wrap', border: '1px solid #e2e8f0', borderRadius: '4px', background: '#f9fafb', padding: '12px', fontSize: '12px', color: '#475569' }} dir="ltr">
      {error.message}
     </pre>

     <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
      <button type="button" onClick={reset} style={{ cursor: 'pointer', border: 0, borderRadius: '4px', background: '#1d4ed8', color: '#ffffff', padding: '6px 12px', fontSize: '14px', fontWeight: 600 }}>
       إعادة المحاولة
      </button>
      <button
       type="button"
       onClick={() => window.location.reload()}
       style={{ cursor: 'pointer', border: '1px solid #cbd5e1', borderRadius: '4px', background: '#ffffff', color: '#111827', padding: '6px 12px', fontSize: '14px', fontWeight: 600 }}
      >
       تحديث الصفحة
      </button>
     </div>
    </div>
   </body>
  </html>
 );
}
