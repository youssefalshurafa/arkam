'use client';

import { useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react';

const LONG_PRESS_MS = 500;
// How far (px) a touch may drift before it's treated as a scroll/swipe instead of a hold.
const MOVE_CANCEL_PX = 10;

/**
 * iOS Safari never reliably fires the native `contextmenu` event from a touch-and-hold (unlike
 * Android Chrome, which does) — so any row menu that only opens via onContextMenu/right-click is
 * effectively unreachable by long-press on iPhone. This replicates long-press-to-contextmenu from
 * raw touch events: `bind(onLongPress)` returns touch handlers for one element; after a hold with
 * the finger kept still (a scroll/swipe cancels it), `onLongPress` fires with a MouseEvent-shaped
 * object at the touch point, exactly like a real onContextMenu handler would receive. Call
 * `consumeLongPress()` at the top of that same element's onClick and bail out if it returns true,
 * so the synthetic tap-to-click that follows touchend doesn't also fire (mirrors the existing
 * justDraggedRef pattern used to swallow the click synthesized at the end of a drag).
 *
 * One instance is meant to be shared across every row in a table (call `useLongPress()` once at
 * the component's top level, then `bind(...)` per row inside the render loop) rather than one
 * hook call per row — only one row can be touched at a time, and hooks can't be called inside a
 * `.map()` anyway.
 */
export function useLongPress() {
 const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
 const startRef = useRef<{ x: number; y: number } | null>(null);
 const firedRef = useRef(false);

 const clearTimer = () => {
  if (timerRef.current) clearTimeout(timerRef.current);
  timerRef.current = null;
  startRef.current = null;
 };

 function bind(onLongPress: (event: ReactMouseEvent) => void) {
  return {
   onTouchStart: (event: ReactTouchEvent) => {
    clearTimer();
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    startRef.current = { x: touch.clientX, y: touch.clientY };
    timerRef.current = setTimeout(() => {
     firedRef.current = true;
     onLongPress({ preventDefault: () => {}, clientX: touch.clientX, clientY: touch.clientY } as unknown as ReactMouseEvent);
    }, LONG_PRESS_MS);
   },
   onTouchMove: (event: ReactTouchEvent) => {
    const start = startRef.current;
    const touch = event.touches[0];
    if (!start || !touch) return;
    if (Math.abs(touch.clientX - start.x) > MOVE_CANCEL_PX || Math.abs(touch.clientY - start.y) > MOVE_CANCEL_PX) clearTimer();
   },
   onTouchEnd: clearTimer,
   onTouchCancel: clearTimer,
  };
 }

 function consumeLongPress(): boolean {
  if (!firedRef.current) return false;
  firedRef.current = false;
  return true;
 }

 return { bind, consumeLongPress };
}
