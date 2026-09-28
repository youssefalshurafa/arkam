'use client';

import { useMemo, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { panelClassName, tableWrapClassName } from '@/shared/styles';
import { useClientsStore } from '@/features/clients/store/clientsStore';
import { resolveWriteOffThreshold, writeOffMarginMap } from '@/shared/utils/accountBalances';
import type { Client, ClientAccount, Section, SettingsTab, WriteOffMargin } from '@/shared/types';
import type { ClientOrgGroup } from '@/features/clients/utils/clientsView';
import type { ClientBalanceEntry } from '@/features/clients/utils/clientBalances';
import { isZeroMoney } from '@/shared/utils/money';
import { clientMatchesBalanceRange, emptyBalanceRangeFilter, isBalanceRangeActive, type BalanceDirection } from '@/features/clients/utils/clientBalanceFilter';

type ClientsReadOnlyProps = {
 clients: Client[];
 clientAccounts: ClientAccount[];
 sortedClients: Client[];
 clientsByOrganization: ClientOrgGroup[];
 clientPageBalances: Map<number, ClientBalanceEntry[]>;
 writeOffMargins: WriteOffMargin[];
 clientSortHeader: (key: 'name' | 'organization', label: string) => ReactNode;
 openClientLedger: (client: Client, origin?: 'clients' | 'organization-clients', accountId?: number | null) => void;
 onClientsOrgDrop: (targetKey: string) => void;
 navigateToSection: (section: Section) => void;
 setSettingsTab: Dispatch<SetStateAction<SettingsTab>>;
 selectedClientForAccounts: Client | null;
 setSelectedClientForAccounts: Dispatch<SetStateAction<Client | null>>;
 onWriteOffBalance: (accountId: number, balance: number) => void;
};

export default function ClientsReadOnly({
 clients, clientAccounts, sortedClients, clientsByOrganization, clientPageBalances, writeOffMargins,
 clientSortHeader, openClientLedger, onClientsOrgDrop, navigateToSection, setSettingsTab,
 selectedClientForAccounts, setSelectedClientForAccounts, onWriteOffBalance,
}: ClientsReadOnlyProps) {
 const { language, isRTL } = useLanguage();
 const { t } = useTranslation(language);
 const writeOffMarginByCurrency = useMemo(() => writeOffMarginMap(writeOffMargins), [writeOffMargins]);
 // French uses 'en-US' grouping (comma thousands, period decimal) instead of the
 // official fr-FR narrow-no-break-space separator, which renders as near-invisible.
 const numLocale = language === 'fr' ? 'en-US' : language;
 const { clientSearch, setClientSearch, clientBalanceFilter, setClientBalanceFilter, clientsGroupByOrg, setClientsGroupByOrg, draggedOrgKey, setDraggedOrgKey, dragOverOrgKey, setDragOverOrgKey } = useClientsStore();
 const rangeActive = isBalanceRangeActive(clientBalanceFilter);
 // Opens by itself when a range is already set (it lives in the store, so it survives leaving
 // the page and coming back) — a filter that hides clients must never be applied out of sight.
 const [advancedOpen, setAdvancedOpen] = useState(rangeActive);

 // The advanced balance range is applied here, on top of the search box's own filtering
 // (sortedClients), and only on this page — Settings > Clients shares sortedClients but has no
 // range controls, so it must not be narrowed by one it can't show.
 const visibleClients = useMemo(
  () => (rangeActive ? sortedClients.filter((client) => clientMatchesBalanceRange(clientPageBalances.get(client.id) ?? [], clientBalanceFilter)) : sortedClients),
  [sortedClients, clientPageBalances, clientBalanceFilter, rangeActive],
 );
 const visibleGroups = useMemo(() => {
  if (!rangeActive) return clientsByOrganization;
  const visibleIds = new Set(visibleClients.map((client) => client.id));
  return clientsByOrganization
   .map((group) => ({ ...group, clients: group.clients.filter((client) => visibleIds.has(client.id)) }))
   .filter((group) => group.clients.length > 0);
 }, [clientsByOrganization, visibleClients, rangeActive]);

 // Only currencies someone on this page actually holds are worth offering.
 const balanceCurrencies = useMemo(() => {
  const seen = new Map<number, string>();
  for (const client of clients) {
   for (const entry of clientPageBalances.get(client.id) ?? []) {
    if (!seen.has(entry.currencyId)) seen.set(entry.currencyId, entry.currencyCode);
   }
  }
  return [...seen.entries()].map(([id, code]) => ({ id, code })).sort((a, b) => a.code.localeCompare(b.code));
 }, [clients, clientPageBalances]);

 const updateBalanceFilter = (patch: Partial<typeof clientBalanceFilter>) => setClientBalanceFilter((current) => ({ ...current, ...patch }));
 const directionOptions: { key: BalanceDirection; label: string }[] = [
  { key: 'any', label: t('clients_balance_direction_any') },
  { key: 'owes_us', label: t('adjustment_direction_debit') },
  { key: 'we_owe', label: t('adjustment_direction_credit') },
 ];
 const rangeInputClassName = 'w-28 rounded border border-border-strong bg-surface px-2 py-1.5 text-sm text-fg outline-none ring-blue-300 focus:ring';

 // Per-client balance chips (with the inline write-off button for near-zero balances), shared
 // by the list-view table cell and its mobile card. Plain render function (not a component).
 const renderBalanceChips = (clientId: number) => (
  <div className="flex flex-wrap gap-1">
   {(clientPageBalances.get(clientId) ?? []).map(({ accountId, currencyId, currencyCode, currencySymbol, balance }) => (
    <span
     key={accountId}
     className="inline-flex items-center gap-1"
    >
     <span className={`rounded px-1.5 py-0.5 font-mono text-xs font-semibold ${balance >= 0 ? 'bg-good-bg text-good-text' : 'bg-bad-bg text-bad-text'}`}>
      {currencySymbol || currencyCode} {balance.toLocaleString(numLocale, { maximumFractionDigits: 0 })}
     </span>
     {!isZeroMoney(balance) && Math.abs(balance) <= resolveWriteOffThreshold(currencyId, writeOffMarginByCurrency) ? (
      <button
       type="button"
       title={t('write_off_button')}
       onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onWriteOffBalance(accountId, balance);
       }}
       className="rounded border border-amber-300 bg-warn-bg px-1 py-0.5 text-[10px] font-semibold text-warn-text transition hover:bg-warn-bg"
      >
       {t('write_off_button')}
      </button>
     ) : null}
    </span>
   ))}
  </div>
 );

 return (
  <section className="flex flex-col gap-4">
   <div className={panelClassName}>
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
     <h2 className="text-xl font-semibold">{t('clients_title')}</h2>
     <div className="flex flex-wrap items-center gap-2">
      {/* Full-width row of its own on phones: beside three buttons it would shrink to nothing. */}
      <div className="relative w-full min-w-0 sm:w-auto sm:flex-none">
       <svg
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
       >
        <circle
         cx="11"
         cy="11"
         r="8"
        />
        <line
         x1="21"
         y1="21"
         x2="16.65"
         y2="16.65"
        />
       </svg>
       <input
        type="search"
        value={clientSearch}
        onChange={(e) => setClientSearch(e.target.value)}
        placeholder={t('clients_search_placeholder')}
        title={t('clients_search_hint')}
        className="w-full rounded border border-border-strong py-2 pl-8 pr-3 text-sm outline-none ring-blue-300 focus:ring sm:w-56"
       />
      </div>
      <button
       type="button"
       onClick={() => setAdvancedOpen((open) => !open)}
       aria-expanded={advancedOpen}
       className={`inline-flex shrink-0 items-center gap-1.5 rounded border px-3 py-2 text-sm font-semibold transition ${
        rangeActive ? 'border-accent bg-accent-weak text-accent' : 'border-border-strong text-fg-muted hover:bg-surface-hover'
       }`}
      >
       {t('tx_adv_toggle')}
       {rangeActive ? <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden /> : null}
       <span className="text-xs" aria-hidden>
        {advancedOpen ? '▲' : '▼'}
       </span>
      </button>
      <button
       type="button"
       onClick={() => setClientsGroupByOrg((current) => !current)}
       className="shrink-0 rounded border border-border-strong px-3 py-2 text-sm font-semibold text-fg-muted transition hover:bg-surface-hover"
      >
       {clientsGroupByOrg ? t('clients_view_as_list') : t('clients_group_by_org')}
      </button>
      <button
       type="button"
       onClick={() => {
        setSettingsTab('clients');
        navigateToSection('settings');
       }}
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
    </div>

    {advancedOpen ? (
     <div className="mb-4 rounded border border-border bg-surface-2 p-3">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
       <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-fg-muted">{t('clients_balance_range')}</span>
        <div className="flex items-center gap-2">
         <input
          type="text"
          inputMode="decimal"
          dir="ltr"
          value={clientBalanceFilter.min}
          onChange={(e) => updateBalanceFilter({ min: e.target.value })}
          placeholder={t('clients_balance_min_placeholder')}
          aria-label={t('clients_balance_min_placeholder')}
          className={rangeInputClassName}
         />
         <span className="text-sm text-fg-faint">{t('clients_balance_and')}</span>
         <input
          type="text"
          inputMode="decimal"
          dir="ltr"
          value={clientBalanceFilter.max}
          onChange={(e) => updateBalanceFilter({ max: e.target.value })}
          placeholder={t('clients_balance_max_placeholder')}
          aria-label={t('clients_balance_max_placeholder')}
          className={rangeInputClassName}
         />
        </div>
       </div>
       <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-fg-muted">{t('currency')}</span>
        <select
         value={clientBalanceFilter.currencyId ?? ''}
         onChange={(e) => updateBalanceFilter({ currencyId: e.target.value ? Number(e.target.value) : null })}
         className="rounded border border-border-strong bg-surface px-2 py-1.5 text-sm text-fg outline-none ring-blue-300 focus:ring"
        >
         <option value="">{t('clients_balance_currency_any')}</option>
         {balanceCurrencies.map((currency) => (
          <option key={currency.id} value={currency.id}>
           {currency.code}
          </option>
         ))}
        </select>
       </label>
       <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-fg-muted">{t('clients_balance_direction')}</span>
        <div className="inline-flex flex-wrap overflow-hidden rounded border border-border-strong text-sm">
         {directionOptions.map((option) => (
          <button
           key={option.key}
           type="button"
           onClick={() => updateBalanceFilter({ direction: option.key })}
           aria-pressed={clientBalanceFilter.direction === option.key}
           className={`px-3 py-1.5 transition ${
            clientBalanceFilter.direction === option.key ? 'bg-accent text-accent-contrast' : 'bg-surface text-fg-muted hover:bg-surface-hover'
           }`}
          >
           {option.label}
          </button>
         ))}
        </div>
       </div>
       {rangeActive ? (
        <button
         type="button"
         onClick={() => setClientBalanceFilter(emptyBalanceRangeFilter())}
         className="rounded border border-border-strong px-3 py-1.5 text-sm font-semibold text-fg-muted transition hover:bg-surface-hover"
        >
         {t('clients_balance_clear')}
        </button>
       ) : null}
      </div>
      <p className="mt-2 text-xs text-fg-faint">{t('clients_balance_range_hint')}</p>
      {rangeActive ? (
       <p className="mt-1 text-xs font-semibold text-fg-muted">{t('clients_balance_match_count', { count: visibleClients.length, total: sortedClients.length })}</p>
      ) : null}
     </div>
    ) : null}

    {clients.length === 0 ? (
     <p className="px-1 py-6 text-fg-faint">{t('no_clients')}</p>
    ) : visibleClients.length === 0 ? (
     <p className="px-1 py-6 text-fg-faint">{t('no_search_results')}</p>
    ) : clientsGroupByOrg ? (
     <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {visibleGroups.map((group) => {
       const orgKey = group.id == null ? '__unassigned__' : String(group.id);
       return (
        <div
         key={orgKey}
         draggable
         onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          setDraggedOrgKey(orgKey);
         }}
         onDragOver={(event) => {
          event.preventDefault();
          setDragOverOrgKey(orgKey);
         }}
         onDragLeave={() => setDragOverOrgKey((prev) => (prev === orgKey ? null : prev))}
         onDrop={() => onClientsOrgDrop(orgKey)}
         onDragEnd={() => {
          setDraggedOrgKey(null);
          setDragOverOrgKey(null);
         }}
         className={`flex flex-col overflow-hidden rounded border bg-surface transition ${
          dragOverOrgKey === orgKey && draggedOrgKey !== orgKey ? 'border-blue-500 ring-2 ring-blue-300' : 'border-border'
         } ${draggedOrgKey === orgKey ? 'opacity-50' : ''}`}
        >
         <div
          className="flex cursor-move items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2.5"
          title={t('clients_drag_org_hint')}
         >
          <span className="flex min-w-0 items-center gap-1.5">
           <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden
            className="shrink-0 text-fg-faint"
           >
            <circle
             cx="9"
             cy="5"
             r="1.5"
            />
            <circle
             cx="15"
             cy="5"
             r="1.5"
            />
            <circle
             cx="9"
             cy="12"
             r="1.5"
            />
            <circle
             cx="15"
             cy="12"
             r="1.5"
            />
            <circle
             cx="9"
             cy="19"
             r="1.5"
            />
            <circle
             cx="15"
             cy="19"
             r="1.5"
            />
           </svg>
           <h3 className="truncate font-semibold text-fg">{group.name}</h3>
          </span>
          <span className="shrink-0 rounded-full bg-surface-hover px-2 py-0.5 text-xs font-semibold text-fg-muted">{group.clients.length}</span>
         </div>
         <ul className="divide-y divide-border">
          {group.clients.map((client) => (
           <li
            key={client.id}
            className="flex items-center justify-between gap-2 px-4 py-2.5"
           >
            <a
             href={`/clients/${client.id}`}
             onClick={(e) => {
              if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
              e.preventDefault();
              openClientLedger(client, 'clients');
             }}
             className="min-w-0 flex-1 truncate text-left font-medium text-fg transition hover:text-accent"
            >
             {client.name}
            </a>
            <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
             {(clientPageBalances.get(client.id) ?? []).map(({ accountId, currencyId, currencyCode, currencySymbol, balance }) => (
              <span
               key={accountId}
               className="inline-flex items-center gap-1"
              >
               <span className={`rounded px-1.5 py-0.5 font-mono text-xs font-semibold ${balance >= 0 ? 'bg-good-bg text-good-text' : 'bg-bad-bg text-bad-text'}`}>
                {currencySymbol || currencyCode} {balance.toLocaleString(numLocale, { maximumFractionDigits: 0 })}
               </span>
               {!isZeroMoney(balance) && Math.abs(balance) <= resolveWriteOffThreshold(currencyId, writeOffMarginByCurrency) ? (
                <button
                 type="button"
                 title={t('write_off_button')}
                 onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onWriteOffBalance(accountId, balance);
                 }}
                 className="rounded border border-amber-300 bg-warn-bg px-1 py-0.5 text-[10px] font-semibold text-warn-text transition hover:bg-warn-bg"
                >
                 {t('write_off_button')}
                </button>
               ) : null}
              </span>
             ))}
            </span>
           </li>
          ))}
         </ul>
        </div>
       );
      })}
     </div>
    ) : (
     <>
      {/* Desktop / tablet: the full table. Hidden below md, where the card list takes over. */}
      <div className={`${tableWrapClassName} hidden md:block`}>
       <table className="w-full text-sm">
        <thead className="bg-surface-hover text-fg-muted">
         <tr>
          {clientSortHeader('name', t('name'))}
          {clientSortHeader('organization', t('client_organization'))}
          <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('client_accounts')}</th>
          <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('client_page_current_balance')}</th>
         </tr>
        </thead>
        <tbody>
         {visibleClients.map((client) => (
          <tr
           key={client.id}
           className="border-t border-border align-top"
          >
           <td className="px-4 py-3 font-medium text-fg">
            <a
             href={`/clients/${client.id}`}
             onClick={(e) => {
              if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
              e.preventDefault();
              openClientLedger(client, 'clients');
             }}
             className="cursor-pointer text-left text-fg transition hover:text-accent"
            >
             {client.name}
            </a>
           </td>
           <td className="px-4 py-3 text-fg-muted">{client.organizationName || t('unassigned')}</td>
           <td className="px-4 py-3 text-fg-muted">{client.accountCount}</td>
           <td className="px-4 py-3">{renderBalanceChips(client.id)}</td>
          </tr>
         ))}
        </tbody>
       </table>
      </div>

      {/* Mobile (below md): each client as a stacked card so everything fits with no
          horizontal scroll. */}
      <div className="mt-3 flex flex-col gap-2 md:hidden">
       {visibleClients.map((client) => (
        <div
         key={client.id}
         className="rounded border border-border bg-surface-2 p-3"
        >
         <div className="flex items-start justify-between gap-3">
          <a
           href={`/clients/${client.id}`}
           onClick={(e) => {
            if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
            e.preventDefault();
            openClientLedger(client, 'clients');
           }}
           className="min-w-0 flex-1 truncate font-medium text-fg transition hover:text-accent"
          >
           {client.name}
          </a>
          <span className="shrink-0 text-xs text-fg-faint">{client.organizationName || t('unassigned')}</span>
         </div>
         <div className="mt-2">{renderBalanceChips(client.id)}</div>
        </div>
       ))}
      </div>
     </>
    )}
   </div>

   {selectedClientForAccounts ? (
    <div className={panelClassName}>
     <div className="flex items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">
       {t('client_accounts_for')}: <span className="text-accent">{selectedClientForAccounts.name}</span>
      </h2>
      <button
       type="button"
       onClick={() => setSelectedClientForAccounts(null)}
       className="rounded border border-border-strong px-3 py-1.5 text-xs font-semibold text-fg-muted hover:bg-surface-hover"
      >
       {t('cancel')}
      </button>
     </div>

     <div className="mt-4 space-y-2">
      {clientAccounts
       .filter((a) => a.clientId === selectedClientForAccounts.id)
       .map((account) => (
        <div
         key={account.id}
         className="flex items-center justify-between rounded border border-border px-4 py-3"
        >
         <span className="font-mono font-semibold text-fg">{account.currencySymbol || account.currencyCode}</span>
        </div>
       ))}
      {clientAccounts.filter((a) => a.clientId === selectedClientForAccounts.id).length === 0 ? <p className="text-sm text-fg-faint">{t('no_client_accounts')}</p> : null}
     </div>
    </div>
   ) : null}
  </section>
 );
}
