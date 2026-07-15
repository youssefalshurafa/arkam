'use client';

import type { Dispatch, SetStateAction } from 'react';
import Image from 'next/image';
import { signOut } from 'next-auth/react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { accountingApi } from '@/lib/accountingApi';
import { confirmDialog } from '@/components/ui/AppDialog';
import { renderIcon } from '@/shared/utils/icons';
import type { IconName, Section } from '@/shared/types';

type SidebarItem = { id: string; label: string; icon: IconName; isActive: boolean; onClick: () => void };
type Workspace = { id: string; name: string; role: string };

type SidebarProps = {
 sidebarItems: SidebarItem[];
 isSidebarCollapsed: boolean;
 setIsSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
 userWorkspaces: Workspace[];
 activeWorkspaceId: string | null;
 onSwitchWorkspace: (id: string) => void;
 navigateToSection: (section: Section) => void;
 section: Section;
};

export default function Sidebar({
 sidebarItems, isSidebarCollapsed, setIsSidebarCollapsed, userWorkspaces, activeWorkspaceId, onSwitchWorkspace,
 navigateToSection, section,
}: SidebarProps) {
 const { language, setLanguage, isRTL } = useLanguage();
 const { t } = useTranslation(language);

 const handleSignOut = async () => {
  if (!(await confirmDialog({ title: t('sign_out_confirm_title'), message: t('sign_out_confirm_message'), confirmText: t('sign_out') }))) {
   return;
  }
  accountingApi.setActiveWorkspaceId(null);
  void signOut({ callbackUrl: '/login' });
 };

 return (
    <aside
     className={`hidden lg:flex flex-col text-white border-r shrink-0 transition-[width,background-color] duration-200 ${
      section === 'settings'
       ? 'bg-(--sidebar-settings-bg) border-(--sidebar-settings-border)'
       : 'bg-(--sidebar-bg) border-(--sidebar-border)'
     } ${isSidebarCollapsed ? 'w-16' : 'w-56'}`}
     style={{ position: 'sticky', top: 0, height: '100vh', overflowY: 'auto' }}
    >
     {/* Brand */}
     <div className={`flex items-center border-b border-white/10 px-3 py-3 ${isSidebarCollapsed ? 'justify-center' : 'justify-between gap-2'}`}>
      {!isSidebarCollapsed && (
       <div className="flex min-w-0 items-center rounded-lg bg-surface px-2.5 py-1.5 shadow-sm">
        <Image
         src="/logo/arkam-logo.png"
         alt="Arkam"
         width={720}
         height={876}
         priority
         className="h-9 w-auto"
        />
       </div>
      )}
      <button
       type="button"
       onClick={() =>
        setIsSidebarCollapsed((current) => {
         const next = !current;
         try {
          localStorage.setItem('arkam:sidebar-collapsed', String(next));
         } catch {}
         return next;
        })
       }
       aria-label={isSidebarCollapsed ? t('sidebar_expand') : t('sidebar_collapse')}
       title={isSidebarCollapsed ? t('sidebar_expand') : t('sidebar_collapse')}
       className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-white/20 text-blue-200 transition hover:bg-white/10 hover:text-white"
      >
       {isSidebarCollapsed ? (isRTL ? '<' : '>') : isRTL ? '>' : '<'}
      </button>
     </div>
     {/* Navigation */}
     <nav className="flex-1 py-1">
      {sidebarItems.map((item) => {
       const isActive = item.isActive;
       return (
        <button
         key={item.id}
         type="button"
         onClick={item.onClick}
         aria-pressed={isActive}
         aria-label={item.label}
         title={item.label}
         className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-sm font-medium transition ${
          isActive ? (section === 'settings' ? 'bg-purple-600 text-white' : 'bg-blue-600 text-white') : 'text-blue-100 hover:bg-white/10 hover:text-white'
         } ${isSidebarCollapsed ? 'justify-center' : ''}`}
        >
         <span className="shrink-0">{renderIcon(item.icon, 'h-4 w-4')}</span>
         {isSidebarCollapsed ? null : <span className="truncate">{item.label}</span>}
        </button>
       );
      })}

      {/* Settings entry */}
      <button
       type="button"
       onClick={() => navigateToSection('settings')}
       aria-pressed={section === 'settings'}
       aria-label={t('settings_title')}
       title={t('settings_title')}
       className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-sm font-medium transition ${
        section === 'settings' ? 'bg-purple-600 text-white' : 'text-blue-100 hover:bg-white/10 hover:text-white'
       } ${isSidebarCollapsed ? 'justify-center' : ''}`}
      >
       <span className="shrink-0">{renderIcon('settings', 'h-4 w-4')}</span>
       {isSidebarCollapsed ? null : <span className="truncate">{t('settings_title')}</span>}
      </button>
     </nav>
     {/* Footer */}
     <div className="border-t border-white/10 py-1">
      <button
       type="button"
       onClick={() => void handleSignOut()}
       aria-label={t('sign_out')}
       title={t('sign_out')}
       className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-sm font-medium text-blue-100 transition hover:bg-white/10 hover:text-white ${
        isSidebarCollapsed ? 'justify-center' : ''
       }`}
      >
       <span className="shrink-0">{renderIcon('auth', 'h-4 w-4')}</span>
       {isSidebarCollapsed ? null : <span>{t('sign_out')}</span>}
      </button>
      {!isSidebarCollapsed && userWorkspaces.length > 1 ? (
       <div className="px-3 pb-1 pt-1">
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-blue-300">{t('workspace_label')}</label>
        <select
         value={activeWorkspaceId ?? ''}
         onChange={(event) => onSwitchWorkspace(event.target.value)}
         className="w-full rounded border border-white/20 bg-white/10 px-2 py-1 text-xs text-blue-100 outline-none transition focus:border-blue-300"
        >
         {userWorkspaces.map((workspace) => (
          <option
           key={workspace.id}
           value={workspace.id}
          >
           {workspace.name}
          </option>
         ))}
        </select>
       </div>
      ) : null}
      {isSidebarCollapsed ? (
       <div className="flex justify-center px-2 pb-2 pt-1">
        <select
         value={language}
         onChange={(event) => setLanguage(event.target.value as 'en' | 'ar' | 'fr')}
         title={t('select_language')}
         className="w-full rounded border border-white/20 bg-white/10 px-1 py-1 text-center text-xs text-blue-100 outline-none transition focus:border-blue-300"
        >
         <option
          value="en"
          className="bg-surface text-fg"
         >
          EN
         </option>
         <option
          value="ar"
          className="bg-surface text-fg"
         >
          عر
         </option>
         <option
          value="fr"
          className="bg-surface text-fg"
         >
          FR
         </option>
        </select>
       </div>
      ) : (
       <div className="px-3 pb-2 pt-1">
        <select
         value={language}
         onChange={(event) => setLanguage(event.target.value as 'en' | 'ar' | 'fr')}
         className="w-full rounded border border-white/20 bg-white/10 px-2 py-1 text-xs text-blue-100 outline-none transition focus:border-blue-300"
        >
         <option
          value="en"
          className="bg-surface text-fg"
         >
          {t('english')}
         </option>
         <option
          value="ar"
          className="bg-surface text-fg"
         >
          {t('arabic')}
         </option>
         <option
          value="fr"
          className="bg-surface text-fg"
         >
          {t('french')}
         </option>
        </select>
       </div>
      )}
     </div>
    </aside>
 );
}
