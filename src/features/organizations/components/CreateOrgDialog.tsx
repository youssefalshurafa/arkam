'use client';

import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { Spinner } from '@/components/ui/Spinner';
import { emptyOrganizationForm } from '@/features/organizations/forms';
import type { OrganizationForm } from '@/shared/types';

type CreateOrgDialogProps = {
 organizationForm: OrganizationForm;
 setOrganizationForm: Dispatch<SetStateAction<OrganizationForm>>;
 onCreateOrgFromDialog: (event: FormEvent<HTMLFormElement>) => void;
 isSavingOrg: boolean;
 orgDialogError: string;
 setOrgDialogError: Dispatch<SetStateAction<string>>;
 setShowCreateOrgDialog: Dispatch<SetStateAction<boolean>>;
 setOrgDialogTargetReviewKey: Dispatch<SetStateAction<string | null>>;
};

export default function CreateOrgDialog({
 organizationForm, setOrganizationForm, onCreateOrgFromDialog, isSavingOrg, orgDialogError, setOrgDialogError,
 setShowCreateOrgDialog, setOrgDialogTargetReviewKey,
}: CreateOrgDialogProps) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);

 return (
    <div
     className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
     onClick={() => {
      setShowCreateOrgDialog(false);
      setOrgDialogTargetReviewKey(null);
      setOrgDialogError('');
     }}
    >
     <div
      className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
      onClick={(e) => e.stopPropagation()}
     >
      <h2 className="text-lg font-semibold text-slate-900">{t('new_organization')}</h2>
      {orgDialogError ? (
       <div className="mt-3 flex items-start gap-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
        <span className="flex-1">{orgDialogError}</span>
        <button
         type="button"
         onClick={() => setOrgDialogError('')}
         className="shrink-0 text-red-400 hover:text-red-700"
         aria-label={t('close')}
        >
         <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
         >
          <path d="M18 6 6 18M6 6l12 12" />
         </svg>
        </button>
       </div>
      ) : null}
      <form
       onSubmit={(e) => void onCreateOrgFromDialog(e)}
       className="mt-4 flex flex-col gap-4"
      >
       <div>
        <label className="block text-sm font-medium text-slate-700">{t('organization_name')}</label>
        <input
         type="text"
         value={organizationForm.name}
         onChange={(event) => setOrganizationForm((current) => ({ ...current, name: event.target.value }))}
         placeholder={t('organization_name_placeholder')}
         className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
         autoFocus
         required
        />
       </div>
       <div className="flex justify-end gap-2">
        <button
         type="button"
         onClick={() => {
          setShowCreateOrgDialog(false);
          setOrgDialogTargetReviewKey(null);
          setOrganizationForm(emptyOrganizationForm());
          setOrgDialogError('');
         }}
         className="rounded border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition"
        >
         {t('cancel')}
        </button>
        <button
         type="submit"
         disabled={isSavingOrg}
         className="inline-flex items-center gap-2 rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
         {isSavingOrg ? <Spinner className="text-base" /> : null}
         {t('save_organization')}
        </button>
       </div>
      </form>
     </div>
    </div>
 );
}
