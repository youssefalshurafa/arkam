'use client';

import { useId, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { parseAmountQuery, sameSearchTag, type SearchTag } from '@/features/transactions/utils/searchTags';

const MAX_CLIENT_SUGGESTIONS = 6;

/**
 * Collapsible "Advanced search" block inside the Transactions/Archive filter panel. One smart
 * input turns what's typed into candidate tags: matching client names, an amount (exact,
 * range, or bound) when the text parses as one, matching currency codes, and always a
 * "description contains" fallback. Enter adds the highlighted candidate. Every tag must
 * match (see rowMatchesSearchTags), so two client tags find the transactions between them.
 */
export function AdvancedSearchTags({ tags, onTagsChange, clientOptions, currencyOptions }: {
 tags: SearchTag[];
 onTagsChange: (tags: SearchTag[]) => void;
 clientOptions: string[];
 currencyOptions: string[];
}) {
 const { language, isRTL } = useLanguage();
 const { t } = useTranslation(language);
 const [open, setOpen] = useState(false);
 const [query, setQuery] = useState('');
 const [menuOpen, setMenuOpen] = useState(false);
 const [highlight, setHighlight] = useState(0);
 const listboxId = useId();

 const suggestions = useMemo<SearchTag[]>(() => {
  const q = query.trim();
  if (!q) return [];
  const lower = q.toLowerCase();
  const out: SearchTag[] = [];
  const amount = parseAmountQuery(q) ? [{ kind: 'amount' as const, value: q.replace(/[,\s]/g, '') }] : [];
  const clients = clientOptions
   .filter((name) => name.toLowerCase().includes(lower))
   // Names that start with the query are almost always the one meant — rank them first.
   .sort((a, b) => Number(!a.toLowerCase().startsWith(lower)) - Number(!b.toLowerCase().startsWith(lower)))
   .slice(0, MAX_CLIENT_SUGGESTIONS)
   .map((name) => ({ kind: 'client' as const, value: name }));
  const currencies = currencyOptions.filter((code) => code.toLowerCase().startsWith(lower)).map((code) => ({ kind: 'currency' as const, value: code }));
  // A number is far more likely an amount than part of a client name, so lead with it.
  out.push(...amount, ...clients, ...currencies, { kind: 'description', value: q });
  return out.filter((candidate) => !tags.some((tag) => sameSearchTag(tag, candidate)));
 }, [query, clientOptions, currencyOptions, tags]);

 const addTag = (tag: SearchTag) => {
  onTagsChange([...tags, tag]);
  setQuery('');
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
  } else if (e.key === 'Backspace' && !query && tags.length) {
   removeTag(tags.length - 1);
  }
 };

 const tagLabel = (tag: SearchTag) => t(`tx_adv_kind_${tag.kind}`);

 return (
  <div className="border-t border-border">
   <button
    type="button"
    onClick={() => setOpen((o) => !o)}
    aria-expanded={open}
    className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold text-fg-muted transition hover:bg-surface-hover"
   >
    {t('tx_adv_toggle')}
    {tags.length > 0 && <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-xs font-semibold leading-none text-white">{tags.length}</span>}
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
     className={`ml-auto transition-transform ${open ? 'rotate-180' : ''}`}
    >
     <path d="M6 9l6 6 6-6" />
    </svg>
   </button>
   {open && (
    <div className="flex flex-col gap-2 px-3 pb-3">
     <div className="flex flex-wrap items-center gap-1.5 rounded border border-border-strong bg-surface px-2 py-1.5 ring-blue-300 focus-within:ring">
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
      <div className="relative min-w-40 flex-1">
       <input
        type="text"
        value={query}
        onChange={(e) => {
         setQuery(e.target.value);
         setMenuOpen(true);
         setHighlight(0);
        }}
        onFocus={() => setMenuOpen(true)}
        onBlur={() => setMenuOpen(false)}
        onKeyDown={onKeyDown}
        placeholder={tags.length ? t('tx_adv_placeholder_more') : t('tx_adv_placeholder')}
        role="combobox"
        aria-controls={listboxId}
        aria-expanded={menuOpen && suggestions.length > 0}
        aria-autocomplete="list"
        className="w-full bg-transparent py-0.5 text-sm outline-none"
       />
       {menuOpen && suggestions.length > 0 && (
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
      </div>
     </div>
     <div className="flex flex-wrap items-center gap-2">
      <p className="text-xs text-fg-faint">
       {t('tx_adv_hint')}{' '}
       {/* LTR-isolated: in Arabic the < and > would otherwise be bidi-mirrored and read backwards. */}
       <span dir="ltr" className="font-mono">500 · 100-500 · &gt;500 · &lt;500</span>
      </p>
      {tags.length > 0 && (
       <button
        type="button"
        onClick={() => onTagsChange([])}
        className="ms-auto rounded border border-border-strong bg-surface px-2 py-1 text-xs text-fg-muted transition hover:bg-surface-hover"
       >
        {t('tx_adv_clear')}
       </button>
      )}
     </div>
    </div>
   )}
  </div>
 );
}
