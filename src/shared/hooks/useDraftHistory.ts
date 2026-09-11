import { useCallback, useReducer, useRef } from 'react';

/** Undo/redo controls returned by useDraftHistory. */
export type DraftHistory = {
 record: () => void;
 undo: () => void;
 redo: () => void;
 reset: () => void;
 canUndo: boolean;
 canRedo: boolean;
};

/**
 * Bounded undo/redo history for an editable drafts map. `record()` snapshots the
 * current value (coalescing rapid edits into a 500ms burst); undo/redo swap in the
 * neighbouring snapshot via setDrafts.
 *
 * Takes a GETTER rather than the drafts value itself. The value was only ever written straight
 * into a ref — never read during render — but passing it in meant the caller had to subscribe to
 * it, and the caller is the page component. Drafts change on every keystroke in a ledger or
 * transaction-table cell, so that subscription re-rendered the entire page (and with it every
 * mounted section) once per character typed, to keep a ref current. Reading on demand instead
 * costs nothing and lets the caller drop the subscription entirely.
 */
export function useDraftHistory<T>(getDrafts: () => T, setDrafts: (value: T) => void): DraftHistory {
 const past = useRef<T[]>([]);
 const future = useRef<T[]>([]);
 const burstActive = useRef(false);
 const burstTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
 // Held in a ref so the callbacks below stay referentially stable even when the caller passes a
 // fresh closure each render.
 const getLatest = useRef(getDrafts);
 getLatest.current = getDrafts;
 const [, bump] = useReducer((x: number) => x + 1, 0);

 const record = useCallback(() => {
  if (!burstActive.current) {
   past.current = [...past.current, getLatest.current()].slice(-100);
   future.current = [];
   burstActive.current = true;
   bump();
  }
  if (burstTimer.current) clearTimeout(burstTimer.current);
  burstTimer.current = setTimeout(() => {
   burstActive.current = false;
  }, 500);
 }, []);

 const undo = useCallback(() => {
  if (past.current.length === 0) return;
  burstActive.current = false;
  if (burstTimer.current) clearTimeout(burstTimer.current);
  const prev = past.current[past.current.length - 1];
  past.current = past.current.slice(0, -1);
  future.current = [...future.current, getLatest.current()];
  setDrafts(prev);
  bump();
 }, [setDrafts]);

 const redo = useCallback(() => {
  if (future.current.length === 0) return;
  const next = future.current[future.current.length - 1];
  future.current = future.current.slice(0, -1);
  past.current = [...past.current, getLatest.current()];
  setDrafts(next);
  bump();
 }, [setDrafts]);

 const reset = useCallback(() => {
  past.current = [];
  future.current = [];
  burstActive.current = false;
  if (burstTimer.current) clearTimeout(burstTimer.current);
  bump();
 }, []);

 return { record, undo, redo, reset, canUndo: past.current.length > 0, canRedo: future.current.length > 0 };
}
