'use client';

import { useState } from 'react';
import type { ChangeEvent, CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';

type DescriptionSuggestFieldProps = {
 as?: 'input' | 'textarea';
 value: string;
 onChange: (value: string) => void;
 suggestions: string[];
 onExcludeSuggestion: (desc: string) => void;
 removeSuggestionLabel: string;
 className: string;
 style?: CSSProperties;
 placeholder?: string;
 rows?: number;
 autoFocus?: boolean;
 // For a caller managing several of these at once (e.g. one per table row) where only one
 // useDescriptionSuggestions() call is shared across all of them (hooks can't be called inside
 // a .map()) — lets the caller know which instance is currently focused, so it can compute
 // `suggestions` for that one only and pass an empty list to the rest.
 onFocus?: () => void;
};

/**
 * A description input/textarea with a past-descriptions suggestion dropdown — the ranked list
 * itself comes from useDescriptionSuggestions; this component only owns the open/highlight UI
 * state and the keyboard/mouse interaction (↑/↓ to move, Enter/click to pick, Escape/blur to
 * dismiss, a per-suggestion "x" to exclude it going forward). Shared by every description field
 * in the app so they all behave identically.
 */
export function DescriptionSuggestField({
 as = 'input',
 value,
 onChange,
 suggestions,
 onExcludeSuggestion,
 removeSuggestionLabel,
 className,
 style,
 placeholder,
 rows,
 autoFocus,
 onFocus,
}: DescriptionSuggestFieldProps) {
 const [open, setOpen] = useState(false);
 const [highlight, setHighlight] = useState(0);

 const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
  onChange(event.target.value);
  setOpen(true);
  setHighlight(0);
 };

 const handleFocus = () => {
  setOpen(true);
  setHighlight(0);
  onFocus?.();
 };

 // The delay lets a suggestion's onMouseDown (which fires before blur's click) still register
 // before the list unmounts out from under it.
 const handleBlur = () => setTimeout(() => setOpen(false), 150);

 const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
  if (!open || suggestions.length === 0) return;
  if (event.key === 'ArrowDown') {
   event.preventDefault();
   setHighlight((h) => (h + 1) % suggestions.length);
  } else if (event.key === 'ArrowUp') {
   event.preventDefault();
   setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
  } else if (event.key === 'Enter') {
   const desc = suggestions[highlight];
   if (!desc) return;
   // Also stop propagation — an Enter that's selecting a suggestion must not additionally
   // trigger a parent row/form's own "Enter saves" handler.
   event.preventDefault();
   event.stopPropagation();
   onChange(desc);
   setOpen(false);
  } else if (event.key === 'Escape') {
   setOpen(false);
  }
 };

 const selectSuggestion = (desc: string) => {
  onChange(desc);
  setOpen(false);
 };

 const sharedProps = {
  value,
  onChange: handleChange,
  onFocus: handleFocus,
  onBlur: handleBlur,
  onKeyDown: handleKeyDown,
  className,
  style,
  placeholder,
  autoFocus,
  autoComplete: 'off' as const,
 };

 return (
  <div className="relative">
   {as === 'textarea' ? <textarea {...sharedProps} rows={rows} /> : <input type="text" {...sharedProps} />}
   {open && suggestions.length > 0 ? (
    // min-w so this stays readable even when the field itself is narrow (e.g. a dense table's
    // inline row-edit input, sized to fit the column rather than a suggestion's full text) —
    // w-full still lets it match/exceed that width whenever the field itself is wider.
    <ul className="absolute z-20 mt-1 max-h-56 w-full min-w-64 overflow-y-auto rounded border border-border bg-surface shadow-lg">
     {suggestions.map((desc, index) => {
      const highlighted = index === highlight;
      const highlightRef = highlighted ? (el: HTMLLIElement | null) => el?.scrollIntoView({ block: 'nearest' }) : undefined;
      return (
       <li
        key={desc}
        ref={highlightRef}
        onMouseDown={() => selectSuggestion(desc)}
        onMouseEnter={() => setHighlight(index)}
        className={`group flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${highlighted ? 'bg-accent-weak text-fg' : 'text-fg-muted hover:bg-accent-weak'}`}
        title={desc}
       >
        <span className="flex-1 truncate">{desc}</span>
        <button
         type="button"
         onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onExcludeSuggestion(desc);
         }}
         title={removeSuggestionLabel}
         aria-label={removeSuggestionLabel}
         className="shrink-0 rounded p-0.5 text-fg-faint opacity-0 transition hover:bg-surface-hover hover:text-fg-muted group-hover:opacity-100"
        >
         <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 18L18 6M6 6l12 12" />
         </svg>
        </button>
       </li>
      );
     })}
    </ul>
   ) : null}
  </div>
 );
}
