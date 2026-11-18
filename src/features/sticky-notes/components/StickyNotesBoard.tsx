'use client';

import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { confirmDialog } from '@/components/ui/AppDialog';
import { panelClassName } from '@/shared/styles';
import type { StickyNote, StickyNoteColor } from '@/shared/types';
import { useStickyNotes } from '../hooks/useStickyNotes';

// Semantic token families, so every color reads correctly in dark mode too.
const COLOR_STYLES: Record<StickyNoteColor, { card: string; dot: string }> = {
 yellow: { card: 'bg-warn-bg border-warn/40', dot: 'bg-warn' },
 pink: { card: 'bg-bad-bg border-bad/40', dot: 'bg-bad' },
 blue: { card: 'bg-info-bg border-info/40', dot: 'bg-info' },
 green: { card: 'bg-good-bg border-good/40', dot: 'bg-good' },
 purple: { card: 'bg-violet-bg border-violet/40', dot: 'bg-violet' },
};
const COLORS = Object.keys(COLOR_STYLES) as StickyNoteColor[];

// How long typing has to pause before the note is saved.
const SAVE_DELAY_MS = 700;

type Translate = (key: string, params?: Record<string, string | number>) => string;

function NoteIcon({ className = 'h-4 w-4' }: { className?: string }) {
 return (
  <svg
   className={className}
   viewBox="0 0 24 24"
   fill="none"
   stroke="currentColor"
   strokeWidth="1.8"
   strokeLinecap="round"
   strokeLinejoin="round"
   aria-hidden
  >
   <path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9.5L21 14.5V5a2 2 0 0 0-2-2h-3.5Z" />
   <path d="M15 21v-5a1 1 0 0 1 1-1h5" />
  </svg>
 );
}

type StickyNoteCardProps = {
 note: StickyNote;
 readOnly: boolean;
 autoFocus: boolean;
 numLocale: string;
 t: Translate;
 onSave: (content: string) => void;
 onColor: (color: StickyNoteColor) => void;
 onDelete: () => void;
};

