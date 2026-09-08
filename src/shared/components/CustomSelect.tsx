'use client';

import { useEffect, useRef, useState } from 'react';

export interface CustomSelectOption<T extends string | number> {
 value: T;
 label: string;
}

interface CustomSelectProps<T extends string | number> {
 value: T;
 options: CustomSelectOption<T>[];
 onChange: (value: T) => void;
 className?: string;
 disabled?: boolean;
 // Compact mode: the trigger shrinks to its label instead of filling the row, and the popup
 // sizes to its widest option (still at least as wide as the trigger) rather than to the
 // trigger's width — for a select sitting inline inside a sentence/value, like the currency
 // code after an amount.
 inline?: boolean;
 // Which edge of the trigger the popup is anchored to. Logical, so 'end' means left in RTL.
 align?: 'start' | 'end';
}

/**
 * Renders its own popup panel instead of relying on the browser's native <select> popup,
 * which on Windows/Chromium can intermittently paint blank (a known OS/GPU rendering glitch).
 */
export default function CustomSelect<T extends string | number>({ value, options, onChange, className = '', disabled, inline = false, align = 'start' }: CustomSelectProps<T>) {
 const [open, setOpen] = useState(false);
 const rootRef = useRef<HTMLDivElement>(null);
 const listRef = useRef<HTMLUListElement>(null);

 useEffect(() => {
  if (!open) return;
  const handleClick = (e: MouseEvent) => {
   if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
    setOpen(false);
   }
  };
  const handleKey = (e: KeyboardEvent) => {
   if (e.key === 'Escape') setOpen(false);
  };
  document.addEventListener('mousedown', handleClick);
  document.addEventListener('keydown', handleKey);
  return () => {
   document.removeEventListener('mousedown', handleClick);
   document.removeEventListener('keydown', handleKey);
  };
 }, [open]);

 // With a long list (currencies), open on the current value rather than at the top.
 useEffect(() => {
  if (!open) return;
  listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
 }, [open]);

 const selected = options.find((o) => o.value === value);

 return (
  <div
   ref={rootRef}
   className={inline ? 'relative inline-block align-baseline' : 'relative'}
  >
   <button
    type="button"
    disabled={disabled}
    onClick={() => setOpen((o) => !o)}
    className={`${inline ? 'inline-flex w-auto items-center gap-0.5' : 'flex w-full items-center justify-between'} disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
   >
    <span className={inline ? '' : 'truncate'}>{selected?.label ?? ''}</span>
    <svg
     className={`${inline ? 'h-3 w-3' : 'h-4 w-4'} shrink-0 text-fg-faint transition-transform ${open ? 'rotate-180' : ''}`}
     viewBox="0 0 20 20"
     fill="none"
     stroke="currentColor"
    >
     <path
      d="M5 7l5 5 5-5"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
     />
    </svg>
   </button>
   {open && (
    <ul
     ref={listRef}
     className={`absolute z-30 mt-1 max-h-60 overflow-y-auto rounded border border-border bg-surface text-sm shadow-lg ${inline ? 'w-max min-w-full' : 'w-full'} ${align === 'end' ? 'end-0' : 'start-0'}`}
    >
     {options.map((opt) => (
      <li key={opt.value}>
       <button
        type="button"
        data-selected={opt.value === value}
        onClick={() => {
         onChange(opt.value);
         setOpen(false);
        }}
        className={`block w-full whitespace-nowrap px-3 py-2 text-start hover:bg-accent-weak ${opt.value === value ? 'bg-accent-weak font-medium text-accent' : 'text-fg-muted'}`}
       >
        {opt.label}
       </button>
      </li>
     ))}
    </ul>
   )}
  </div>
 );
}
