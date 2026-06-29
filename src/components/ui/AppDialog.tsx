'use client';

import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';

type DialogKind = 'confirm' | 'alert' | 'prompt';
type DialogTone = 'default' | 'danger';

export interface DialogOptions {
 /** Bold heading shown at the top of the dialog. */
 title?: string;
 /** Main body text. Newlines are preserved. */
 message?: string;
 /** Label for the primary/confirm button. Defaults to a translated "Confirm"/"OK". */
 confirmText?: string;
 /** Label for the cancel button. Defaults to a translated "Cancel". */
 cancelText?: string;
 /** "danger" renders a red primary button for destructive actions. */
 tone?: DialogTone;
 /** Prompt only: initial value of the text field. */
 defaultValue?: string;
 /** Prompt only: placeholder for the text field. */
 placeholder?: string;
}

interface DialogRequest extends DialogOptions {
 id: number;
 kind: DialogKind;
 resolve: (value: boolean | string | null | void) => void;
}

let notify: ((req: DialogRequest) => void) | null = null;
let counter = 0;

function enqueue(kind: DialogKind, options: DialogOptions): Promise<boolean | string | null | void> {
 return new Promise((resolve) => {
  const request: DialogRequest = { ...options, id: (counter += 1), kind, resolve };
  if (notify) {
   notify(request);
  } else {
   // No host mounted yet — fail safe (treat as cancelled / dismissed).
   resolve(kind === 'confirm' ? false : kind === 'prompt' ? null : undefined);
  }
 });
}

/** Promise-based replacement for window.confirm. Resolves true if confirmed. */
export function confirmDialog(options: DialogOptions): Promise<boolean> {
 return enqueue('confirm', options) as Promise<boolean>;
}

/** Promise-based replacement for window.alert. Resolves when dismissed. */
export function alertDialog(options: DialogOptions): Promise<void> {
 return enqueue('alert', options) as Promise<void>;
}

/** Promise-based replacement for window.prompt. Resolves to the entered text, or null if cancelled. */
export function promptDialog(options: DialogOptions): Promise<string | null> {
 return enqueue('prompt', options) as Promise<string | null>;
}

/**
 * Renders the active in-app dialog. Mount this once near the root, inside the
 * LanguageProvider so it can localize its default button labels and respect RTL.
 */
export function DialogHost() {
 const { language, isRTL } = useLanguage();
 const { t } = useTranslation(language);
 const [queue, setQueue] = useState<DialogRequest[]>([]);
 const [inputValue, setInputValue] = useState('');
 const inputRef = useRef<HTMLInputElement | null>(null);

 useEffect(() => {
  notify = (req) => setQueue((current) => [...current, req]);
  return () => {
   notify = null;
  };
 }, []);

 const current = queue[0] ?? null;

 useEffect(() => {
  if (current?.kind === 'prompt') {
   setInputValue(current.defaultValue ?? '');
   // Focus and select after the field renders.
   requestAnimationFrame(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
   });
  }
 }, [current]);

 if (!current) return null;

 const settle = (value: boolean | string | null | void) => {
  current.resolve(value);
  setQueue((q) => q.slice(1));
 };

 const onConfirm = () => {
  if (current.kind === 'prompt') settle(inputValue);
  else if (current.kind === 'confirm') settle(true);
  else settle(undefined);
 };

 const onCancel = () => {
  if (current.kind === 'prompt') settle(null);
  else if (current.kind === 'confirm') settle(false);
  else settle(undefined);
 };

 const isDanger = current.tone === 'danger';
 const showCancel = current.kind !== 'alert';
 const fallbackConfirm = current.kind === 'alert' ? t('ok') : t('confirm');
 const confirmLabel = current.confirmText ?? fallbackConfirm;
 const cancelLabel = current.cancelText ?? t('cancel');

 const confirmClassName = isDanger
  ? 'rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700'
  : 'rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800';

 const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
  if (event.key === 'Escape') {
   event.preventDefault();
   onCancel();
  } else if (event.key === 'Enter' && current.kind !== 'alert') {
   // For prompts, let Enter in the input submit; alerts only have one button.
   if (current.kind === 'prompt' && event.target !== inputRef.current) return;
   event.preventDefault();
   onConfirm();
  }
 };

 return (
  <div
   className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
   dir={isRTL ? 'rtl' : 'ltr'}
   onMouseDown={(event) => {
    // Click on the backdrop cancels.
    if (event.target === event.currentTarget) onCancel();
   }}
   onKeyDown={handleKeyDown}
   role="dialog"
   aria-modal="true"
  >
   <div className="w-full max-w-md rounded bg-white p-6 shadow-2xl">
    {current.title ? <h3 className="text-lg font-semibold text-slate-900">{current.title}</h3> : null}
    {current.message ? (
     <p className={`whitespace-pre-line text-sm text-slate-600 ${current.title ? 'mt-2' : ''}`}>{current.message}</p>
    ) : null}

    {current.kind === 'prompt' ? (
     <input
      ref={inputRef}
      type="text"
      value={inputValue}
      placeholder={current.placeholder}
      onChange={(event) => setInputValue(event.target.value)}
      className="mt-4 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
     />
    ) : null}

    <div className="mt-6 flex justify-end gap-2">
     {showCancel ? (
      <button
       type="button"
       onClick={onCancel}
       className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
      >
       {cancelLabel}
      </button>
     ) : null}
     <button
      type="button"
      onClick={onConfirm}
      autoFocus={current.kind !== 'prompt'}
      className={confirmClassName}
     >
      {confirmLabel}
     </button>
    </div>
   </div>
  </div>
 );
}
