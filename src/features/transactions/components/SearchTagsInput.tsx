'use client';

import { useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { parseAmountQuery, sameSearchTag, type SearchTag, type SearchTagKind } from '@/features/transactions/utils/searchTags';

const MAX_CLIENT_SUGGESTIONS = 6;

/**
 * The filter bar's search box (Transactions, Archive, and the client ledger). What's typed
 * filters live as plain text (`text`, matched with the whole-word toggle), and also turns into
 * candidate chips: matching client names, an amount (exact, range, or bound) when the text
 * parses as one, matching currency codes, and always a "description contains" fallback. Enter
 * adds the highlighted candidate as a chip and clears the text; Backspace on an empty box
 * removes the last chip. The caller decides how chips combine (rowMatchesSearchTags /
 * ledgerEntryMatchesSearchTags).
 */
export function SearchTagsInput({ text, onTextChange, wholeWord, onWholeWordChange, tags, onTagsChange, clientOptions, currencyOptions, placeholder, hint, kindLabels }: {
 text: string;
 onTextChange: (text: string) => void;
 wholeWord: boolean;
 onWholeWordChange: (wholeWord: boolean) => void;
 tags: SearchTag[];
 onTagsChange: (tags: SearchTag[]) => void;
 clientOptions: string[];
 currencyOptions: string[];
 placeholder: string;
 // Shown in the dropdown while the box is focused and empty: how chips combine on this page.
 hint: string;
 // Per-page wording for a kind, e.g. the ledger calls a client chip "Counterparty".
 kindLabels?: Partial<Record<SearchTagKind, string>>;
}) {
 const { language, isRTL } = useLanguage();
 const { t } = useTranslation(language);
 const [menuOpen, setMenuOpen] = useState(false);
 const [highlight, setHighlight] = useState(0);
 const inputRef = useRef<HTMLInputElement | null>(null);
 const listboxId = useId();

 const suggestions = useMemo<SearchTag[]>(() => {
  const q = text.trim();
  if (!q) return [];
  const lower = q.toLowerCase();
  const amount = parseAmountQuery(q) ? [{ kind: 'amount' as const, value: q.replace(/[,\s]/g, '') }] : [];
  const clients = clientOptions
   .filter((name) => name.toLowerCase().includes(lower))
   // Names that start with the query are almost always the one meant — rank them first.
   .sort((a, b) => Number(!a.toLowerCase().startsWith(lower)) - Number(!b.toLowerCase().startsWith(lower)))
   .slice(0, MAX_CLIENT_SUGGESTIONS)
   .map((name) => ({ kind: 'client' as const, value: name }));
  const currencies = currencyOptions.filter((code) => code.toLowerCase().startsWith(lower)).map((code) => ({ kind: 'currency' as const, value: code }));
  // A number is far more likely an amount than part of a client name, so lead with it.
  const out: SearchTag[] = [...amount, ...clients, ...currencies, { kind: 'description', value: q }];
  return out.filter((candidate) => !tags.some((tag) => sameSearchTag(tag, candidate)));
 }, [text, clientOptions, currencyOptions, tags]);

 const addTag = (tag: SearchTag) => {
  onTagsChange([...tags, tag]);
  onTextChange('');
  setHighlight(0);
 };

 const removeTag = (index: number) => onTagsChange(tags.filter((_, i) => i !== index));

 const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key === 'ArrowDown' && suggestions.length) {
   e.preventDefault();
   setMenuOpen(true);
   setHighlight((h) => (h + 1) % suggestions.length);
  } else if (e.key === 'ArrowUp' && suggestions.length) {
   e.preventDefault();
   setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
  } else if (e.key === 'Enter') {
   e.preventDefault();
   const pick = suggestions[Math.min(highlight, suggestions.length - 1)];
   if (pick) addTag(pick);
  } else if (e.key === 'Escape') {
   setMenuOpen(false);
  } else if (e.key === 'Backspace' && !text && tags.length) {
   removeTag(tags.length - 1);
  }
 };

 const tagLabel = (tag: SearchTag) => kindLabels?.[tag.kind] ?? t(`tx_adv_kind_${tag.kind}`);
 const showSuggestions = menuOpen && suggestions.length > 0;
 const showHint = menuOpen && !text.trim();

 return (
  <div
   // A click on the box's padding or between chips should still land in the input.
   onMouseDown={(e) => {
    if (e.target === e.currentTarget) {
     e.preventDefault();
     inputRef.current?.focus();
    }
   }}
   className="flex min-h-8.5 flex-wrap items-center gap-1.5 rounded border border-border-strong bg-surface px-2 py-1 ring-blue-300 focus-within:ring"
  >
   {tags.map((tag, index) => (
    <span
     key={`${tag.kind}:${tag.value}`}
     className="inline-flex items-center gap-1 rounded-full border border-border-strong bg-surface-2 py-0.5 ps-2 pe-1 text-xs"
    >
     <span className="text-fg-faint">{tagLabel(tag)}:</span>
     <span
      className="font-semibold text-fg"
      dir="auto"
     >
      {tag.value}
     </span>
     <button
      type="button"
      onClick={() => removeTag(index)}
      aria-label={t('tx_adv_remove_tag')}
      title={t('tx_adv_remove_tag')}
      className="flex h-4 w-4 items-center justify-center rounded-full text-fg-faint hover:bg-surface-hover hover:text-fg-muted"
     >
      <svg
       width="10"
       height="10"
       viewBox="0 0 24 24"
       fill="none"
       stroke="currentColor"
       strokeWidth="2.5"
       strokeLinecap="round"
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
    </span>
   ))}
   <div className="relative min-w-32 flex-1">
    <input
     ref={inputRef}
     type="text"
     value={text}
     onChange={(e) => {
      onTextChange(e.target.value);
      setMenuOpen(true);
      setHighlight(0);
     }}
     onFocus={() => setMenuOpen(true)}
     onBlur={() => setMenuOpen(false)}
     onKeyDown={onKeyDown}
     placeholder={tags.length ? t('tx_adv_placeholder_more') : placeholder}
     role="combobox"
     aria-controls={listboxId}
     aria-expanded={showSuggestions}
     aria-autocomplete="list"
     className="w-full bg-transparent py-0.5 text-sm outline-none"
    />
    {showSuggestions && (
     <ul
      id={listboxId}
      role="listbox"
      className={`absolute top-full z-30 mt-2 max-h-64 w-72 max-w-[80vw] overflow-y-auto rounded border border-border-strong bg-surface py-1 shadow-lg ${isRTL ? 'right-0' : 'left-0'}`}
     >
      {suggestions.map((tag, index) => (
       <li
        key={`${tag.kind}:${tag.value}`}
        role="option"
        aria-selected={index === highlight}
        // mousedown, not click: the input's blur would close the menu before a click lands.
        onMouseDown={(e) => {
         e.preventDefault();
         addTag(tag);
        }}
        onMouseEnter={() => setHighlight(index)}
        className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm ${index === highlight ? 'bg-surface-hover' : ''}`}
       >
        <span className="w-20 shrink-0 text-xs text-fg-faint">{tagLabel(tag)}</span>
        <span
         className="truncate font-medium"
         dir="auto"
        >
         {tag.kind === 'description' ? t('tx_adv_contains', { text: tag.value }) : tag.value}
        </span>
       </li>
      ))}
     </ul>
    )}
    {showHint && (
     <div className={`absolute top-full z-30 mt-2 w-72 max-w-[80vw] rounded border border-border-strong bg-surface px-3 py-2 text-xs text-fg-faint shadow-lg ${isRTL ? 'right-0' : 'left-0'}`}>
      {hint}{' '}
      {/* LTR-isolated: in Arabic the < and > would otherwise be bidi-mirrored and read backwards. */}
      <span
       dir="ltr"
       className="font-mono"
      >
       500 · 100-500 · &gt;500 · &lt;500
      </span>
     </div>
    )}
   </div>
   <div className="flex shrink-0 items-center gap-0.5">
    <button
     type="button"
     onClick={() => onWholeWordChange(!wholeWord)}
     title={t('tx_filter_whole_word')}
     aria-label={t('tx_filter_whole_word')}
     aria-pressed={wholeWord}
     className={`flex h-5 w-6 items-center justify-center rounded text-[11px] font-semibold transition ${
      wholeWord ? 'bg-accent-weak text-accent ring-1 ring-inset ring-blue-400' : 'text-fg-faint hover:bg-surface-hover hover:text-fg-muted'
     }`}
    >
     <span className="border-b border-current leading-none">ab</span>
    </button>
    {text || tags.length > 0 ? (
     <button
      type="button"
      onClick={() => {
       onTextChange('');
       onTagsChange([]);
      }}
      title={t('clear_selection')}
      aria-label={t('clear_selection')}
      className="flex h-5 w-5 items-center justify-center rounded text-fg-faint hover:bg-surface-hover hover:text-fg-muted"
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
   </div>
  </div>
 );
}
