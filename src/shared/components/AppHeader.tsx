'use client';

import Image from 'next/image';
import { signOut } from 'next-auth/react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { accountingApi } from '@/lib/accountingApi';
import { confirmDialog } from '@/components/ui/AppDialog';
import { renderIcon } from '@/shared/utils/icons';
import type { IconName, Section } from '@/shared/types';

type SidebarItem = { id: string; label: string; icon: IconName; isActive: boolean; onClick: () => void };

type AppHeaderProps = {
 sidebarItems: SidebarItem[];
 section: Section;
 navigateToSection: (section: Section) => void;
 activeSectionMeta: { title: string; description: string };
 shellMetrics: Array<{ label: string; value: number }>;
};

export default function AppHeader({ sidebarItems, section, navigateToSection, activeSectionMeta, shellMetrics }: AppHeaderProps) {
 const { language, setLanguage } = useLanguage();
 const { t } = useTranslation(language);

 const handleSignOut = async () => {
  if (!(await confirmDialog({ title: t('sign_out_confirm_title'), message: t('sign_out_confirm_message'), confirmText: t('sign_out') }))) {
   return;
  }
  accountingApi.setActiveWorkspaceId(null);
  void signOut({ callbackUrl: '/login' });
 };

 return (
  <>
   {/* Top bar - mobile navigation */}
   <div className="border-b border-[#15304f] bg-[#1e3a5f] px-4 py-2 lg:hidden">
    <div className="flex items-center justify-between gap-2 overflow-x-auto">
     <span className="inline-flex shrink-0 items-center rounded-md bg-white px-1.5 py-1 shadow-sm">
      <Image
       src="/logo/arkam-logo.png"
       alt="Arkam"
       width={720}
       height={876}
       className="h-7 w-auto"
      />
     </span>
     <div className="flex shrink-0 items-center gap-1">
      {sidebarItems.map((item) => {
       const isActive = item.isActive;
       return (
        <button
         key={item.id}
         type="button"
         onClick={item.onClick}
         aria-pressed={isActive}
         title={item.label}
         className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs font-medium transition ${
          isActive ? 'border-blue-400 bg-blue-600 text-white' : 'border-white/20 text-blue-100 hover:bg-white/10 hover:text-white'
         }`}
        >
         {renderIcon(item.icon, 'h-4 w-4')}
         <span className="hidden sm:inline">{item.label}</span>
        </button>
       );
      })}
      <button
       type="button"
       onClick={() => navigateToSection('settings')}
       title={t('settings_title')}
       className="inline-flex items-center gap-1.5 rounded border border-white/20 px-2 py-1 text-xs text-blue-100 transition hover:bg-white/10 hover:text-white"
      >
       {renderIcon('settings', 'h-4 w-4')}
      </button>
      <button
       type="button"
       onClick={() => void handleSignOut()}
       title={t('sign_out')}
       className="inline-flex items-center gap-1.5 rounded border border-white/20 px-2 py-1 text-xs text-blue-100 transition hover:bg-white/10 hover:text-white"
      >
       {renderIcon('auth', 'h-4 w-4')}
      </button>
      <select
       value={language}
       onChange={(event) => setLanguage(event.target.value as 'en' | 'ar' | 'fr')}
       className="rounded border border-white/20 bg-white/10 px-1.5 py-1 text-xs text-blue-100 outline-none"
      >
       <option
        value="en"
        className="bg-white text-slate-900"
       >
        EN
       </option>
       <option
        value="ar"
        className="bg-white text-slate-900"
       >
        عر
       </option>
       <option
        value="fr"
        className="bg-white text-slate-900"
       >
        FR
       </option>
      </select>
     </div>
    </div>
   </div>

   {/* Page title bar · hidden when in settings (settings has its own header) */}
   {section !== 'client-ledger' && section !== 'settings' ? (
    <div className="border-b border-gray-200 bg-white px-5 py-3">
     <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
       <h1 className="text-sm font-semibold text-gray-800">{activeSectionMeta.title}</h1>
       <p className="mt-0.5 text-xs text-gray-500">{activeSectionMeta.description}</p>
      </div>
      <div className="flex items-center gap-6">
       {shellMetrics.map((metric) => (
        <div
         key={metric.label}
         className="text-right"
        >
         <p className="text-xs text-gray-500">{metric.label}</p>
         <p className="text-sm font-semibold text-gray-800">{metric.value}</p>
        </div>
       ))}
      </div>
     </div>
    </div>
   ) : null}
  </>
 );
}
