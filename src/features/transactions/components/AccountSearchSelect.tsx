'use client';

import { useState } from 'react';
import type { ClientAccount } from '@/shared/types';

export default function AccountSearchSelect({
 accounts,
 value,
 onChange,
 placeholder,
 clearLabel,
 isRTL,
}: {
 accounts: ClientAccount[];
 value: number | null;
 onChange: (id: number | null) => void;
 placeholder: string;
 clearLabel: string;
 isRTL: boolean;
}) {
 const [query, setQuery] = useState('');
 const [open, setOpen] = useState(false);
 const selected = value != null ? (accounts.find((account) => account.id === value) ?? null) : null;
 const selectedLabel = selected ? `${selected.clientName} · ${selected.currencyCode}` : '';
 const q = query.trim().toLowerCase();
 const filtered = q ? accounts.filter((account) => `${account.clientName} ${account.currencyCode}`.toLowerCase().includes(q)) : accounts;
 return (
  <div className="relative">
   <input
    type="text"
    value={open ? query : selectedLabel}
    onChange={(event) => {
     setQuery(event.target.value);
     setOpen(true);
    }}
    onFocus={() => {
     setQuery('');
     setOpen(true);
    }}
    onBlur={() => setTimeout(() => setOpen(false), 150)}
    placeholder={placeholder}
    autoComplete="off"
    className={`min-w-40 w-full rounded border border-border-strong px-2 py-1.5 text-xs outline-none ring-blue-300 focus:ring ${isRTL ? 'pl-7' : 'pr-7'}`}
   />
   {value != null && !open ? (
    <button
     type="button"
     onMouseDown={(event) => {
      event.preventDefault();
      onChange(null);
      setQuery('');
      setOpen(false);
     }}
     title={clearLabel}
     aria-label={clearLabel}
     className={`absolute inset-y-0 my-auto flex h-5 w-5 items-center justify-center rounded text-fg-faint hover:bg-surface-hover hover:text-fg-muted ${isRTL ? 'left-1.5' : 'right-1.5'}`}
    >
     <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
     >
      <line
       x1="18"
       y1="6"
       x2="6"
       y2="18"
      />
      <line
       x1="6"
       y1="6"
       x2="18"
       y2="18"
      />
     </svg>
    </button>
   ) : null}
   {open ? (
    <ul className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded border border-border bg-surface text-xs shadow-lg">
     {filtered.length === 0 ? (
      <li className="px-3 py-2 text-fg-faint">{placeholder}</li>
     ) : (
      filtered.map((account) => (
       <li
        key={account.id}
        onMouseDown={() => {
         onChange(account.id);
         setQuery('');
         setOpen(false);
        }}
        className={`cursor-pointer px-3 py-2 hover:bg-accent-weak ${value === account.id ? 'bg-accent-weak font-medium text-accent' : 'text-fg'}`}
       >
        {account.clientName} · {account.currencyCode}
       </li>
      ))
     )}
    </ul>
   ) : null}
  </div>
 );
}
