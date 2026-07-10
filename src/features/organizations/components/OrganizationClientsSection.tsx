'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { SkBar, SkTablePanel, SK_CLIENTS } from '@/shared/components/skeletons/Skeletons';
import { panelClassName, mutedPanelClassName, tableWrapClassName } from '@/shared/styles';
import type { Client, Organization, Section } from '@/shared/types';

type BalanceEntry = { accountId: number; currencyCode: string; currencySymbol: string; balance: number };

type OrganizationClientsSectionProps = {
 section: Section;
 isLoading: boolean;
 selectedOrganizationForClients: Organization | null;
 selectedOrganizationClients: Client[];
 clientPageBalances: Map<number, BalanceEntry[]>;
 clientPendingPricingCounts: Map<number, number>;
 numLocale: string;
 isRTL: boolean;
 openAddClientForOrganization: (organization: Organization) => void;
 navigateToSection: (section: Section) => void;
 openClientLedger: (client: Client, origin?: 'clients' | 'organization-clients', accountId?: number | null) => void;
 setPendingPricingModalClientId: (id: number | null) => void;
};

export default function OrganizationClientsSection({
 section,
 isLoading,
 selectedOrganizationForClients,
 selectedOrganizationClients,
 clientPageBalances,
 clientPendingPricingCounts,
 numLocale,
 isRTL,
 openAddClientForOrganization,
 navigateToSection,
 openClientLedger,
 setPendingPricingModalClientId,
}: OrganizationClientsSectionProps) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);

 return (
  <>
      {section === 'organization-clients' && isLoading ? (
       <div className={panelClassName}>
        <div className="mb-4 flex items-center justify-between gap-4">
         <SkBar
          w="w-52"
          h="h-6"
         />
         <SkBar
          w="w-28"
          h="h-8"
         />
        </div>
        <SkTablePanel
         panelClassName=""
         tableWrapClassName="border border-gray-200"
         cols={SK_CLIENTS}
         rows={6}
        />
       </div>
      ) : null}
      {section === 'organization-clients' && !isLoading ? (
       <section className="flex flex-col gap-6">
        <div className={panelClassName}>
         <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
           <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">{t('organization_page_title')}</p>
           <h2 className="mt-2 text-2xl font-semibold text-slate-900">{selectedOrganizationForClients?.name ?? t('organizations_title')}</h2>
           <p className="mt-2 text-sm text-slate-600">{selectedOrganizationForClients ? t('organization_page_description') : t('organization_page_no_organization')}</p>
          </div>

          <div className="flex shrink-0 gap-2">
           {selectedOrganizationForClients ? (
            <button
             type="button"
             onClick={() => openAddClientForOrganization(selectedOrganizationForClients)}
             className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
            >
             {t('organization_add_client')}
            </button>
           ) : null}
           <button
            type="button"
            onClick={() => navigateToSection('organizations')}
            className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
           >
            {t('organization_page_back')}
           </button>
          </div>
         </div>

         {selectedOrganizationForClients ? (
          <div className="mt-6 grid gap-4 md:grid-cols-3">
           <div className={mutedPanelClassName}>
            <p className="text-sm text-slate-500">{t('organizations_title')}</p>
            <p className="mt-2 text-lg font-semibold text-slate-900">{selectedOrganizationForClients.name}</p>
           </div>
           <div className={mutedPanelClassName}>
            <p className="text-sm text-slate-500">{t('overview_clients')}</p>
            <p className="mt-2 text-lg font-semibold text-slate-900">{selectedOrganizationClients.length}</p>
           </div>
           <div className={mutedPanelClassName}>
            <p className="text-sm text-slate-500">{t('client_accounts')}</p>
            <p className="mt-2 text-lg font-semibold text-slate-900">{selectedOrganizationClients.reduce((sum, client) => sum + client.accountCount, 0)}</p>
           </div>
          </div>
         ) : null}
        </div>

        {!selectedOrganizationForClients ? (
         <div className={`${panelClassName} text-sm text-slate-600`}>{t('organization_page_no_organization')}</div>
        ) : selectedOrganizationClients.length === 0 ? (
         <div className={`${panelClassName} text-sm text-slate-600`}>{t('organization_page_no_clients')}</div>
        ) : (
         <div className={panelClassName}>
          <h3 className="text-xl font-semibold text-slate-900">{t('organization_clients_title')}</h3>
          <div className={tableWrapClassName}>
           <table className="w-full text-sm">
            <thead className="bg-slate-100 text-slate-700">
             <tr>
              <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('name')}</th>
              <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('balance')}</th>
              <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('organization_pending_pricing')}</th>
             </tr>
            </thead>
            <tbody>
             {selectedOrganizationClients.map((client) => (
              <tr
               key={client.id}
               className="border-t border-slate-200 align-top"
              >
               <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">
                <a
                 href={`/clients/${client.id}`}
                 onClick={(e) => {
                  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
                  e.preventDefault();
                  openClientLedger(client, 'organization-clients');
                 }}
                 className="cursor-pointer text-left text-slate-900 transition hover:text-blue-700"
                >
                 {client.name}
                </a>
               </td>
               <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                 {(clientPageBalances.get(client.id) ?? []).map((entry) => (
                  <span
                   key={entry.accountId}
                   className={`whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-xs font-semibold ${entry.balance >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}
                  >
                   {entry.currencySymbol || entry.currencyCode} {entry.balance.toLocaleString(numLocale, { maximumFractionDigits: 0 })}
                  </span>
                 ))}
                </div>
               </td>
               <td className="px-4 py-3">
                {(() => {
                 const pendingCount = clientPendingPricingCounts.get(client.id) ?? 0;
                 if (pendingCount === 0) return <span className="text-slate-400">—</span>;
                 return (
                  <button
                   type="button"
                   onClick={() => setPendingPricingModalClientId(client.id)}
                   title={t(pendingCount === 1 ? 'ledger_pending_balance_note' : 'ledger_pending_balance_note_plural', { count: pendingCount })}
                   className="cursor-pointer rounded bg-amber-50 px-1.5 py-0.5 font-mono text-xs font-semibold text-amber-700 transition hover:bg-amber-100"
                  >
                   {pendingCount}
                  </button>
                 );
                })()}
               </td>
              </tr>
             ))}
            </tbody>
           </table>
          </div>
         </div>
        )}
       </section>
      ) : null}
  </>
 );
}
