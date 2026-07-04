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
 * neighbouring snapshot via setDrafts. Ported verbatim from the page component.
 */
export function useDraftHistory<T>(drafts: T, setDrafts: (value: T) => void): DraftHistory {
 const past = useRef<T[]>([]);
 const future = useRef<T[]>([]);
 const burstActive = useRef(false);
 const burstTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
 const latest = useRef(drafts);
 latest.current = drafts;
 const [, bump] = useReducer((x: number) => x + 1, 0);

 const record = useCallback(() => {
  if (!burstActive.current) {
   past.current = [...past.current, latest.current].slice(-100);
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
  future.current = [...future.current, latest.current];
  setDrafts(prev);
  bump();
 }, [setDrafts]);

 const redo = useCallback(() => {
  if (future.current.length === 0) return;
  const next = future.current[future.current.length - 1];
  future.current = future.current.slice(0, -1);
  past.current = [...past.current, latest.current];
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
