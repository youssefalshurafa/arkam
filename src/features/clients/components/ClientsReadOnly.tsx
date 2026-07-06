'use client';

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { panelClassName, tableWrapClassName } from '@/shared/styles';
import { useClientsStore } from '@/features/clients/store/clientsStore';
import { SMALL_BALANCE_THRESHOLD } from '@/shared/utils/accountBalances';
import type { Client, ClientAccount, Section, SettingsTab } from '@/shared/types';
import type { ClientOrgGroup } from '@/features/clients/utils/clientsView';
import type { ClientBalanceEntry } from '@/features/clients/utils/clientBalances';

type ClientsReadOnlyProps = {
 clients: Client[];
 clientAccounts: ClientAccount[];
 sortedClients: Client[];
 clientsByOrganization: ClientOrgGroup[];
 clientPageBalances: Map<number, ClientBalanceEntry[]>;
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
 clients, clientAccounts, sortedClients, clientsByOrganization, clientPageBalances,
 clientSortHeader, openClientLedger, onClientsOrgDrop, navigateToSection, setSettingsTab,
 selectedClientForAccounts, setSelectedClientForAccounts, onWriteOffBalance,
}: ClientsReadOnlyProps) {
 const { language, isRTL } = useLanguage();
 const { t } = useTranslation(language);
 const numLocale = language === 'fr' ? 'fr-FR' : language;
 const { clientSearch, setClientSearch, clientsGroupByOrg, setClientsGroupByOrg, draggedOrgKey, setDraggedOrgKey, dragOverOrgKey, setDragOverOrgKey } = useClientsStore();

 return (
  <section className="flex flex-col gap-4">
   <div className={panelClassName}>
    <div className="mb-4 flex items-start justify-between gap-4">
     <div>
      <h2 className="text-xl font-semibold">{t('clients_title')}</h2>
     </div>
     <div className="flex items-center gap-2">
      <div className="relative">
       <svg
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
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
        placeholder={t('search')}
        className="rounded border border-slate-300 py-2 pl-8 pr-3 text-sm outline-none ring-blue-300 focus:ring"
       />
      </div>
      <button
       type="button"
       onClick={() => setClientsGroupByOrg((current) => !current)}
       className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
      >
       {clientsGroupByOrg ? t('clients_view_as_list') : t('clients_group_by_org')}
      </button>
      <button
       type="button"
       onClick={() => {
        setSettingsTab('clients');
        navigateToSection('settings');
       }}
       className="rounded border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
      >
       {t('open_in_settings')}
      </button>
     </div>
    </div>

    {clients.length === 0 ? (
     <p className="px-1 py-6 text-slate-500">{t('no_clients')}</p>
    ) : sortedClients.length === 0 ? (
     <p className="px-1 py-6 text-slate-500">{t('no_search_results')}</p>
    ) : clientsGroupByOrg ? (
     <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {clientsByOrganization.map((group) => {
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
         className={`flex flex-col overflow-hidden rounded border bg-white transition ${
          dragOverOrgKey === orgKey && draggedOrgKey !== orgKey ? 'border-blue-500 ring-2 ring-blue-300' : 'border-slate-200'
         } ${draggedOrgKey === orgKey ? 'opacity-50' : ''}`}
        >
         <div
          className="flex cursor-move items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5"
          title={t('clients_drag_org_hint')}
         >
          <span className="flex min-w-0 items-center gap-1.5">
           <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden
            className="shrink-0 text-slate-400"
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
           <h3 className="truncate font-semibold text-slate-800">{group.name}</h3>
          </span>
          <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">{group.clients.length}</span>
         </div>
         <ul className="divide-y divide-slate-100">
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
             className="min-w-0 flex-1 truncate text-left font-medium text-slate-900 transition hover:text-blue-700"
            >
             {client.name}
            </a>
            <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
             {(clientPageBalances.get(client.id) ?? []).map(({ accountId, currencyCode, currencySymbol, balance }) => (
              <span
               key={accountId}
               className="inline-flex items-center gap-1"
              >
               <span className={`rounded px-1.5 py-0.5 font-mono text-xs font-semibold ${balance >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                {currencySymbol || currencyCode} {balance.toLocaleString(numLocale, { maximumFractionDigits: 0 })}
               </span>
               {balance !== 0 && Math.abs(balance) <= SMALL_BALANCE_THRESHOLD ? (
                <button
                 type="button"
                 title={t('write_off_button')}
                 onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onWriteOffBalance(accountId, balance);
                 }}
                 className="rounded border border-amber-300 bg-amber-50 px-1 py-0.5 text-[10px] font-semibold text-amber-800 transition hover:bg-amber-100"
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
     <div className={tableWrapClassName}>
      <table className="w-full text-sm">
       <thead className="bg-slate-100 text-slate-700">
        <tr>
         {clientSortHeader('name', t('name'))}
         {clientSortHeader('organization', t('client_organization'))}
         <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('client_accounts')}</th>
         <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('client_page_current_balance')}</th>
        </tr>
       </thead>
       <tbody>
        {sortedClients.map((client) => (
         <tr
          key={client.id}
          className="border-t border-slate-200 align-top"
         >
          <td className="px-4 py-3 font-medium text-slate-900">
           <a
            href={`/clients/${client.id}`}
            onClick={(e) => {
             if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
             e.preventDefault();
             openClientLedger(client, 'clients');
            }}
            className="cursor-pointer text-left text-slate-900 transition hover:text-blue-700"
           >
            {client.name}
           </a>
          </td>
          <td className="px-4 py-3 text-slate-600">{client.organizationName || t('unassigned')}</td>
          <td className="px-4 py-3 text-slate-600">{client.accountCount}</td>
          <td className="px-4 py-3">
           <div className="flex flex-wrap gap-1">
            {(clientPageBalances.get(client.id) ?? []).map(({ accountId, currencyCode, currencySymbol, balance }) => (
             <span
              key={accountId}
              className="inline-flex items-center gap-1"
             >
              <span className={`rounded px-1.5 py-0.5 font-mono text-xs font-semibold ${balance >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
               {currencySymbol || currencyCode} {balance.toLocaleString(numLocale, { maximumFractionDigits: 0 })}
              </span>
              {balance !== 0 && Math.abs(balance) <= SMALL_BALANCE_THRESHOLD ? (
               <button
                type="button"
                title={t('write_off_button')}
                onClick={(event) => {
                 event.preventDefault();
                 event.stopPropagation();
                 onWriteOffBalance(accountId, balance);
                }}
                className="rounded border border-amber-300 bg-amber-50 px-1 py-0.5 text-[10px] font-semibold text-amber-800 transition hover:bg-amber-100"
               >
                {t('write_off_button')}
               </button>
              ) : null}
             </span>
            ))}
           </div>
          </td>
         </tr>
        ))}
       </tbody>
      </table>
     </div>
    )}
   </div>

   {selectedClientForAccounts ? (
    <div className={panelClassName}>
     <div className="flex items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">
       {t('client_accounts_for')}: <span className="text-blue-700">{selectedClientForAccounts.name}</span>
      </h2>
      <button
       type="button"
       onClick={() => setSelectedClientForAccounts(null)}
       className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
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
         className="flex items-center justify-between rounded border border-slate-200 px-4 py-3"
        >
         <span className="font-mono font-semibold text-slate-800">{account.currencySymbol || account.currencyCode}</span>
        </div>
       ))}
      {clientAccounts.filter((a) => a.clientId === selectedClientForAccounts.id).length === 0 ? <p className="text-sm text-slate-500">{t('no_client_accounts')}</p> : null}
     </div>
    </div>
   ) : null}
  </section>
 );
}
