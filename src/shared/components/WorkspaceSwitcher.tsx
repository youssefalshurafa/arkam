'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { renderIcon } from '@/shared/utils/icons';

type Workspace = { id: string; name: string; role: string };

const ROLE_LABEL_KEYS: Record<string, string> = {
 owner: 'team_role_owner',
 admin: 'team_role_admin',
 member: 'team_role_member',
 viewer: 'team_role_viewer',
};

function workspaceInitial(name: string) {
 return Array.from(name.trim())[0]?.toUpperCase() ?? '?';
}

type WorkspaceSwitcherProps = {
 workspaces: Workspace[];
 activeWorkspaceId: string | null;
 onSwitch: (id: string) => void;
 onManage: () => void;
 /**
  * sidebar — full-width row under the brand; the menu drops below it.
  * sidebar-collapsed — avatar-only button in the narrow sidebar; the menu opens beside it.
  * compact — avatar(+name from sm) in the mobile top bar; the menu drops below, end-aligned.
  */
 variant: 'sidebar' | 'sidebar-collapsed' | 'compact';
};

type MenuAnchor = { top: number; left: number; minWidth: number };

const MENU_WIDTH = 240;

/**
 * Shows the active workspace and lets the user jump to another one in two clicks. Switching
 * goes through the page's onSwitchWorkspace (stores the id, then reloads so every
 * workspace-scoped cache re-keys cleanly). Rendered only when the user belongs to 2+
 * workspaces — with one there is nothing to switch to.
 */
