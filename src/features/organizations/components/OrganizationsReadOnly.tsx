'use client';

import { useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { panelClassName, tableWrapClassName } from '@/shared/styles';
import { computeOverviewBalances } from '@/features/overview/utils/overviewBalances';
import type { Client, ClientAccount, ClientAdjustment, Currency, Organization, Transaction } from '@/shared/types';

type OrganizationsReadOnlyProps = {
 organizations: Organization[];
 clients: Client[];
 clientAccounts: ClientAccount[];
 transactions: Transaction[];
 adjustments: ClientAdjustment[];
 currencies: Currency[];
 openOrganizationClientsPage: (organization: Organization) => void;
 onOpenSettings: () => void;
};

export default function OrganizationsReadOnly({
 organizations, clients, clientAccounts, transactions, adjustments, currencies, openOrganizationClientsPage, onOpenSettings,
}: OrganizationsReadOnlyProps) {
 const { language, isRTL } = useLanguage();
 const { t } = useTranslation(language);
 const numLocale = language === 'fr' ? 'fr-FR' : language;

 // Per-organization, per-currency net balance (summed across all of the org's clients).
 // Shown as a breakdown badge per currency, so no exchange-rate conversion is needed.
 const { byOrg } = useMemo(
  () => computeOverviewBalances({ transactions, adjustments, clientAccounts, clients, currencies, language }),
  [transactions, adjustments, clientAccounts, clients, currencies, language],
 );

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
       <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('organizations_balance')}</th>
      </tr>
     </thead>
     <tbody>
      {organizations.map((organization) => {
       const orgBalances = byOrg.get(String(organization.id)) ?? [];
       return (
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
         <td className="px-4 py-3">
          {orgBalances.length === 0 ? (
           <span className="text-xs text-slate-400">—</span>
          ) : (
           <div className="flex flex-wrap gap-1">
            {orgBalances.map((group) => (
             <span
              key={group.key}
              className={`rounded px-1.5 py-0.5 font-mono text-xs font-semibold ${group.total >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}
             >
              {group.currencySymbol || group.currencyCode} {group.total.toLocaleString(numLocale, { maximumFractionDigits: 0 })}
             </span>
            ))}
           </div>
          )}
         </td>
        </tr>
       );
      })}
      {organizations.length === 0 ? (
       <tr>
        <td
         className="px-4 py-6 text-slate-500"
         colSpan={3}
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
