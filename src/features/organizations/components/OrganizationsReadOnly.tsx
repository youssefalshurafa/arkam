'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { panelClassName, tableWrapClassName } from '@/shared/styles';
import type { Client, Organization } from '@/shared/types';

type OrganizationsReadOnlyProps = {
 organizations: Organization[];
 clients: Client[];
 openOrganizationClientsPage: (organization: Organization) => void;
 onOpenSettings: () => void;
};

export default function OrganizationsReadOnly({ organizations, clients, openOrganizationClientsPage, onOpenSettings }: OrganizationsReadOnlyProps) {
 const { language, isRTL } = useLanguage();
 const { t } = useTranslation(language);

 return (
  <section className={panelClassName}>
   <div className="flex items-start justify-between gap-4">
    <div>
     <h2 className="text-xl font-semibold">{t('organizations_title')}</h2>
    </div>
    <button
     type="button"
     onClick={onOpenSettings}
     className="rounded border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
    >
     {t('open_in_settings')}
    </button>
   </div>

   <div className={tableWrapClassName}>
    <table className="w-full text-sm">
     <thead className="bg-slate-100 text-slate-700">
      <tr>
       <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('name')}</th>
       <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('overview_clients')}</th>
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
        <td className="px-4 py-3 text-slate-600">{clients.filter((client) => client.organizationId === organization.id).length}</td>
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
  </section>
 );
}