export default function WorkspaceSwitcher({ workspaces, activeWorkspaceId, onSwitch, onManage, variant }: WorkspaceSwitcherProps) {
 const { language, isRTL } = useLanguage();
 const { t } = useTranslation(language);
 const buttonRef = useRef<HTMLButtonElement>(null);
 const menuRef = useRef<HTMLDivElement>(null);
 const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
 const [switchingId, setSwitchingId] = useState<string | null>(null);

 const active = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
 const activeName = active?.name ?? t('workspace_label');

 const close = () => setAnchor(null);

 const open = () => {
  const rect = buttonRef.current?.getBoundingClientRect();
  if (!rect) return;
  if (variant === 'sidebar-collapsed') {
   setAnchor({ top: rect.top, left: isRTL ? rect.left - MENU_WIDTH - 8 : rect.right + 8, minWidth: MENU_WIDTH });
  } else if (variant === 'compact') {
   setAnchor({ top: rect.bottom + 6, left: isRTL ? rect.left : rect.right - MENU_WIDTH, minWidth: MENU_WIDTH });
  } else {
   setAnchor({ top: rect.bottom + 6, left: rect.left, minWidth: Math.max(rect.width, MENU_WIDTH) });
  }
 };

 // Clamp to the viewport and move focus to the active entry before paint. Mutates the node
 // directly (same reasoning as ContextMenu): the clamp needs the mounted menu's real size,
 // and feeding that back through setState would be a second, cascading render.
 useLayoutEffect(() => {
  const node = menuRef.current;
  if (!anchor || !node) return;
  const rect = node.getBoundingClientRect();
  node.style.left = `${Math.max(4, Math.min(anchor.left, window.innerWidth - rect.width - 4))}px`;
  node.style.top = `${Math.max(4, Math.min(anchor.top, window.innerHeight - rect.height - 4))}px`;
  const focusTarget = node.querySelector<HTMLButtonElement>('[aria-checked="true"]') ?? node.querySelector<HTMLButtonElement>('[role^="menuitem"]');
  focusTarget?.focus();
 }, [anchor]);

 useEffect(() => {
  if (!anchor) return;
  const handlePointerDown = (event: MouseEvent) => {
   const target = event.target as Node;
   if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
   setAnchor(null);
  };
  const handleKeyDown = (event: KeyboardEvent) => {
   if (event.key !== 'Escape') return;
   setAnchor(null);
   buttonRef.current?.focus();
  };
  const handleScroll = (event: Event) => {
   // A long workspace list scrolls inside the menu; only outside scrolls detach the anchor.
   if (menuRef.current?.contains(event.target as Node)) return;
   setAnchor(null);
  };
  const handleResize = () => setAnchor(null);
  window.addEventListener('mousedown', handlePointerDown);
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('scroll', handleScroll, true);
  window.addEventListener('resize', handleResize);
  return () => {
   window.removeEventListener('mousedown', handlePointerDown);
   window.removeEventListener('keydown', handleKeyDown);
   window.removeEventListener('scroll', handleScroll, true);
   window.removeEventListener('resize', handleResize);
  };
 }, [anchor]);

 const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
  event.preventDefault();
  const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? []);
  if (items.length === 0) return;
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  let next = current;
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = items.length - 1;
  else if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length;
  else next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
  items[next]?.focus();
 };

 const choose = (id: string) => {
  if (id === activeWorkspaceId) {
   close();
   return;
  }
  setSwitchingId(id);
  onSwitch(id);
 };

 const toggle = () => (anchor ? close() : open());
 const switchTitle = `${t('workspace_switch')} · ${activeName}`;

 let trigger;
 if (variant === 'sidebar') {
  trigger = (
   <button
    ref={buttonRef}
    type="button"
    onClick={toggle}
    aria-haspopup="menu"
    aria-expanded={Boolean(anchor)}
    title={switchTitle}
    className="flex w-full items-center gap-2 rounded-md border border-white/15 bg-white/5 px-2 py-1.5 text-start transition hover:bg-white/10"
   >
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-white/15 text-xs font-bold text-white">{workspaceInitial(activeName)}</span>
    <span className="min-w-0 flex-1">
     <span className="block text-[10px] font-semibold uppercase tracking-wide text-blue-300">{t('workspace_label')}</span>
     <span className="block truncate text-sm font-medium text-white">{activeName}</span>
    </span>
    <ChevronUpDown />
   </button>
  );
 } else if (variant === 'sidebar-collapsed') {
  trigger = (
   <button
    ref={buttonRef}
    type="button"
    onClick={toggle}
    aria-haspopup="menu"
    aria-expanded={Boolean(anchor)}
    aria-label={switchTitle}
    title={switchTitle}
    className="flex h-9 w-9 items-center justify-center rounded-md border border-white/20 bg-white/10 text-sm font-bold text-white transition hover:bg-white/20"
   >
    {workspaceInitial(activeName)}
   </button>
  );
 } else {
  trigger = (
   <button
    ref={buttonRef}
    type="button"
    onClick={toggle}
    aria-haspopup="menu"
    aria-expanded={Boolean(anchor)}
    aria-label={switchTitle}
    title={switchTitle}
    className="inline-flex max-w-40 items-center gap-1.5 rounded border border-white/20 px-1.5 py-1 text-xs text-blue-100 transition hover:bg-white/10 hover:text-white"
   >
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-white/15 text-[11px] font-bold text-white">{workspaceInitial(activeName)}</span>
    <span className="hidden truncate sm:inline">{activeName}</span>
    <ChevronUpDown />
   </button>
  );
 }

 return (
  <>
   {trigger}
   {anchor ? (
    <div
     ref={menuRef}
     role="menu"
     aria-label={t('workspace_switch')}
     onKeyDown={onMenuKeyDown}
     style={{ position: 'fixed', top: anchor.top, left: anchor.left, minWidth: anchor.minWidth, maxWidth: 320, zIndex: 200 }}
     className="overflow-hidden rounded-lg border border-border bg-surface text-fg shadow-xl"
    >
     <p className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">{t('workspace_switch')}</p>
     <div className="max-h-72 overflow-y-auto py-1">
      {workspaces.map((workspace) => {
       const isActive = workspace.id === activeWorkspaceId;
       const isSwitching = workspace.id === switchingId;
       return (
        <button
         key={workspace.id}
         type="button"
         role="menuitemradio"
         aria-checked={isActive}
         disabled={Boolean(switchingId)}
         onClick={() => choose(workspace.id)}
         className={`flex w-full items-center gap-2.5 px-3 py-2 text-start text-sm transition hover:bg-surface-hover focus:bg-surface-hover focus:outline-none disabled:cursor-wait ${
          isActive ? 'font-semibold text-fg' : 'text-fg-muted'
         }`}
        >
         <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded text-xs font-bold ${
           isActive ? 'bg-accent text-accent-contrast' : 'bg-accent-weak text-accent'
          }`}
         >
          {workspaceInitial(workspace.name)}
         </span>
         <span className="min-w-0 flex-1">
          <span className="block truncate">{workspace.name}</span>
          <span className="block text-[11px] font-normal text-fg-faint">{ROLE_LABEL_KEYS[workspace.role] ? t(ROLE_LABEL_KEYS[workspace.role]) : workspace.role}</span>
         </span>
         {isSwitching ? (
          <span
           className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent"
           aria-hidden
          />
         ) : isActive ? (
          <CheckGlyph />
         ) : null}
        </button>
       );
      })}
     </div>
     <div className="border-t border-border py-1">
      <button
       type="button"
       role="menuitem"
       disabled={Boolean(switchingId)}
       onClick={() => {
        close();
        onManage();
       }}
       className="flex w-full items-center gap-2.5 px-3 py-2 text-start text-sm text-fg-muted transition hover:bg-surface-hover focus:bg-surface-hover focus:outline-none"
      >
       <span className="flex h-7 w-7 shrink-0 items-center justify-center">{renderIcon('settings', 'h-4 w-4')}</span>
       {t('workspace_manage')}
      </button>
     </div>
    </div>
   ) : null}
  </>
 );
}

function ChevronUpDown() {
 return (
  <svg
   width="14"
   height="14"
   viewBox="0 0 24 24"
   fill="none"
   stroke="currentColor"
   strokeWidth="2"
   strokeLinecap="round"
   strokeLinejoin="round"
   className="shrink-0 text-blue-200"
   aria-hidden
  >
   <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />
  </svg>
 );
}

function CheckGlyph() {
 return (
  <svg
   width="16"
   height="16"
   viewBox="0 0 24 24"
   fill="none"
   stroke="currentColor"
   strokeWidth="2.5"
   strokeLinecap="round"
   strokeLinejoin="round"
   className="shrink-0 text-accent"
   aria-hidden
  >
   <polyline points="20 6 9 17 4 12" />
  </svg>
 );
}
