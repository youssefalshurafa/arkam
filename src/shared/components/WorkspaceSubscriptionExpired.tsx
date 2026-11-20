'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';

// Shown in place of a workspace's data when its OWNER's subscription has lapsed. Teammates
// have no subscription of their own: their access to a workspace follows its owner's.
// Settings (account, team, workspace switching) stays reachable.
export default function WorkspaceSubscriptionExpired({
 ownerName,
 hasOtherWorkspaces,
 onManageWorkspaces,
}: {
 ownerName?: string;
 hasOtherWorkspaces: boolean;
 onManageWorkspaces: () => void;
}) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 return (
  <div className="flex flex-1 items-center justify-center p-6">
   <div className="w-full max-w-md rounded-lg border border-amber-200 bg-warn-bg p-6 text-center shadow-sm">
    <h2 className="text-lg font-semibold text-warn-text">{t('workspace_expired_title')}</h2>
    <p className="mt-2 text-sm text-warn-text">
     {ownerName ? t('workspace_expired_desc_owner').replace('{owner}', ownerName) : t('workspace_expired_desc')}
    </p>
    {hasOtherWorkspaces ? (
     <button
      type="button"
      onClick={onManageWorkspaces}
      className="mt-4 rounded border border-amber-400 bg-surface px-4 py-2 text-sm font-semibold text-warn-text transition hover:bg-warn-bg"
     >
      {t('workspace_expired_switch')}
     </button>
    ) : null}
   </div>
  </div>
 );
}
