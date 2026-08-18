'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { normalizePlainDecimalInput } from '@/shared/utils/decimal';
import { seamlessInputClassName } from '@/shared/styles';

// A click-to-edit value: plain text until clicked, then an underlined (never boxed) input
// in place, seamless with its surroundings. Commits on blur/Enter, discards on Escape or
// when the input is left unchanged from `editValue`. Shared by TransactionDetailsModal's
// "More info" popup and the Archive table's inline "more info" column — anywhere a single
// field needs its own auto-commit edit without a surrounding row/form entering edit mode.
export default function EditableField({
 display,
 editValue,
 align = 'right',
 decimal = false,
 placeholder,
 // Extra classes appended to both the display button and the edit input — e.g. `block
 // w-full truncate` for a table cell that must stay single-line instead of the default
 // wrap-to-fit behavior (fine in a roomy modal row, not in a dense table column).
 className = '',
 onCommit,
}: {
 display: ReactNode;
 editValue: string;
 align?: 'left' | 'right';
 decimal?: boolean;
 placeholder?: string;
 className?: string;
 onCommit: (raw: string) => void;
}) {
 const [editing, setEditing] = useState(false);
 const [draft, setDraft] = useState(editValue);
 const alignCls = align === 'right' ? 'text-right' : 'text-left';

 if (!editing) {
  return (
   <button
    type="button"
    onClick={() => {
     setDraft(editValue);
     setEditing(true);
    }}
    className={`-mx-1 min-w-0 break-words rounded-sm px-1 text-sm font-medium text-fg outline-none transition hover:bg-surface-hover ${alignCls} ${className}`}
   >
    {display}
   </button>
  );
 }

 const commit = () => {
  setEditing(false);
  if (draft !== editValue) onCommit(draft);
 };

 return (
  <input
   autoFocus
   type="text"
   inputMode={decimal ? 'decimal' : undefined}
   dir={decimal ? 'ltr' : undefined}
   value={draft}
   placeholder={placeholder}
   onChange={(e) => setDraft(decimal ? normalizePlainDecimalInput(e.target.value) : e.target.value)}
   onBlur={commit}
   onKeyDown={(e) => {
    if (e.key === 'Enter') {
     e.preventDefault();
     commit();
    } else if (e.key === 'Escape') {
     setDraft(editValue);
     setEditing(false);
    }
   }}
   className={`${seamlessInputClassName} max-w-full text-sm text-fg ${alignCls} ${className}`}
  />
 );
}
