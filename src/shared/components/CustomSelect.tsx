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
}

/**
 * Renders its own popup panel instead of relying on the browser's native <select> popup,
 * which on Windows/Chromium can intermittently paint blank (a known OS/GPU rendering glitch).
 */
export default function CustomSelect<T extends string | number>({ value, options, onChange, className = '', disabled }: CustomSelectProps<T>) {
 const [open, setOpen] = useState(false);
 const rootRef = useRef<HTMLDivElement>(null);

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

 const selected = options.find((o) => o.value === value);

 return (
  <div
   ref={rootRef}
   className="relative"
  >
   <button
    type="button"
    disabled={disabled}
    onClick={() => setOpen((o) => !o)}
    className={`flex w-full items-center justify-between disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
   >
    <span className="truncate">{selected?.label ?? ''}</span>
    <svg
     className={`h-4 w-4 shrink-0 text-fg-faint transition-transform ${open ? 'rotate-180' : ''}`}
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
    <ul className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded border border-border bg-surface text-sm shadow-lg">
     {options.map((opt) => (
      <li key={opt.value}>
       <button
        type="button"
        onClick={() => {
         onChange(opt.value);
         setOpen(false);
        }}
        className={`block w-full px-3 py-2 text-start hover:bg-accent-weak ${opt.value === value ? 'bg-accent-weak font-medium text-accent' : 'text-fg-muted'}`}
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
