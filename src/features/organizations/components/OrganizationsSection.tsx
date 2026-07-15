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

 // Per-organization cell pieces shared by the desktop table and the mobile card list (below md).
 // Plain render functions (not components) so reusing them in both layouts doesn't trip the
 // "components created during render" lint rule.
 const renderNameLink = (organization: Organization) => (
  <a
   href={`/organizations/${organization.id}`}
   onClick={(e) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    openOrganizationClientsPage(organization);
   }}
   className="cursor-pointer text-left font-medium text-fg transition hover:text-accent"
  >
   {organization.name}
  </a>
 );

 const renderActions = (organization: Organization) => (
  <div className="flex flex-wrap gap-2">
   <a
    href={`/organizations/${organization.id}`}
    onClick={(e) => {
     if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
     e.preventDefault();
     openOrganizationClientsPage(organization);
    }}
    className="cursor-pointer rounded border border-blue-200 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent-weak"
   >
    {t('organization_page_open')}
   </a>
   <button
    type="button"
    onClick={() => setOrganizationForm({ id: organization.id, name: organization.name })}
    className="rounded border border-border-strong px-3 py-1.5 text-xs font-semibold text-fg-muted hover:bg-surface-hover"
   >
    {t('edit')}
   </button>
   <button
    type="button"
    onClick={() => onDeleteOrganization(organization.id)}
    className="rounded border border-red-200 px-3 py-1.5 text-xs font-semibold text-bad-text hover:bg-bad-bg"
   >
    {t('delete')}
   </button>
  </div>
 );

 return (
  <section className="grid gap-6 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
   <div className={panelClassName}>
    <h2 className="text-xl font-semibold">{organizationForm.id ? t('update_organization') : t('new_organization')}</h2>
    <p className="mt-1 text-sm text-fg-muted">{t('organizations_description')}</p>

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
      className="mt-2 w-full rounded border border-border-strong px-3 py-2 outline-none ring-blue-300 focus:ring"
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

    {/* Desktop / tablet: the full table. Hidden below md, where the card list takes over. */}
    <div className={`${tableWrapClassName} hidden md:block`}>
     <table className="w-full text-sm">
      <thead className="bg-surface-hover text-fg-muted">
       <tr>
        <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('name')}</th>
        <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('actions')}</th>
       </tr>
      </thead>
      <tbody>
       {organizations.map((organization) => (
        <tr
         key={organization.id}
         className="border-t border-border align-top"
        >
         <td className="px-4 py-3">{renderNameLink(organization)}</td>
         <td className="px-4 py-3">{renderActions(organization)}</td>
        </tr>
       ))}
       {organizations.length === 0 ? (
        <tr>
         <td
          className="px-4 py-6 text-fg-faint"
          colSpan={2}
         >
          {t('no_organizations')}
         </td>
        </tr>
       ) : null}
      </tbody>
     </table>
    </div>

    {/* Mobile (below md): each organization as a stacked card so the actions fit with no
        horizontal scroll. */}
    <div className="mt-3 flex flex-col gap-2 md:hidden">
     {organizations.length === 0 ? (
      <p className="text-sm text-fg-faint">{t('no_organizations')}</p>
     ) : (
      organizations.map((organization) => (
       <div
        key={organization.id}
        className="rounded border border-border bg-surface-2 p-3"
       >
        {renderNameLink(organization)}
        <div className="mt-2">{renderActions(organization)}</div>
       </div>
      ))
     )}
    </div>
   </div>
  </section>
 );
}
