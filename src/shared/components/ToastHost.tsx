'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useAppStatusStore } from '@/shared/store/appStatusStore';

/**
 * Renders the transient confirmation toast from appStatusStore. Anchored near the
 * originating click when a position was captured, otherwise bottom-center.
 */
export default function ToastHost() {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const toast = useAppStatusStore((s) => s.toast);
 const toastPos = useAppStatusStore((s) => s.toastPos);
 const undo = useAppStatusStore((s) => s.undo);
 const clearUndo = useAppStatusStore((s) => s.clearUndo);

 if (undo) {
  return (
   <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[80] flex justify-center px-4">
    <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-slate-800 px-4 py-2 text-sm font-semibold text-white shadow-lg">
     {undo.message}
     <button
      type="button"
      onClick={() => {
       undo.onUndo();
       clearUndo();
      }}
      className="cursor-pointer rounded-full px-2 py-0.5 text-amber-300 underline decoration-amber-300 underline-offset-2 hover:text-amber-200"
     >
      {t('undo')}
     </button>
    </div>
   </div>
  );
 }

 if (!toast) return null;

 return toastPos ? (
  <div
   className="pointer-events-none fixed z-[80]"
   style={{ left: toastPos.x, top: toastPos.y, transform: 'translate(-50%, calc(-100% - 10px))' }}
  >
   <div className="flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-lg whitespace-nowrap">
    <svg
     width="16"
     height="16"
     viewBox="0 0 24 24"
     fill="none"
     stroke="currentColor"
     strokeWidth="2.5"
     strokeLinecap="round"
     strokeLinejoin="round"
     aria-hidden
    >
     <polyline points="20 6 9 17 4 12" />
    </svg>
    {toast}
   </div>
  </div>
 ) : (
  <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[80] flex justify-center px-4">
   <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-lg">
    <svg
     width="16"
     height="16"
     viewBox="0 0 24 24"
     fill="none"
     stroke="currentColor"
     strokeWidth="2.5"
     strokeLinecap="round"
     strokeLinejoin="round"
     aria-hidden
    >
     <polyline points="20 6 9 17 4 12" />
    </svg>
    {toast}
   </div>
  </div>
 );
}
