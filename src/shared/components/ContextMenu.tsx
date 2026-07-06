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
 */
export function ContextMenu({ menu, onClose }: { menu: ReturnType<typeof useContextMenu>['menu']; onClose: () => void }) {
 const ref = useRef<HTMLDivElement>(null);
 const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

 useLayoutEffect(() => {
  if (!menu) {
   setPosition(null);
   return;
  }
  setPosition({ top: menu.y, left: menu.x });
 }, [menu]);

 useLayoutEffect(() => {
  if (!menu || !position || !ref.current) return;
  const rect = ref.current.getBoundingClientRect();
  const overflowX = rect.right - window.innerWidth;
  const overflowY = rect.bottom - window.innerHeight;
  if (overflowX > 0 || overflowY > 0) {
   setPosition((prev) =>
    prev
     ? {
        left: overflowX > 0 ? Math.max(4, prev.left - overflowX) : prev.left,
        top: overflowY > 0 ? Math.max(4, prev.top - overflowY) : prev.top,
       }
     : prev,
   );
  }
  // Only re-run when the menu itself changes; the position-adjust above must not retrigger this.
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

 if (!menu || !position) return null;

 return (
  <div
   ref={ref}
   style={{ position: 'fixed', top: position.top, left: position.left, zIndex: 200 }}
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
