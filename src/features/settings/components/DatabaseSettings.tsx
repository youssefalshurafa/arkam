'use client';

import type { ChangeEvent, RefObject } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { panelClassName } from '@/shared/styles';

type DatabaseSettingsProps = {
 isBackingUp: boolean;
 isRestoringBackup: boolean;
 backupRestoreInputRef: RefObject<HTMLInputElement | null>;
 lastBackupAt: string | null;
 lastBackupLabel: () => string;
 onDownloadBackup: () => void;
 onRestoreBackupFile: (event: ChangeEvent<HTMLInputElement>) => void;
};

export default function DatabaseSettings({ isBackingUp, isRestoringBackup, backupRestoreInputRef, lastBackupAt, lastBackupLabel, onDownloadBackup, onRestoreBackupFile }: DatabaseSettingsProps) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);

 return (
  <section className="flex flex-col gap-6">
   <div className={panelClassName}>
    <h2 className="text-2xl font-semibold">{t('backup_title')}</h2>
    <p className="mt-2 text-sm text-slate-600">{t('backup_description')}</p>

    <input
     ref={backupRestoreInputRef}
     type="file"
     accept=".json,application/json"
     onChange={onRestoreBackupFile}
     className="hidden"
    />

    <div className="mt-6 grid gap-4 md:grid-cols-2">
     <div className="rounded border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">{t('backup_download_title')}</h3>
      <p className="mt-1 text-sm text-slate-600">{t('backup_download_hint')}</p>
      <button
       type="button"
       onClick={() => void onDownloadBackup()}
       disabled={isBackingUp || isRestoringBackup}
       className="mt-4 inline-flex items-center gap-2 rounded border border-blue-600 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
       <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
       >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line
         x1="12"
         y1="15"
         x2="12"
         y2="3"
        />
       </svg>
       {isBackingUp ? t('backup_download_loading') : t('backup_download_button')}
      </button>
      <p className={`mt-3 text-xs ${lastBackupAt ? 'text-slate-500' : 'text-amber-600'}`}>{lastBackupLabel()}</p>
     </div>

     <div className="rounded border border-amber-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">{t('backup_restore_title')}</h3>
      <p className="mt-1 text-sm text-slate-600">{t('backup_restore_hint')}</p>
      <button
       type="button"
       onClick={() => backupRestoreInputRef.current?.click()}
       disabled={isBackingUp || isRestoringBackup}
       className="mt-4 inline-flex items-center gap-2 rounded border border-amber-600 bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
       <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
       >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line
         x1="12"
         y1="3"
         x2="12"
         y2="15"
        />
       </svg>
       {isRestoringBackup ? t('backup_restore_loading') : t('backup_restore_button')}
      </button>
     </div>
    </div>
   </div>
  </section>
 );
}
