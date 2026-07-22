'use client';

import type { Dispatch, FormEvent, ReactNode, SetStateAction } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { panelClassName, tableWrapClassName } from '@/shared/styles';
import { formatAmountInput, normalizeDecimalInput } from '@/shared/utils/decimal';
import { emptyClientForm, createNewClientAccountDraft } from '@/features/clients/forms';
import { emptyOrganizationForm } from '@/features/organizations/forms';
import { useClientsStore } from '@/features/clients/store/clientsStore';
import type { Client, ClientAccount, Currency, Organization, OrganizationForm } from '@/shared/types';

type ClientsSectionProps = {
 clients: Client[];
 organizations: Organization[];
 clientAccounts: ClientAccount[];
 enabledCurrencies: Currency[];
 sortedClients: Client[];
 paginatedClients: Client[];
 clampedClientsPage: number;
 totalClientPages: number;
 accountsClient: Client | null;
 clientSortHeader: (key: 'name' | 'organization', label: string) => ReactNode;
 onClientSubmit: (event: FormEvent<HTMLFormElement>) => void;
 isSubmittingClient: boolean;
 onDeleteClient: (id: number) => void;
 onAddClientAccount: (clientId: number) => void;
 onDeleteClientAccount: (accountId: number) => void;
 onMoveAccountTransactions: (fromAccountId: number) => void;
 onSaveEditAccount: () => void;
 openClientLedger: (client: Client, origin?: 'clients' | 'organization-clients', accountId?: number | null) => void;
 setShowCreateOrgDialog: Dispatch<SetStateAction<boolean>>;
 setOrganizationForm: Dispatch<SetStateAction<OrganizationForm>>;
};