function StickyNoteCard({ note, readOnly, autoFocus, numLocale, t, onSave, onColor, onDelete }: StickyNoteCardProps) {
 const [draft, setDraft] = useState(note.content);
 const [focused, setFocused] = useState(false);
 // The cache value this card last saw, and the text it last sent. A cache change that is not
 // our own save landing is someone else's edit (or a failed save being rolled back), and is
 // adopted unless the user is typing in this very note.
 const [seen, setSeen] = useState(note.content);
 const [lastSent, setLastSent] = useState(note.content);
 if (note.content !== seen) {
  setSeen(note.content);
  if (!focused && note.content !== lastSent) setDraft(note.content);
 }

 const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
 const pendingRef = useRef<string | null>(null);
 const onSaveRef = useRef(onSave);
 useEffect(() => {
  onSaveRef.current = onSave;
 });
 // Leaving the page mid-pause must not drop the last few keystrokes.
 useEffect(() => {
  const timer = timerRef;
  const pending = pendingRef;
  const save = onSaveRef;
  return () => {
   if (timer.current) clearTimeout(timer.current);
   if (pending.current !== null) save.current(pending.current);
  };
 }, []);

 const flush = (value: string) => {
  if (timerRef.current) clearTimeout(timerRef.current);
  timerRef.current = null;
  pendingRef.current = null;
  if (value === lastSent) return;
  setLastSent(value);
  onSave(value);
 };

 const styles = COLOR_STYLES[note.color] ?? COLOR_STYLES.yellow;
 const updatedLabel = (() => {
  const date = new Date(note.updatedAt);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(numLocale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
 })();

 return (
  <div className={`group flex flex-col rounded-md border shadow-sm ${styles.card}`}>
   <textarea
    value={draft}
    readOnly={readOnly}
    autoFocus={autoFocus}
    dir="auto"
    rows={4}
    maxLength={2000}
    placeholder={readOnly ? '' : t('sticky_notes_placeholder')}
    onFocus={() => setFocused(true)}
    onChange={(event) => {
     const value = event.target.value;
     setDraft(value);
     pendingRef.current = value;
     if (timerRef.current) clearTimeout(timerRef.current);
     timerRef.current = setTimeout(() => flush(value), SAVE_DELAY_MS);
    }}
    onBlur={() => {
     setFocused(false);
     if (pendingRef.current !== null) flush(pendingRef.current);
     // Focused without typing while a teammate changed it: show their version now.
     else if (draft === lastSent && note.content !== draft) setDraft(note.content);
    }}
    className="field-sizing-content max-h-72 min-h-24 w-full resize-none bg-transparent px-3 pt-3 pb-1 text-sm whitespace-pre-wrap text-fg outline-none placeholder:text-fg-faint"
   />
   <div className="flex items-center justify-between gap-2 px-2 pb-1.5">
    <span className="truncate text-[11px] text-fg-faint">{updatedLabel}</span>
    {readOnly ? null : (
     <div className="flex shrink-0 items-center gap-1 opacity-70 transition group-focus-within:opacity-100 group-hover:opacity-100">
      {COLORS.map((color) => (
       <button
        key={color}
        type="button"
        onClick={() => {
         if (color !== note.color) onColor(color);
        }}
        title={t(`sticky_notes_color_${color}`)}
        aria-label={t(`sticky_notes_color_${color}`)}
        aria-pressed={color === note.color}
        className={`h-3.5 w-3.5 cursor-pointer rounded-full ${COLOR_STYLES[color].dot} ${color === note.color ? 'ring-2 ring-fg-muted ring-offset-1 ring-offset-surface' : ''}`}
       />
      ))}
      <button
       type="button"
       onClick={() => {
        // Blur already flushed any typing; a save queued for a note about to vanish would only
        // come back as a "no longer exists" error.
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
        pendingRef.current = null;
        onDelete();
       }}
       title={t('sticky_notes_delete')}
       aria-label={t('sticky_notes_delete')}
       className="ms-1 cursor-pointer rounded p-1 text-fg-muted transition hover:bg-surface-hover hover:text-bad-text"
      >
       <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
       >
        <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
       </svg>
      </button>
     </div>
    )}
   </div>
  </div>
 );
}

type StickyNotesBoardProps = {
 /** Home hides the whole board while there are no notes; Transactions always offers "add". */
 variant: 'transactions' | 'home';
 readOnly: boolean;
};

/**
 * Workspace-wide sticky notes. The same notes (and the same component) appear on the
 * Transactions page and on Home; every member sees them, and any non-viewer can edit them.
 */
export default function StickyNotesBoard({ variant, readOnly }: StickyNotesBoardProps) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const numLocale = language === 'fr' ? 'en-US' : language;
 const { notes, isLoading, addNote, updateNote, removeNote } = useStickyNotes(t('sticky_notes_save_failed'));
 const [focusId, setFocusId] = useState<number | null>(null);
 const [isAdding, setIsAdding] = useState(false);

 if (isLoading) return null;
 if (notes.length === 0 && (variant === 'home' || readOnly)) return null;

 const onAdd = async () => {
  if (isAdding) return;
  setIsAdding(true);
  // Rotate colors so neighbouring notes are easy to tell apart.
  const color = COLORS[notes.length % COLORS.length];
  const note = await addNote(color);
  setIsAdding(false);
  if (note) setFocusId(note.id);
 };

 const onDelete = async (note: StickyNote) => {
  if (note.content.trim() && !(await confirmDialog({ message: t('sticky_notes_delete_confirm'), tone: 'danger' }))) return;
  void removeNote(note.id);
 };

 if (notes.length === 0) {
  return (
   <button
    type="button"
    onClick={onAdd}
    disabled={isAdding}
    className="inline-flex w-fit cursor-pointer items-center gap-2 rounded border border-dashed border-border-strong px-3 py-1.5 text-sm text-fg-muted transition hover:bg-surface-hover hover:text-fg disabled:opacity-60"
   >
    <NoteIcon />
    {t('sticky_notes_add_first')}
   </button>
  );
 }

 return (
  <div className={panelClassName}>
   <div className="flex items-center justify-between gap-3">
    <div className="flex min-w-0 items-center gap-2">
     <NoteIcon className="h-5 w-5 shrink-0 text-fg-muted" />
     <h2 className="text-lg font-semibold">{t('sticky_notes_title')}</h2>
     <span className="truncate text-xs text-fg-faint">{t('sticky_notes_shared_hint')}</span>
    </div>
    {readOnly ? null : (
     <button
      type="button"
      onClick={onAdd}
      disabled={isAdding}
      className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded border border-border-strong bg-surface-2 px-3 py-1.5 text-sm font-semibold text-fg-muted transition hover:bg-surface-hover disabled:opacity-60"
     >
      <span aria-hidden>+</span>
      {t('sticky_notes_add')}
     </button>
    )}
   </div>
   <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
    {notes.map((note) => (
     <StickyNoteCard
      key={note.id}
      note={note}
      readOnly={readOnly}
      autoFocus={note.id === focusId}
      numLocale={numLocale}
      t={t}
      onSave={(content) => void updateNote(note.id, { content })}
      onColor={(color) => void updateNote(note.id, { color })}
      onDelete={() => void onDelete(note)}
     />
    ))}
   </div>
  </div>
 );
}
