'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';

export type ContextMenuAction = {
 key: string;
 label: string;
 icon?: ReactNode;
 onSelect: () => void;
 tone?: 'default' | 'danger' | 'success';
 disabled?: boolean;
};

/**
 * A collapsible sub-list inside the menu: one toggle row, closed every time the menu opens,
 * that expands its actions in place (indented under it) instead of opening a flyout — flyouts
 * don't survive touch, and the row menu is opened by tap on phones. One level deep only.
 */
export type ContextMenuGroup = {
 key: string;
 label: string;
 icon?: ReactNode;
 items: ContextMenuAction[];
};

export type ContextMenuItem = ContextMenuAction | ContextMenuGroup;

const isContextMenuGroup = (item: ContextMenuItem): item is ContextMenuGroup => 'items' in item;

type ContextMenuState = { x: number; y: number; items: ContextMenuItem[] } | null;

const NO_EXPANDED_GROUPS: ReadonlySet<string> = new Set();

/**
 * Manages one right-click context menu's open/closed state. `open` is meant to be wired to
 * a row's onContextMenu handler: it prevents the native browser menu and positions the
 * custom one at the click point.
 */
export function useContextMenu() {
 const [menu, setMenu] = useState<ContextMenuState>(null);
 const open = (event: MouseEvent, items: ContextMenuItem[]) => {
  event.preventDefault();
  setMenu({ x: event.clientX, y: event.clientY, items });
 };
 const close = () => setMenu(null);
 return { menu, open, close };
}

const toneClassName: Record<NonNullable<ContextMenuAction['tone']>, string> = {
 default: 'text-fg-muted',
 danger: 'text-bad-text',
 success: 'text-good-text',
};

/**
 * Renders the active context menu (if any) as a fixed-position dropdown at the click point,
 * clamped so it never overflows the viewport. Closes on outside click, Escape, or scroll —
 * mount once per table/page, shared by every row via the same useContextMenu() state.
 *
 * `zoom` matches the table's own CSS zoom level (TableZoomControl) — the menu lives outside
 * the zoomed table's DOM subtree (it's mounted once at the section root, not per-row), so it
 * doesn't inherit that zoom automatically and would otherwise stay full-size while the table
 * around it shrinks. Defaults to 1 for callers that don't zoom their table.
 */
export function ContextMenu({ menu, onClose, zoom = 1 }: { menu: ReturnType<typeof useContextMenu>['menu']; onClose: () => void; zoom?: number }) {
 const ref = useRef<HTMLDivElement>(null);
 // Which groups are expanded, remembered against the menu they were expanded in: a newly
 // opened menu is a different object, so every group starts closed again without an effect
 // having to reset this state.
 const [expanded, setExpanded] = useState<{ menu: ContextMenuState; keys: ReadonlySet<string> }>({ menu: null, keys: NO_EXPANDED_GROUPS });
 const expandedKeys = expanded.menu === menu ? expanded.keys : NO_EXPANDED_GROUPS;
 const toggleGroup = (key: string) => {
  const next = new Set(expandedKeys);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  setExpanded({ menu, keys: next });
 };

 // Places the menu at the raw click point (via the inline style below), then — before the
 // browser paints — clamps it to the viewport by mutating the DOM directly rather than
 // going through setState. The clamp amount depends on the mounted menu's actual rendered
 // size, which is only known once it exists; a setState-based version needs a second effect
 // to react to that mount, and two effects feeding each other's state is exactly the
 // cascading-render pattern React's rules flag. Direct style mutation sidesteps that
 // entirely and still never flashes the unclamped position, since layout effects run
 // synchronously before paint.
 useLayoutEffect(() => {
  const node = ref.current;
  if (!menu || !node) return;
  const rect = node.getBoundingClientRect();
  // menu.x/menu.y are real viewport coordinates (from the pointer), but CSS `zoom` on this
  // node also scales its `left`/`top` offsets — the rendered position ends up at
  // left*zoom / top*zoom. Divide by zoom so the menu's top-left lands exactly on the touch
  // point. rect.width/height are already the on-screen (post-zoom) size, so the viewport
  // clamp below is computed in real px, then converted back to the pre-zoom style value.
  const left = Math.max(4, Math.min(menu.x, window.innerWidth - rect.width - 4));
  const top = Math.max(4, Math.min(menu.y, window.innerHeight - rect.height - 4));
  node.style.left = `${left / zoom}px`;
  node.style.top = `${top / zoom}px`;
  // expandedKeys: an expanded group makes the menu taller, so it is clamped again.
 }, [menu, zoom, expandedKeys]);

 useEffect(() => {
  if (!menu) return;
  const handlePointerDown = (event: globalThis.MouseEvent) => {
   if (ref.current && !ref.current.contains(event.target as Node)) onClose();
  };
  const handleKeyDown = (event: KeyboardEvent) => {
   if (event.key === 'Escape') onClose();
  };
  const handleDismiss = () => onClose();
  window.addEventListener('mousedown', handlePointerDown);
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('scroll', handleDismiss, true);
  window.addEventListener('resize', handleDismiss);
  return () => {
   window.removeEventListener('mousedown', handlePointerDown);
   window.removeEventListener('keydown', handleKeyDown);
   window.removeEventListener('scroll', handleDismiss, true);
   window.removeEventListener('resize', handleDismiss);
  };
 }, [menu, onClose]);

 if (!menu) return null;

 const renderAction = (item: ContextMenuAction, nested = false) => (
  <button
   key={item.key}
   type="button"
   role="menuitem"
   disabled={item.disabled}
   onClick={() => {
    onClose();
    item.onSelect();
   }}
   className={`flex w-full items-center gap-2 py-2 text-left text-sm hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40 ${nested ? 'ps-7 pe-3' : 'px-3'} ${toneClassName[item.tone ?? 'default']}`}
  >
   {item.icon && <span className="flex shrink-0">{item.icon}</span>}
   {item.label}
  </button>
 );

 const lastIndex = menu.items.length - 1;
 return (
  <div
   ref={ref}
   style={{ position: 'fixed', top: menu.y / zoom, left: menu.x / zoom, zIndex: 200, zoom }}
   role="menu"
   className="min-w-[11rem] overflow-hidden rounded border border-border bg-surface py-1 shadow-xl"
  >
   {menu.items.map((item, index) => {
    if (!isContextMenuGroup(item)) return renderAction(item);
    const isOpen = expandedKeys.has(item.key);
    // Ruled off from the plain actions around it so it reads as its own block.
    const dividers = `${index > 0 ? 'mt-1 border-t' : ''} ${index < lastIndex ? 'mb-1 border-b' : ''} border-border`;
    return (
     <div key={item.key} role="group" className={dividers}>
      <button
       type="button"
       aria-expanded={isOpen}
       onClick={() => toggleGroup(item.key)}
       className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-fg hover:bg-surface-hover"
      >
       {item.icon && <span className="flex shrink-0">{item.icon}</span>}
       <span className="flex-1">{item.label}</span>
       <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className={`shrink-0 text-fg-faint transition-transform ${isOpen ? 'rotate-180' : ''}`}
       >
        <polyline points="6 9 12 15 18 9" />
       </svg>
      </button>
      {isOpen ? <div className="bg-surface-2 pb-1">{item.items.map((action) => renderAction(action, true))}</div> : null}
     </div>
    );
   })}
  </div>
 );
}
