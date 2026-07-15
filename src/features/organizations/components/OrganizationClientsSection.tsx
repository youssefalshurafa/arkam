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
 clientReconciledStatus: Set<number>;
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
 clientReconciledStatus,
 numLocale,
 isRTL,
 openAddClientForOrganization,
 navigateToSection,
 openClientLedger,
 setPendingPricingModalClientId,
}: OrganizationClientsSectionProps) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);

 // Per-client cell pieces shared by the desktop table and the mobile card list (below md).
 // Plain render functions (not components) so reusing them in both layouts doesn't trip the
 // "components created during render" lint rule.
 const renderNameLink = (client: Client) => (
  <a
   href={`/clients/${client.id}`}
   onClick={(e) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    openClientLedger(client, 'organization-clients');
   }}
   className="cursor-pointer text-left font-medium text-fg transition hover:text-accent"
  >
   {client.name}
  </a>
 );

 const renderBalanceChips = (client: Client) => (
  <div className="flex flex-wrap gap-1">
   {(clientPageBalances.get(client.id) ?? []).map((entry) => (
    <span
     key={entry.accountId}
     className={`whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-xs font-semibold ${entry.balance >= 0 ? 'bg-good-bg text-good-text' : 'bg-bad-bg text-bad-text'}`}
    >
     {entry.currencySymbol || entry.currencyCode} {entry.balance.toLocaleString(numLocale, { maximumFractionDigits: 0 })}
    </span>
   ))}
  </div>
 );

 // The pending-count button, the reconciled check, or null (a client with rows awaiting
 // pricing can't be reconciled, so the two states never collide and share this slot). The
 // table cell substitutes an em-dash for null; the card shows nothing.
 const renderStatusMark = (client: Client) => {
  const pendingCount = clientPendingPricingCounts.get(client.id) ?? 0;
  if (pendingCount > 0) {
   return (
    <button
     type="button"
     onClick={() => setPendingPricingModalClientId(client.id)}
     title={t(pendingCount === 1 ? 'ledger_pending_balance_note' : 'ledger_pending_balance_note_plural', { count: pendingCount })}
     className="cursor-pointer rounded bg-warn-bg px-1.5 py-0.5 font-mono text-xs font-semibold text-warn-text transition hover:bg-warn-bg"
    >
     {pendingCount}
    </button>
   );
  }
  if (clientReconciledStatus.has(client.id)) {
   return (
    <span
     title={t('client_reconciled_mark')}
     aria-label={t('client_reconciled_mark')}
     className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-good-bg text-good-text"
    >
     <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
     </svg>
    </span>
   );
  }
  return null;
 };

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
         tableWrapClassName="border border-border"
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
           <p className="text-sm font-semibold uppercase tracking-wide text-accent">{t('organization_page_title')}</p>
           <h2 className="mt-2 text-2xl font-semibold text-fg">{selectedOrganizationForClients?.name ?? t('organizations_title')}</h2>
           <p className="mt-2 text-sm text-fg-muted">{selectedOrganizationForClients ? t('organization_page_description') : t('organization_page_no_organization')}</p>
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
            className="rounded border border-border-strong px-4 py-2 text-sm font-semibold text-fg-muted hover:bg-surface-hover"
           >
            {t('organization_page_back')}
           </button>
          </div>
         </div>

         {selectedOrganizationForClients ? (
          <div className="mt-6 grid gap-4 md:grid-cols-3">
           <div className={mutedPanelClassName}>
            <p className="text-sm text-fg-faint">{t('organizations_title')}</p>
            <p className="mt-2 text-lg font-semibold text-fg">{selectedOrganizationForClients.name}</p>
           </div>
           <div className={mutedPanelClassName}>
            <p className="text-sm text-fg-faint">{t('overview_clients')}</p>
            <p className="mt-2 text-lg font-semibold text-fg">{selectedOrganizationClients.length}</p>
           </div>
           <div className={mutedPanelClassName}>
            <p className="text-sm text-fg-faint">{t('client_accounts')}</p>
            <p className="mt-2 text-lg font-semibold text-fg">{selectedOrganizationClients.reduce((sum, client) => sum + client.accountCount, 0)}</p>
           </div>
          </div>
         ) : null}
        </div>

        {!selectedOrganizationForClients ? (
         <div className={`${panelClassName} text-sm text-fg-muted`}>{t('organization_page_no_organization')}</div>
        ) : selectedOrganizationClients.length === 0 ? (
         <div className={`${panelClassName} text-sm text-fg-muted`}>{t('organization_page_no_clients')}</div>
        ) : (
         <div className={panelClassName}>
          <h3 className="text-xl font-semibold text-fg">{t('organization_clients_title')}</h3>

          {/* Desktop / tablet: the full table. Hidden below md, where the card list takes over. */}
          <div className={`${tableWrapClassName} hidden md:block`}>
           <table className="w-full text-sm">
            <thead className="bg-surface-hover text-fg-muted">
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
               className="border-t border-border align-top"
              >
               <td className="whitespace-nowrap px-4 py-3">{renderNameLink(client)}</td>
               <td className="px-4 py-3">{renderBalanceChips(client)}</td>
               <td className="px-4 py-3">{renderStatusMark(client) ?? <span className="text-fg-faint">—</span>}</td>
              </tr>
             ))}
            </tbody>
           </table>
          </div>

          {/* Mobile (below md): each client as a stacked card so everything fits with no
              horizontal scroll. */}
          <div className="mt-3 flex flex-col gap-2 md:hidden">
           {selectedOrganizationClients.map((client) => (
            <div
             key={client.id}
             className="rounded border border-border bg-surface-2 p-3"
            >
             <div className="flex items-start justify-between gap-3">
              {renderNameLink(client)}
              {renderStatusMark(client)}
             </div>
             <div className="mt-2">{renderBalanceChips(client)}</div>
            </div>
           ))}
          </div>
         </div>
        )}
       </section>
      ) : null}
  </>
 );
}
