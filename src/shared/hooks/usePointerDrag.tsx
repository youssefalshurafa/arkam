import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type DragHalf = 'top' | 'bottom';

type UsePointerDragOptions<K> = {
 /** Reads the drag key back off a `[data-drag-key]` element's attribute value. */
 parseKey: (raw: string) => K;
 /** Fired once at the start of a drag (pointerdown on the handle) — typically used to drive the "being dragged" style on the source row. */
 onDragStart?: (draggedKey: K) => void;
 /** Fired on every pointer move while dragging, with the currently hovered key/half (or both null when over nothing draggable). */
 onHoverChange: (overKey: K | null, half: DragHalf | null) => void;
 /** Fired once when the pointer is released, with whatever was last reported to onHoverChange. */
 onDrop: (draggedKey: K, overKey: K | null, half: DragHalf | null) => void;
 /**
  * Vertical: split hover targets into top/bottom halves (row reordering).
  * None: no half is computed (column reordering, where the drop handler only cares about the target's index).
  */
 axis?: 'vertical' | 'none';
 /** Attribute carrying the key on droppable elements. Defaults to 'data-drag-key'. */
 attr?: string;
 /**
  * Renders a small label describing what's being dragged (e.g. "12,000 USD" for a row, or a
  * column's header text). Shown in a floating badge that follows the pointer for the rest of
  * the drag — without this, the only feedback was the source dimming in place, which on a touch
  * screen is hidden under the finger doing the dragging. Its position is updated by directly
  * mutating the DOM (not React state) so dragging a big table doesn't re-render on every pixel
  * of pointer movement.
  */
 renderGhost?: (key: K) => ReactNode;
};

/**
 * Pointer-events-based drag-to-reorder, replacing HTML5 native drag-and-drop (`draggable`/
 * `onDragStart`/`onDragOver`/`onDrop`) which never fires from a touch gesture on mobile browsers
 * — the underlying reason drag-and-drop was unusable on phones. Pointer events unify mouse,
 * touch, and pen, and `setPointerCapture` keeps every subsequent move/up event routed to the
 * handle that started the drag regardless of where the finger/cursor travels, so a single
 * pointerdown on a drag handle is enough to drive the whole gesture — no separate "did this
 * start on the handle" tracking needed like the old `draggable` row + ref-guarded onDragStart
 * required.
 *
 * Usage: spread `dragHandleProps(key)` onto the drag handle element, put `data-drag-key={key}`
 * on each element that can be dropped onto (usually the row/column itself), and render
 * `{dragGhost}` once anywhere in the tree if `renderGhost` is passed.
 */
export function usePointerDrag<K>({ parseKey, onDragStart, onHoverChange, onDrop, axis = 'vertical', attr = 'data-drag-key', renderGhost }: UsePointerDragOptions<K>) {
 const draggedKeyRef = useRef<K | null>(null);
 const overRef = useRef<{ key: K; half: DragHalf | null } | null>(null);
 const ghostRef = useRef<HTMLDivElement | null>(null);
 const [ghostContent, setGhostContent] = useState<ReactNode>(null);

 const positionGhost = (clientX: number, clientY: number) => {
  const el = ghostRef.current;
  if (!el) return;
  el.style.transform = `translate(${clientX + 14}px, ${clientY + 14}px)`;
 };

 const updateHover = (clientX: number, clientY: number) => {
  const el = document.elementFromPoint(clientX, clientY);
  let target = (el as HTMLElement | null)?.closest(`[${attr}]`) as HTMLElement | null;

  // The pointer overshot past the top/bottom edge of the draggable list — e.g. a fast drag
  // landing below the last row, where elementFromPoint hits the table's padding/border or
  // whatever sits below it instead of a row. Left unhandled, that makes it impossible to ever
  // drop into the very first/last position (only "before the last row" is reachable). Fall back
  // to whichever draggable row is vertically closest to the pointer, among candidates roughly
  // under the cursor horizontally (so this doesn't jump across unrelated side-by-side lists).
  if (!target && axis === 'vertical') {
   let closest: HTMLElement | null = null;
   let closestDistance = Infinity;
   for (const candidate of document.querySelectorAll<HTMLElement>(`[${attr}]`)) {
    const rect = candidate.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right) continue;
    const distance = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
    if (distance < closestDistance) {
     closestDistance = distance;
     closest = candidate;
    }
   }
   target = closest;
  }

  const raw = target?.getAttribute(attr);
  if (!target || raw == null) {
   overRef.current = null;
   onHoverChange(null, null);
   return;
  }
  const key = parseKey(raw);
  let half: DragHalf | null = null;
  if (axis === 'vertical') {
   const rect = target.getBoundingClientRect();
   half = clientY < rect.top + rect.height / 2 ? 'top' : 'bottom';
  }
  overRef.current = { key, half };
  onHoverChange(key, half);
 };

 const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
  const draggedKey = draggedKeyRef.current;
  if (draggedKey == null) return;
  draggedKeyRef.current = null;
  setGhostContent(null);
  try {
   event.currentTarget.releasePointerCapture(event.pointerId);
  } catch {
   /* pointer capture already released (e.g. cancelled) */
  }
  const over = overRef.current;
  overRef.current = null;
  onDrop(draggedKey, over?.key ?? null, over?.half ?? null);
 };

 const dragHandleProps = (key: K) => ({
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
   // Primary button only (touch/pen contacts report button -1, which is fine).
   if (event.pointerType === 'mouse' && event.button !== 0) return;
   draggedKeyRef.current = key;
   overRef.current = null;
   event.currentTarget.setPointerCapture(event.pointerId);
   onDragStart?.(key);
   if (renderGhost) {
    setGhostContent(renderGhost(key));
    positionGhost(event.clientX, event.clientY);
   }
  },
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
   if (draggedKeyRef.current == null) return;
   updateHover(event.clientX, event.clientY);
   positionGhost(event.clientX, event.clientY);
  },
  onPointerUp: endDrag,
  onPointerCancel: endDrag,
  // Prevents the browser's touch-scroll gesture from hijacking a touch-and-drag on this handle.
  style: { touchAction: 'none' as const },
 });

 // pointer-events: none so this floating badge is never what elementFromPoint (in updateHover)
 // reports under the cursor — otherwise the ghost itself would shadow the real row/column below it.
 const dragGhost =
  ghostContent && typeof document !== 'undefined'
   ? createPortal(
      <div
       ref={ghostRef}
       className="pointer-events-none fixed left-0 top-0 z-[9999] max-w-xs truncate rounded border border-border-strong bg-surface px-2 py-1 text-xs font-semibold text-fg-muted shadow-lg"
      >
       {ghostContent}
      </div>,
      document.body,
     )
   : null;

 return { dragHandleProps, dragGhost };
}