export default function ClientsSection({
 clients, organizations, clientAccounts, enabledCurrencies, sortedClients, paginatedClients,
 clampedClientsPage, totalClientPages, accountsClient, clientSortHeader,
 onClientSubmit, isSubmittingClient, onDeleteClient, onAddClientAccount, onDeleteClientAccount, onMoveAccountTransactions,
 onSaveEditAccount, openClientLedger, setShowCreateOrgDialog, setOrganizationForm,
}: ClientsSectionProps) {
 const { language, isRTL } = useLanguage();
 const { t } = useTranslation(language);
 // French uses 'en-US' grouping (comma thousands, period decimal) instead of the
 // official fr-FR narrow-no-break-space separator, which renders as near-invisible.
 const numLocale = language === 'fr' ? 'en-US' : language;
 const { clientForm, setClientForm, clientSearch, setClientSearch, setClientsPage, clientsPageSize, setClientsPageSize, newAccountCurrencyId, setNewAccountCurrencyId, newAccountStartingBalance, setNewAccountStartingBalance, newAccountBalanceType, setNewAccountBalanceType, showAddAccountForm, setShowAddAccountForm, editingAccountId, setEditingAccountId, editingAccountCurrencyId, setEditingAccountCurrencyId, editingAccountBalance, setEditingAccountBalance, editingAccountBalanceType, setEditingAccountBalanceType, moveTargetAccountId, setMoveTargetAccountId, isMovingAccount, openAccountOnCreate, setOpenAccountOnCreate, newClientAccountDrafts, setNewClientAccountDrafts } = useClientsStore();

 return (
  <section className="grid gap-6 xl:grid-cols-[380px_1fr]">
   <div className="flex flex-col gap-6">
    <form
     onSubmit={onClientSubmit}
     className={panelClassName}
    >
     <div className="flex items-center justify-between gap-3">
      <div>
       <h2 className="text-xl font-semibold">{clientForm.id ? t('update_client') : t('new_client')}</h2>
       <p className="mt-1 text-sm text-fg-muted">{t('clients_description')}</p>
      </div>
      {clientForm.id ? (
       <button
        type="button"
        onClick={() => {
         setClientForm(emptyClientForm());
         setOpenAccountOnCreate(true);
         setNewClientAccountDrafts([createNewClientAccountDraft()]);
        }}
        className="rounded border border-border-strong px-3 py-2 text-sm font-medium text-fg-muted hover:bg-surface-hover"
       >
        {t('cancel')}
       </button>
      ) : null}
     </div>

     <label className="mt-5 block text-sm font-medium">{t('client_name')}</label>
     <input
      value={clientForm.name}
      onChange={(event) => setClientForm((current) => ({ ...current, name: event.target.value }))}
      className="mt-2 w-full rounded border border-border-strong px-3 py-2 outline-none ring-blue-300 focus:ring"
      placeholder={t('client_name_placeholder')}
      required
     />

     <label className="mt-4 block text-sm font-medium">{t('client_organization')}</label>
     <select
      value={clientForm.organizationId ?? ''}
      onChange={(event) => {
       if (event.target.value === '__create__') {
        setOrganizationForm(emptyOrganizationForm());
        setShowCreateOrgDialog(true);
        return;
       }
       setClientForm((current) => ({
        ...current,
        organizationId: event.target.value ? Number(event.target.value) : null,
       }));
      }}
      className="mt-2 w-full rounded border border-border-strong px-3 py-2 outline-none ring-blue-300 focus:ring"
     >
      <option value="">{t('client_organization_placeholder')}</option>
      {organizations.map((organization) => (
       <option
        key={organization.id}
        value={organization.id}
       >
        {organization.name}
       </option>
      ))}
      <option value="__create__">{t('client_organization_create')}</option>
     </select>

     <label className="mt-4 block text-sm font-medium">{t('client_email')}</label>
     <input
      value={clientForm.email}
      onChange={(event) => setClientForm((current) => ({ ...current, email: event.target.value }))}
      className="mt-2 w-full rounded border border-border-strong px-3 py-2 outline-none ring-blue-300 focus:ring"
      placeholder={t('client_email_placeholder')}
     />

     <label className="mt-4 block text-sm font-medium">{t('client_phone')}</label>
     <input
      value={clientForm.phone}
      onChange={(event) => setClientForm((current) => ({ ...current, phone: event.target.value }))}
      className="mt-2 w-full rounded border border-border-strong px-3 py-2 outline-none ring-blue-300 focus:ring"
      placeholder={t('client_phone_placeholder')}
     />

     <label className="mt-4 block text-sm font-medium">{t('client_address')}</label>
     <textarea
      value={clientForm.address}
      onChange={(event) => setClientForm((current) => ({ ...current, address: event.target.value }))}
      className="mt-2 min-h-28 w-full rounded border border-border-strong px-3 py-2 outline-none ring-blue-300 focus:ring"
      placeholder={t('client_address_placeholder')}
     />

     <div className="mt-4 rounded border border-border bg-surface-2 p-4">
      <label className="flex items-center gap-2 text-sm font-medium text-fg">
       <input
        type="checkbox"
        checked={clientForm.excludeFromBalance}
        onChange={(event) => setClientForm((current) => ({ ...current, excludeFromBalance: event.target.checked }))}
        className="h-4 w-4 rounded border-border-strong text-accent focus:ring-blue-400"
       />
       {t('client_exclude_from_balance')}
      </label>
      <p className="mt-1 text-xs text-fg-faint">{t('client_exclude_from_balance_hint')}</p>
     </div>

     <div className="mt-4 rounded border border-border bg-surface-2 p-4">
      <label className="flex items-center gap-2 text-sm font-medium text-fg">
       <input
        type="checkbox"
        checked={clientForm.distributionCommissionEnabled}
        onChange={(event) => setClientForm((current) => ({ ...current, distributionCommissionEnabled: event.target.checked }))}
        className="h-4 w-4 rounded border-border-strong text-accent focus:ring-blue-400"
       />
       {t('client_distribution_commission_enabled')}
      </label>
      <p className="mt-1 text-xs text-fg-faint">{t('client_distribution_commission_enabled_hint')}</p>
     </div>

     {!clientForm.id ? (
      <div className="mt-4 rounded border border-border bg-surface-2 p-4">
       <label className="flex items-center gap-2 text-sm font-medium text-fg">
        <input
         type="checkbox"
         checked={openAccountOnCreate}
         onChange={(event) => {
          const checked = event.target.checked;
          setOpenAccountOnCreate(checked);
          if (!checked) {
           setNewClientAccountDrafts([createNewClientAccountDraft()]);
          }
         }}
         className="h-4 w-4 rounded border-border-strong text-accent focus:ring-blue-400"
        />
        {t('client_account_open')}
       </label>

       {openAccountOnCreate ? (
        <div className="mt-3 space-y-2">
         {newClientAccountDrafts.map((draft, index) => (
          <div
           key={`new-client-account-${index}`}
           className="rounded border border-border bg-surface p-3"
          >
           <div className="flex flex-col gap-2 sm:flex-row">
            <select
             value={draft.currencyId ?? ''}
             onChange={(event) => {
              const currencyId = event.target.value ? Number(event.target.value) : null;
              setNewClientAccountDrafts((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, currencyId } : row)));
             }}
             className="w-full min-w-0 flex-1 rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
            >
             <option value="">{t('client_account_currency_placeholder')}</option>
             {enabledCurrencies
              .filter((currency) => !newClientAccountDrafts.some((row, rowIndex) => rowIndex !== index && row.currencyId === currency.id))
              .map((currency) => (
               <option
                key={currency.id}
                value={currency.id}
               >
                {currency.code} - {currency.name}
               </option>
              ))}
            </select>
           </div>
           <div className="mt-2">
            <p className="text-xs font-medium text-fg-faint">{t('starting_balance')}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
             <div className="flex shrink-0 rounded border border-border-strong overflow-hidden text-xs font-semibold">
              <button
               type="button"
               onClick={() => setNewClientAccountDrafts((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, balanceType: 'debit' } : row)))}
               className={`px-3 py-2 transition ${draft.balanceType === 'debit' ? 'bg-red-600 text-white' : 'bg-surface text-fg-muted hover:bg-surface-hover'}`}
              >
               {t('balance_type_debit')}
              </button>
              <button
               type="button"
               onClick={() => setNewClientAccountDrafts((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, balanceType: 'credit' } : row)))}
               className={`px-3 py-2 transition ${draft.balanceType === 'credit' ? 'bg-emerald-600 text-white' : 'bg-surface text-fg-muted hover:bg-surface-hover'}`}
              >
               {t('balance_type_credit')}
              </button>
             </div>
             <input
              type="text"
              inputMode="decimal"
              value={formatAmountInput(draft.startingBalance)}
              onChange={(event) => {
               const nextBalance = normalizeDecimalInput(event.target.value);
               setNewClientAccountDrafts((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, startingBalance: nextBalance } : row)));
              }}
              placeholder="0"
              className="min-w-0 flex-1 rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring sm:max-w-36"
             />
            </div>
            <p className="mt-1 text-xs text-fg-faint">{t('balance_type_hint')}</p>
           </div>
           {newClientAccountDrafts.length > 1 ? (
            <button
             type="button"
             onClick={() => setNewClientAccountDrafts((current) => current.filter((_, rowIndex) => rowIndex !== index))}
             className="mt-2 inline-flex rounded border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-fg-muted transition hover:bg-surface-hover"
            >
             {t('client_account_remove')}
            </button>
           ) : null}
          </div>
         ))}

         <button
          type="button"
          onClick={() => setNewClientAccountDrafts((current) => [...current, createNewClientAccountDraft()])}
          className="inline-flex rounded border border-border bg-accent-weak px-4 py-2 text-sm font-semibold text-accent transition hover:bg-surface-hover"
         >
          {t('client_account_open_another')}
         </button>
        </div>
       ) : null}
      </div>
     ) : null}

     <button
      type="submit"
      disabled={isSubmittingClient}
      className="mt-6 w-full rounded bg-blue-700 px-4 py-2 font-medium text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
     >
      {isSubmittingClient ? t('saving') : clientForm.id ? t('update_client') : t('save_client')}
     </button>
    </form>
    {accountsClient ? (
     <div className={panelClassName}>
      <div className="flex items-center justify-between gap-3">
       <h2 className="text-lg font-semibold">
        {t('client_accounts_for')}: <span className="text-accent">{accountsClient.name}</span>
       </h2>
      </div>

      <div className="mt-4 space-y-2">
       {clientAccounts
        .filter((a) => a.clientId === accountsClient.id)
        .map((account) => {
         const isEditing = editingAccountId === account.id;
         return (
          <div
           key={account.id}
           className="rounded border border-border bg-surface"
          >
           {/* Row · click to edit */}
           <button
            type="button"
            className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-surface-hover transition"
            onClick={() => {
             setMoveTargetAccountId(null);
             if (isEditing) {
              setEditingAccountId(null);
             } else {
              const absBalance = Math.abs(account.startingBalance ?? 0);
              setEditingAccountId(account.id);
              setEditingAccountCurrencyId(account.currencyId);
              setEditingAccountBalance(String(absBalance));
              setEditingAccountBalanceType((account.startingBalance ?? 0) >= 0 ? 'credit' : 'debit');
              setShowAddAccountForm(false);
             }
            }}
           >
            <div className="flex items-center gap-3">
             <span className="font-mono font-semibold text-fg">{account.currencyCode}</span>
             <span className="text-sm text-fg-faint">{account.currencySymbol || ''}</span>
            </div>
            <div className="flex items-center gap-3">
             <span className={`text-sm font-semibold ${(account.startingBalance ?? 0) >= 0 ? 'text-good-text' : 'text-bad-text'}`}>
              {(account.startingBalance ?? 0).toLocaleString(numLocale, { maximumFractionDigits: 2 })}
             </span>
             <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`text-fg-faint transition-transform ${isEditing ? 'rotate-180' : ''}`}
             >
              <path d="m6 9 6 6 6-6" />
             </svg>
            </div>
           </button>

           {/* Inline edit form */}
           {isEditing && (
            <div className="border-t border-border bg-surface-2 px-4 py-4">
             <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint mb-3">{t('client_account_edit')}</p>
             <div className="flex flex-col gap-3">
              <select
               value={editingAccountCurrencyId ?? ''}
               onChange={(event) => setEditingAccountCurrencyId(event.target.value ? Number(event.target.value) : null)}
               className="w-full rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
              >
               <option value="">{t('client_account_currency_placeholder')}</option>
               {enabledCurrencies.map((cur) => (
                <option
                 key={cur.id}
                 value={cur.id}
                >
                 {cur.code} · {cur.name}
                </option>
               ))}
              </select>
              <div>
               <p className="text-xs font-medium text-fg-faint">{t('starting_balance')}</p>
               <div className="mt-1 flex flex-wrap items-center gap-2">
                <div className="flex shrink-0 rounded border border-border-strong overflow-hidden text-xs font-semibold">
                 <button
                  type="button"
                  onClick={() => setEditingAccountBalanceType('debit')}
                  className={`px-3 py-2 transition ${editingAccountBalanceType === 'debit' ? 'bg-red-600 text-white' : 'bg-surface text-fg-muted hover:bg-surface-hover'}`}
                 >
                  {t('balance_type_debit')}
                 </button>
                 <button
                  type="button"
                  onClick={() => setEditingAccountBalanceType('credit')}
                  className={`px-3 py-2 transition ${editingAccountBalanceType === 'credit' ? 'bg-emerald-600 text-white' : 'bg-surface text-fg-muted hover:bg-surface-hover'}`}
                 >
                  {t('balance_type_credit')}
                 </button>
                </div>
                <input
                 type="text"
                 inputMode="decimal"
                 value={editingAccountBalance}
                 onChange={(event) => setEditingAccountBalance(event.target.value.replace(/,/g, ''))}
                 onKeyDown={(event) => {
                  if (event.key === 'Enter' && editingAccountCurrencyId) void onSaveEditAccount();
                 }}
                 placeholder="0"
                 className="min-w-0 flex-1 rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring sm:max-w-36"
                />
               </div>
               <p className="mt-1 text-xs text-fg-faint">{t('balance_type_hint')}</p>
              </div>
              <div className="flex gap-2">
               <button
                type="button"
                onClick={() => void onSaveEditAccount()}
                disabled={!editingAccountCurrencyId}
                className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:opacity-40"
               >
                {t('client_account_save')}
               </button>
               <button
                type="button"
                onClick={() => onDeleteClientAccount(account.id)}
                className="rounded border border-red-200 px-4 py-2 text-sm font-semibold text-bad-text hover:bg-bad-bg transition"
               >
                {t('delete')}
               </button>
               <button
                type="button"
                onClick={() => setEditingAccountId(null)}
                className="rounded border border-border px-4 py-2 text-sm font-semibold text-fg-muted hover:bg-surface-hover transition"
               >
                {t('cancel')}
               </button>
              </div>

              {(() => {
               // Transactions can only be migrated between accounts of the SAME client
               // (e.g. Youssef EUR → Youssef USD), never to another client's account.
               const moveTargets = clientAccounts.filter((a) => a.id !== account.id && a.clientId === account.clientId);
               return (
                <div className="mt-4 border-t border-border pt-4">
                 <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('client_account_move_title')}</p>
                 <p className="mt-1 text-xs text-fg-faint">{t('client_account_move_hint')}</p>
                 {moveTargets.length === 0 ? (
                  <p className="mt-2 text-xs text-fg-faint">{t('client_account_move_no_targets')}</p>
                 ) : (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                   <select
                    value={moveTargetAccountId ?? ''}
                    onChange={(event) => setMoveTargetAccountId(event.target.value ? Number(event.target.value) : null)}
                    className="min-w-48 flex-1 rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                   >
                    <option value="">{t('client_account_move_select_placeholder')}</option>
                    {moveTargets.map((target) => (
                     <option
                      key={target.id}
                      value={target.id}
                     >
                      {target.currencyCode}
                      {target.currencySymbol ? ` (${target.currencySymbol})` : ''}
                     </option>
                    ))}
                   </select>
                   <button
                    type="button"
                    onClick={() => void onMoveAccountTransactions(account.id)}
                    disabled={!moveTargetAccountId || isMovingAccount}
                    className="rounded border border-amber-300 bg-warn-bg px-4 py-2 text-sm font-semibold text-warn-text transition hover:bg-warn-bg disabled:cursor-not-allowed disabled:opacity-40"
                   >
                    {t('client_account_move_action')}
                   </button>
                  </div>
                 )}
                </div>
               );
              })()}
             </div>
            </div>
           )}
          </div>
         );
        })}
       {clientAccounts.filter((a) => a.clientId === accountsClient.id).length === 0 ? <p className="text-sm text-fg-faint">{t('no_client_accounts')}</p> : null}
      </div>

      {/* Add account */}
      {!showAddAccountForm ? (
       <button
        type="button"
        onClick={() => {
         setShowAddAccountForm(true);
         setEditingAccountId(null);
        }}
        className="mt-4 rounded border border-dashed border-blue-400 px-4 py-2 text-sm font-semibold text-accent hover:bg-accent-weak transition"
       >
        {t('client_account_add_new')}
       </button>
      ) : (
       <div className="mt-4 rounded border border-border bg-surface-2 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint mb-3">{t('client_account_add_new')}</p>
        <div className="flex flex-col gap-3">
         <select
          value={newAccountCurrencyId ?? ''}
          onChange={(event) => setNewAccountCurrencyId(event.target.value ? Number(event.target.value) : null)}
          className="w-full rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
         >
          <option value="">{t('client_account_currency_placeholder')}</option>
          {enabledCurrencies
           .filter((cur) => !clientAccounts.some((a) => a.clientId === accountsClient.id && a.currencyId === cur.id))
           .map((cur) => (
            <option
             key={cur.id}
             value={cur.id}
            >
             {cur.code} · {cur.name}
            </option>
           ))}
         </select>
         <div>
          <p className="text-xs font-medium text-fg-faint">{t('starting_balance')}</p>
          <div className="mt-1 flex items-center gap-2">
           <div className="flex rounded border border-border-strong overflow-hidden text-xs font-semibold">
            <button
             type="button"
             onClick={() => setNewAccountBalanceType('debit')}
             className={`px-3 py-2 transition ${newAccountBalanceType === 'debit' ? 'bg-red-600 text-white' : 'bg-surface text-fg-muted hover:bg-surface-hover'}`}
            >
             {t('balance_type_debit')}
            </button>
            <button
             type="button"
             onClick={() => setNewAccountBalanceType('credit')}
             className={`px-3 py-2 transition ${newAccountBalanceType === 'credit' ? 'bg-emerald-600 text-white' : 'bg-surface text-fg-muted hover:bg-surface-hover'}`}
            >
             {t('balance_type_credit')}
            </button>
           </div>
           <input
            type="text"
            inputMode="decimal"
            value={newAccountStartingBalance}
            onChange={(event) => setNewAccountStartingBalance(event.target.value.replace(/,/g, ''))}
            onKeyDown={(event) => {
             if (event.key === 'Enter' && newAccountCurrencyId && accountsClient) void onAddClientAccount(accountsClient.id);
            }}
            placeholder="0"
            className="w-36 rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
           />
          </div>
          <p className="mt-1 text-xs text-fg-faint">{t('balance_type_hint')}</p>
         </div>
         <div className="flex gap-2">
          <button
           type="button"
           onClick={() => void onAddClientAccount(accountsClient.id)}
           disabled={!newAccountCurrencyId}
           className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
           {t('client_account_open')}
          </button>
          <button
           type="button"
           onClick={() => {
            setShowAddAccountForm(false);
            setNewAccountCurrencyId(null);
            setNewAccountStartingBalance('0');
            setNewAccountBalanceType('debit');
           }}
           className="rounded border border-border px-4 py-2 text-sm font-semibold text-fg-muted hover:bg-surface-hover transition"
          >
           {t('cancel')}
          </button>
         </div>
        </div>
       </div>
      )}
     </div>
    ) : null}
   </div>

   <div className="flex flex-col gap-4">
    <div className={panelClassName}>
     <div className="flex items-center justify-between gap-3">
      <h2 className="text-xl font-semibold">{t('clients_title')}</h2>
      <div className="relative">
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
        placeholder={t('search')}
        className="rounded border border-border-strong py-2 pl-8 pr-3 text-sm outline-none ring-blue-300 focus:ring"
       />
      </div>
     </div>
     <div className={tableWrapClassName}>
      <table className="w-full text-sm">
       <thead className="bg-surface-hover text-fg-muted">
        <tr>
         {clientSortHeader('name', t('name'))}
         {clientSortHeader('organization', t('client_organization'))}
         <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('client_accounts')}</th>
         <th className="px-4 py-3" />
        </tr>
       </thead>
       <tbody>
        {paginatedClients.map((client, index) => (
         <tr
          key={client.id}
          className={`border-t border-border align-top ${index % 2 === 1 ? 'bg-surface-2' : 'bg-surface'} hover:bg-surface-hover`}
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
          <td className="px-4 py-3">
           {(() => {
            const accts = clientAccounts.filter((a) => a.clientId === client.id);
            if (accts.length === 0) return <span className="text-xs text-fg-faint">—</span>;
            return (
             <div className="flex flex-wrap items-center gap-1">
              {accts.map((a) => (
               <span
                key={a.id}
                title={a.currencyCode}
                className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full border border-border-strong bg-surface-2 px-1.5 text-xs font-semibold text-fg-muted"
               >
                {a.currencySymbol || a.currencyCode}
               </span>
              ))}
             </div>
            );
           })()}
          </td>
          <td className="px-4 py-3">
           <div className="flex items-center gap-1">
            <button
             type="button"
             title={t('edit')}
             onClick={() => {
              setClientForm({
               id: client.id,
               organizationId: client.organizationId,
               name: client.name,
               email: client.email,
               phone: client.phone,
               address: client.address,
               excludeFromBalance: client.excludeFromBalance,
               distributionCommissionEnabled: client.distributionCommissionEnabled,
              });
              setOpenAccountOnCreate(false);
              setNewClientAccountDrafts([createNewClientAccountDraft()]);
             }}
             className="cursor-pointer rounded p-1.5 text-fg-faint transition hover:bg-surface-hover hover:text-fg"
            >
             <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4"
             >
              <path d="M5.433 13.917l1.262-3.155A4 4 0 017.58 9.42l6.92-6.918a2.121 2.121 0 013 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 01-.65-.65z" />
              <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0010 3H4.75A2.75 2.75 0 002 5.75v9.5A2.75 2.75 0 004.75 18h9.5A2.75 2.75 0 0017 15.25V10a.75.75 0 00-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5z" />
             </svg>
            </button>
            <button
             type="button"
             title={t('delete')}
             onClick={() => onDeleteClient(client.id)}
             className="cursor-pointer rounded p-1.5 text-red-400 transition hover:bg-bad-bg hover:text-bad-text"
            >
             <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4"
             >
              <path
               fillRule="evenodd"
               d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
               clipRule="evenodd"
              />
             </svg>
            </button>
           </div>
          </td>
         </tr>
        ))}
        {clients.length === 0 ? (
         <tr>
          <td
           className="px-4 py-6 text-fg-faint"
           colSpan={4}
          >
           {t('no_clients')}
          </td>
         </tr>
        ) : sortedClients.length === 0 ? (
         <tr>
          <td
           className="px-4 py-6 text-fg-faint"
           colSpan={4}
          >
           {t('no_search_results')}
          </td>
         </tr>
        ) : null}
       </tbody>
      </table>
     </div>
     {sortedClients.length > clientsPageSize ? (
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
       <div className="text-xs text-fg-muted">
        {(clampedClientsPage - 1) * clientsPageSize + 1}–{Math.min(sortedClients.length, clampedClientsPage * clientsPageSize)} {t('pagination_of')} {sortedClients.length}
       </div>
       <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-fg-faint">{t('pagination_per_page')}</span>
        <select
         value={clientsPageSize}
         onChange={(event) => setClientsPageSize(Number(event.target.value))}
         className="rounded border border-border-strong px-1.5 py-1 text-xs outline-none ring-blue-300 focus:ring"
        >
         <option value={25}>25</option>
         <option value={50}>50</option>
         <option value={100}>100</option>
        </select>
        <button
         type="button"
         onClick={() => setClientsPage((current) => Math.max(1, Math.min(current, totalClientPages) - 1))}
         disabled={clampedClientsPage <= 1}
         className="rounded border border-border-strong px-2 py-1 text-xs font-semibold text-fg-muted transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
         {t('pagination_prev')}
        </button>
        <input
         key={clampedClientsPage}
         type="number"
         min={1}
         max={totalClientPages}
         defaultValue={clampedClientsPage}
         onBlur={(event) => {
          const n = parseInt(event.target.value, 10);
          if (n >= 1 && n <= totalClientPages) setClientsPage(n);
          else event.target.value = String(clampedClientsPage);
         }}
         onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
         }}
         className="w-14 rounded border border-border-strong px-1.5 py-1 text-center text-xs outline-none ring-blue-300 focus:ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <span className="text-xs text-fg-faint">/ {totalClientPages}</span>
        <button
         type="button"
         onClick={() => setClientsPage((current) => Math.min(totalClientPages, Math.min(current, totalClientPages) + 1))}
         disabled={clampedClientsPage >= totalClientPages}
         className="rounded border border-border-strong px-2 py-1 text-xs font-semibold text-fg-muted transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
         {t('pagination_next')}
        </button>
       </div>
      </div>
     ) : null}
    </div>
   </div>
  </section>
 );
}
