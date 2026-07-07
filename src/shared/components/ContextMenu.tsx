'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';

export type ContextMenuItem = {
 key: string;
 label: string;
 icon?: ReactNode;
 onSelect: () => void;
 tone?: 'default' | 'danger' | 'success';
 disabled?: boolean;
};

type ContextMenuState = { x: number; y: number; items: ContextMenuItem[] } | null;

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

const toneClassName: Record<NonNullable<ContextMenuItem['tone']>, string> = {
 default: 'text-slate-700',
 danger: 'text-red-600',
 success: 'text-emerald-600',
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
  const left = Math.max(4, Math.min(menu.x, window.innerWidth - rect.width - 4));
  const top = Math.max(4, Math.min(menu.y, window.innerHeight - rect.height - 4));
  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
 }, [menu]);

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

 return (
  <div
   ref={ref}
   style={{ position: 'fixed', top: menu.y, left: menu.x, zIndex: 200, zoom }}
   role="menu"
   className="min-w-[11rem] overflow-hidden rounded border border-slate-200 bg-white py-1 shadow-xl"
  >
   {menu.items.map((item) => (
    <button
     key={item.key}
     type="button"
     role="menuitem"
     disabled={item.disabled}
     onClick={() => {
      onClose();
      item.onSelect();
     }}
     className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 ${toneClassName[item.tone ?? 'default']}`}
    >
     {item.icon}
     {item.label}
    </button>
   ))}
  </div>
 );
}
