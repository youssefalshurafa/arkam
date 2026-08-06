import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type DragHalf = 'top' | 'bottom';

type UsePointerDragOptions<K> = {
 /** Reads the drag key back off a `[data-drag-key]` element's attribute value. */
 parseKey: (raw: string) => K;
 /** Fired once at the start of a drag (pointerdown on the handle) — typically used to drive the "being dragged" style on the source row. */
 onDragStart?: (draggedKey: K) => void;
 /** Fired on every pointer move while dragging, with the currently hovered key/half (or both null when over nothing draggable). */
 onHoverChange: (overKey: K | null, half: DragHalf | null) => void;
 /**
  * Fired on every pointer move while dragging, with the raw viewport coordinates and whatever
  * element sits under the pointer (the same lookup `updateHover` already does, reused rather
  * than calling `elementFromPoint` twice). For consumers that need something `onHoverChange`
  * can't express — e.g. "the pointer is over the table's header, not a droppable row" — which
  * `[data-drag-key]` hit-testing alone can't distinguish from "over nothing."
  */
 onPointerMove?: (clientX: number, clientY: number, elementUnderPointer: Element | null) => void;
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
 * touch, and pen.
 *
 * Move/up/cancel are tracked via `window`-level listeners (attached at drag-start, torn down at
 * drag-end) rather than React props on the drag handle itself, and pointer capture is taken on
 * `document.body` rather than the handle (`event.currentTarget`) — both deliberately, so the
 * gesture survives the handle's own row being unmounted mid-drag. That happens whenever a
 * consumer's `onHoverChange`/`onPointerMove` triggers a re-render that removes the dragged row
 * from the DOM entirely (e.g. the ledger's drag-into-header-to-page-back gesture, which changes
 * which page's rows are rendered while a row from the OLD page is still being dragged) — losing
 * pointer capture on a now-removed element fires an implicit `pointercancel` and silently ends
 * the drag with nothing dropped, which is exactly the bug this avoids. `document.body` and
 * `window` never unmount, so capture and the listeners keep working regardless of what the
 * consumer's table does mid-drag.
 *
 * Usage: spread `dragHandleProps(key)` onto the drag handle element, put `data-drag-key={key}`
 * on each element that can be dropped onto (usually the row/column itself), and render
 * `{dragGhost}` once anywhere in the tree if `renderGhost` is passed.
 */
export function usePointerDrag<K>({ parseKey, onDragStart, onHoverChange, onPointerMove, onDrop, axis = 'vertical', attr = 'data-drag-key', renderGhost }: UsePointerDragOptions<K>) {
 const draggedKeyRef = useRef<K | null>(null);
 const overRef = useRef<{ key: K; half: DragHalf | null } | null>(null);
 const ghostRef = useRef<HTMLDivElement | null>(null);
 const [ghostContent, setGhostContent] = useState<ReactNode>(null);
 const activePointerIdRef = useRef<number | null>(null);

 const positionGhost = (clientX: number, clientY: number) => {
  const el = ghostRef.current;
  if (!el) return;
  el.style.transform = `translate(${clientX + 14}px, ${clientY + 14}px)`;
 };

 const updateHover = (clientX: number, clientY: number) => {
  const el = document.elementFromPoint(clientX, clientY);
  onPointerMove?.(clientX, clientY, el);
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

 const endDrag = () => {
  const draggedKey = draggedKeyRef.current;
  if (draggedKey == null) return;
  draggedKeyRef.current = null;
  setGhostContent(null);
  window.removeEventListener('pointermove', stableMoveHandler.current);
  window.removeEventListener('pointerup', stableUpHandler.current);
  window.removeEventListener('pointercancel', stableUpHandler.current);
  if (activePointerIdRef.current != null) {
   try {
    document.body.releasePointerCapture(activePointerIdRef.current);
   } catch {
    /* already released — e.g. the browser released it implicitly when some element was removed */
   }
   activePointerIdRef.current = null;
  }
  const over = overRef.current;
  overRef.current = null;
  onDrop(draggedKey, over?.key ?? null, over?.half ?? null);
 };

 // Stable (never-recreated) function identities for addEventListener/removeEventListener to
 // share — they're attached once at drag-start and must go on working for the whole drag no
 // matter how many times the component re-renders (and redefines updateHover/positionGhost/
 // endDrag with fresh closures) before the drag ends. latestX refs are updated every render so
 // these stable wrappers still always call this render's actual logic.
 const latestUpdateHover = useRef(updateHover);
 const latestPositionGhost = useRef(positionGhost);
 const latestEndDrag = useRef(endDrag);
 useEffect(() => {
  latestUpdateHover.current = updateHover;
  latestPositionGhost.current = positionGhost;
  latestEndDrag.current = endDrag;
 });

 const stableMoveHandler = useRef((event: PointerEvent) => {
  if (draggedKeyRef.current == null) return;
  latestUpdateHover.current(event.clientX, event.clientY);
  latestPositionGhost.current(event.clientX, event.clientY);
 });
 const stableUpHandler = useRef(() => latestEndDrag.current());

 const dragHandleProps = (key: K) => ({
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
   // Primary button only (touch/pen contacts report button -1, which is fine).
   if (event.pointerType === 'mouse' && event.button !== 0) return;
   draggedKeyRef.current = key;
   overRef.current = null;
   activePointerIdRef.current = event.pointerId;
   try {
    document.body.setPointerCapture(event.pointerId);
   } catch {
    /* not supported in this environment; the drag still works via the window listeners below */
   }
   window.addEventListener('pointermove', stableMoveHandler.current);
   window.addEventListener('pointerup', stableUpHandler.current);
   window.addEventListener('pointercancel', stableUpHandler.current);
   onDragStart?.(key);
   if (renderGhost) {
    setGhostContent(renderGhost(key));
    positionGhost(event.clientX, event.clientY);
   }
  },
  // Prevents the browser's touch-scroll gesture from hijacking a touch-and-drag on this handle
  // — evaluated once at touch-start, so it holds for the whole gesture regardless of which
  // element pointer capture later moves to or which elements the finger passes over.
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
