'use client';

import { useEffect, useRef, type Dispatch, type MouseEvent, type PointerEvent, type SetStateAction } from 'react';

type SumDrag = {
 keys: string[]; // the group's sum keys in on-screen order, captured at press time
 rows: HTMLElement[]; // each key's <tr>, same order — what the pointer's Y is measured against
 anchor: number;
 current: number;
 adding: boolean; // pressing an unselected value paints "on"; pressing a selected one paints "off"
 base: Set<string>; // the selection before the drag — rows that leave the range revert to it
 lastY: number;
};

/**
 * Drag-to-select for the ledger's sum mode. Pressing a sum button and dragging over the rows
 * above/below it selects the whole contiguous range in that column, spreadsheet style: the range
 * is always anchor→pointer, so dragging back shrinks it again. Measured by the pointer's Y against
 * the rows rather than by which button is under it, so a fast drag can't skip rows and the pointer
 * may wander out of the column sideways.
 *
 * Mouse only. On touch, a drag that starts on a value must still scroll the ledger, so taps there
 * keep the plain one-at-a-time toggle (as does keyboard activation).
 *
 * Each button spreads `bind(sumKey, group)`; `group` is accountId:field, so a drag never crosses
 * into another column or another currency account's table.
 */
export function useLedgerSumDrag(selection: Set<string>, setSelection: Dispatch<SetStateAction<Set<string>>>, toggle: (key: string) => void) {
 const dragRef = useRef<SumDrag | null>(null);
 const lastPointerTypeRef = useRef('');
 const stopRef = useRef<(() => void) | null>(null);

 useEffect(() => () => stopRef.current?.(), []);

 const applyRange = (drag: SumDrag) => {
  const lo = Math.min(drag.anchor, drag.current);
  const hi = Math.max(drag.anchor, drag.current);
  const next = new Set(drag.base);
  for (let i = lo; i <= hi; i++) {
   if (drag.adding) next.add(drag.keys[i]);
   else next.delete(drag.keys[i]);
  }
  setSelection(next);
 };

 // The row under the pointer's Y; clamps to the first/last row when the pointer is beyond them.
 const indexAtY = (drag: SumDrag, y: number) => {
  let index = 0;
  for (let i = 0; i < drag.rows.length; i++) {
   if (!drag.rows[i].isConnected) continue;
   if (drag.rows[i].getBoundingClientRect().top <= y) index = i;
   else break;
  }
  return index;
 };

 const track = (y: number) => {
  const drag = dragRef.current;
  if (!drag) return;
  drag.lastY = y;
  const index = indexAtY(drag, y);
  if (index === drag.current) return;
  drag.current = index;
  applyRange(drag);
 };

 const onPointerDown = (event: PointerEvent<HTMLElement>, key: string, group: string) => {
  lastPointerTypeRef.current = event.pointerType;
  if (event.pointerType !== 'mouse' || event.button !== 0) return;
  event.preventDefault();

  const buttons = Array.from(document.querySelectorAll<HTMLElement>(`[data-sum-group="${CSS.escape(group)}"]`));
  const keys = buttons.map((el) => el.dataset.sumKey ?? '');
  const anchor = keys.indexOf(key);
  if (anchor < 0) return;

  stopRef.current?.();
  const drag: SumDrag = {
   keys,
   rows: buttons.map((el) => el.closest('tr') ?? el),
   anchor,
   current: anchor,
   adding: !selection.has(key),
   base: new Set(selection),
   lastY: event.clientY,
  };
  dragRef.current = drag;
  applyRange(drag);

  const onMove = (e: globalThis.PointerEvent) => track(e.clientY);
  // Wheel-scrolling mid-drag moves rows under a still pointer, so re-measure on scroll too.
  const onScroll = () => {
   if (dragRef.current) track(dragRef.current.lastY);
  };
  const previousUserSelect = document.body.style.userSelect;
  document.body.style.userSelect = 'none';
  const stop = () => {
   window.removeEventListener('pointermove', onMove);
   window.removeEventListener('pointerup', stop);
   window.removeEventListener('pointercancel', stop);
   window.removeEventListener('scroll', onScroll, true);
   document.body.style.userSelect = previousUserSelect;
   dragRef.current = null;
   stopRef.current = null;
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', stop);
  window.addEventListener('pointercancel', stop);
  window.addEventListener('scroll', onScroll, true);
  stopRef.current = stop;
 };

 // A mouse click was already handled on pointerdown; keyboard (detail 0) and touch toggle here.
 const onClick = (event: MouseEvent<HTMLElement>, key: string) => {
  if (event.detail !== 0 && lastPointerTypeRef.current === 'mouse') return;
  toggle(key);
 };

 const bind = (key: string, group: string) => ({
  'data-sum-key': key,
  'data-sum-group': group,
  onPointerDown: (event: PointerEvent<HTMLElement>) => onPointerDown(event, key, group),
  onClick: (event: MouseEvent<HTMLElement>) => onClick(event, key),
 });

 return { bind };
}
