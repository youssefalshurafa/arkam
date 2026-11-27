'use client';

import { useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { panelClassName, tableWrapClassName } from '@/shared/styles';
import { computeOverviewBalances } from '@/features/overview/utils/overviewBalances';
import type { Client, ClientAccount, Currency, Organization, Transaction } from '@/shared/types';

type OrganizationsReadOnlyProps = {
 organizations: Organization[];
 clients: Client[];
 clientAccounts: ClientAccount[];
 transactions: Transaction[];
 currencies: Currency[];
 // Per-client count of transactions awaiting a manually-entered exchange rate — same map the
 // organization-clients page uses; summed per organization below for this page's own column.
 clientPendingPricingCounts: Map<number, number>;
 // Clients whose last transaction is reconciled — the same set behind the organization-clients
 // page's per-client check mark; an organization gets the mark here when all its clients have it.
 clientReconciledStatus: Set<number>;
 openOrganizationClientsPage: (organization: Organization) => void;
 onOpenSettings: () => void;
 setPendingPricingModalOrgId: (id: number | null) => void;
};

export default function OrganizationsReadOnly({
 organizations, clients, clientAccounts, transactions, currencies, clientPendingPricingCounts, clientReconciledStatus, openOrganizationClientsPage, onOpenSettings, setPendingPricingModalOrgId,
}: OrganizationsReadOnlyProps) {
 const { language, isRTL } = useLanguage();
 const { t } = useTranslation(language);
 // French uses 'en-US' grouping (comma thousands, period decimal) instead of the
 // official fr-FR narrow-no-break-space separator, which renders as near-invisible.
 const numLocale = language === 'fr' ? 'en-US' : language;

 // Per-organization, per-currency net balance (summed across all of the org's clients).
 // Shown as a breakdown badge per currency, so no exchange-rate conversion is needed.
 const { byOrg } = useMemo(
  () => computeOverviewBalances({ transactions, clientAccounts, clients, currencies, language }),
  [transactions, clientAccounts, clients, currencies, language],
 );

 // Per-organization sum of clientPendingPricingCounts, for this page's own "awaiting pricing"
 // column — mirrors the organization-clients page's per-client column, just rolled up.
 const orgPendingPricingCounts = useMemo(() => {
  const map = new Map<number, number>();
  for (const client of clients) {
   if (client.organizationId == null) continue;
   const count = clientPendingPricingCounts.get(client.id) ?? 0;
   if (count > 0) map.set(client.organizationId, (map.get(client.organizationId) ?? 0) + count);
  }
  return map;
 }, [clients, clientPendingPricingCounts]);

 // Organizations with at least one client where every client carries the reconciled mark
 // (the same client set the organization-clients page lists). One unreconciled client — or one
 // with no transactions yet — keeps the organization unmarked.
 const fullyReconciledOrgIds = useMemo(() => {
  const unreconciled = new Set<number>();
  const withClients = new Set<number>();
  for (const client of clients) {
   if (client.organizationId == null) continue;
   withClients.add(client.organizationId);
   if (!clientReconciledStatus.has(client.id)) unreconciled.add(client.organizationId);
  }
  return new Set([...withClients].filter((orgId) => !unreconciled.has(orgId)));
 }, [clients, clientReconciledStatus]);

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

 const clientCount = (organization: Organization) => clients.filter((client) => client.organizationId === organization.id).length;

 // Count-agreement word for the client tally. Arabic has its own number-agreement rule (1 →
 // singular عميل, 2–10 → plural عملاء, 0/11+ → singular tamyiz عميل); English/French just need
 // the ordinary singular (1) vs plural (else) split.
 const clientsCountWord = (n: number) =>
  language === 'ar' ? (n === 1 ? t('clients_count_one') : n >= 2 && n <= 10 ? t('clients_count_few') : t('clients_count_many')) : n === 1 ? t('clients_count_singular') : t('overview_clients');

 const renderBalanceChips = (orgBalances: ReturnType<typeof byOrg.get>) =>
  !orgBalances || orgBalances.length === 0 ? (
   <span className="text-xs text-fg-faint">—</span>
  ) : (
   <div className="flex flex-wrap gap-1">
    {orgBalances.map((group) => (
     <span
      key={group.key}
      className={`whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-xs font-semibold ${group.total >= 0 ? 'bg-good-bg text-good-text' : 'bg-bad-bg text-bad-text'}`}
     >
      {group.currencySymbol || group.currencyCode} {group.total.toLocaleString(numLocale, { maximumFractionDigits: 0 })}
     </span>
    ))}
   </div>
  );

 // The pending-count button (opens the org's clients-with-pending-rows list), the reconciled
 // check when every client in the organization is reconciled, or null — mirrors
 // OrganizationClientsSection's per-client version. The table cell substitutes an em-dash for
 // null; the mobile card shows nothing.
 const renderStatusMark = (organization: Organization) => {
  const pendingCount = orgPendingPricingCounts.get(organization.id) ?? 0;
  if (pendingCount > 0) {
   return (
    <button
     type="button"
     onClick={() => setPendingPricingModalOrgId(organization.id)}
     title={t(pendingCount === 1 ? 'ledger_pending_balance_note' : 'ledger_pending_balance_note_plural', { count: pendingCount })}
     className="cursor-pointer rounded bg-warn-bg px-1.5 py-0.5 font-mono text-xs font-semibold text-warn-text transition hover:bg-warn-bg"
    >
     {pendingCount}
    </button>
   );
  }
  if (fullyReconciledOrgIds.has(organization.id)) {
   return (
    <span
     title={t('organization_reconciled_mark')}
     aria-label={t('organization_reconciled_mark')}
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
  <section className={panelClassName}>
   <div className="flex items-start justify-between gap-4">
    <div>
     <h2 className="text-xl font-semibold">{t('organizations_title')}</h2>
    </div>
    <button
     type="button"
     onClick={onOpenSettings}
     title={t('open_in_settings')}
     aria-label={t('open_in_settings')}
     className="shrink-0 rounded border border-blue-200 p-2 text-accent transition hover:bg-accent-weak"
    >
     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
     </svg>
    </button>
   </div>

   {/* Desktop / tablet: the full table. Hidden below md, where the card list takes over. */}
   <div className={`${tableWrapClassName} hidden md:block`}>
    <table className="w-full text-sm">
     <thead className="bg-surface-hover text-fg-muted">
      <tr>
       <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('name')}</th>
       <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('overview_clients')}</th>
       <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('organizations_balance')}</th>
       <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('organization_pending_pricing')}</th>
      </tr>
     </thead>
     <tbody>
      {organizations.map((organization) => (
       <tr
        key={organization.id}
        className="border-t border-border align-top"
       >
        <td className="whitespace-nowrap px-4 py-3">{renderNameLink(organization)}</td>
        <td className="px-4 py-3 text-fg-muted">{clientCount(organization)}</td>
        <td className="px-4 py-3">{renderBalanceChips(byOrg.get(String(organization.id)))}</td>
        <td className="px-4 py-3">{renderStatusMark(organization) ?? <span className="text-xs text-fg-faint">—</span>}</td>
       </tr>
      ))}
      {organizations.length === 0 ? (
       <tr>
        <td
         className="px-4 py-6 text-fg-faint"
         colSpan={4}
        >
         {t('no_organizations')}
        </td>
       </tr>
      ) : null}
     </tbody>
    </table>
   </div>

   {/* Mobile (below md): each organization as a stacked card so everything fits with no
       horizontal scroll. */}
   <div className="mt-3 flex flex-col gap-2 md:hidden">
    {organizations.length === 0 ? (
     <p className="text-sm text-fg-faint">{t('no_organizations')}</p>
    ) : (
     organizations.map((organization) => {
      const count = clientCount(organization);
      return (
       <div
        key={organization.id}
        className="rounded border border-border bg-surface-2 p-3"
       >
        <div className="flex items-start justify-between gap-3">
         {renderNameLink(organization)}
         <span className="shrink-0 text-xs text-fg-muted">
          {count} {clientsCountWord(count)}
         </span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
         {renderBalanceChips(byOrg.get(String(organization.id)))}
         {renderStatusMark(organization)}
        </div>
       </div>
      );
     })
    )}
   </div>
  </section>
 );
}
