'use client';

import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { panelClassName, tableWrapClassName } from '@/shared/styles';
import type { Organization, OrganizationForm } from '@/shared/types';

type OrganizationsSectionProps = {
 organizations: Organization[];
 organizationForm: OrganizationForm;
 setOrganizationForm: Dispatch<SetStateAction<OrganizationForm>>;
 onOrganizationSubmit: (event: FormEvent<HTMLFormElement>) => void;
 onDeleteOrganization: (id: number) => void;
 openOrganizationClientsPage: (organization: Organization) => void;
};

export default function OrganizationsSection({ organizations, organizationForm, setOrganizationForm, onOrganizationSubmit, onDeleteOrganization, openOrganizationClientsPage }: OrganizationsSectionProps) {
 const { language, isRTL } = useLanguage();
 const { t } = useTranslation(language);

 return (
  <section className="grid gap-6 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
   <div className={panelClassName}>
    <h2 className="text-xl font-semibold">{organizationForm.id ? t('update_organization') : t('new_organization')}</h2>
    <p className="mt-1 text-sm text-slate-600">{t('organizations_description')}</p>

    <form
     onSubmit={(event) => void onOrganizationSubmit(event)}
     className="mt-5"
    >
     <label className="block text-sm font-medium">{t('organization_name')}</label>
     <input
      type="text"
      value={organizationForm.name}
      onChange={(event) => setOrganizationForm((current) => ({ ...current, name: event.target.value }))}
      placeholder={t('organization_name_placeholder')}
      className="mt-2 w-full rounded border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
      required
     />

     <button
      type="submit"
      className="mt-6 w-full rounded bg-blue-700 px-4 py-2 font-medium text-white transition hover:bg-blue-800"
     >
      {organizationForm.id ? t('update_organization') : t('save_organization')}
     </button>
    </form>
   </div>

   <div className={panelClassName}>
    <h2 className="text-xl font-semibold">{t('organizations_title')}</h2>
    <div className={tableWrapClassName}>
     <table className="w-full text-sm">
      <thead className="bg-slate-100 text-slate-700">
       <tr>
        <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('name')}</th>
        <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('actions')}</th>
       </tr>
      </thead>
      <tbody>
       {organizations.map((organization) => (
        <tr
         key={organization.id}
         className="border-t border-slate-200 align-top"
        >
         <td className="px-4 py-3 font-medium text-slate-900">
          <a
           href={`/organizations/${organization.id}`}
           onClick={(e) => {
            if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
            e.preventDefault();
            openOrganizationClientsPage(organization);
           }}
           className="cursor-pointer text-left text-slate-900 transition hover:text-blue-700"
          >
           {organization.name}
          </a>
         </td>
         <td className="px-4 py-3">
          <div className="flex flex-wrap gap-2">
           <a
            href={`/organizations/${organization.id}`}
            onClick={(e) => {
             if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
             e.preventDefault();
             openOrganizationClientsPage(organization);
            }}
            className="cursor-pointer rounded border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
           >
            {t('organization_page_open')}
           </a>
           <button
            type="button"
            onClick={() =>
             setOrganizationForm({
              id: organization.id,
              name: organization.name,
             })
            }
            className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
           >
            {t('edit')}
           </button>
           <button
            type="button"
            onClick={() => onDeleteOrganization(organization.id)}
            className="rounded border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
           >
            {t('delete')}
           </button>
          </div>
         </td>
        </tr>
       ))}
       {organizations.length === 0 ? (
        <tr>
         <td
          className="px-4 py-6 text-slate-500"
          colSpan={2}
         >
          {t('no_organizations')}
         </td>
        </tr>
       ) : null}
      </tbody>
     </table>
    </div>
   </div>
  </section>
 );
}
