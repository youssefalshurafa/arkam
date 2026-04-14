'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';

type Account = {
 id: number;
 code: string;
 name: string;
 createdAt: string;
};

type DbInfo = {
 dbPath: string;
};

type Organization = {
 id: number;
 name: string;
 email: string;
 phone: string;
 address: string;
 taxId: string;
 createdAt: string;
 updatedAt: string;
};

type OrganizationForm = {
 id?: number;
 name: string;
 email: string;
 phone: string;
 address: string;
 taxId: string;
};

type Client = {
 id: number;
 organizationId: number | null;
 organizationName: string | null;
 name: string;
 email: string;
 phone: string;
 address: string;
 createdAt: string;
 updatedAt: string;
};

type ClientForm = {
 id?: number;
 organizationId: number | null;
 name: string;
 email: string;
 phone: string;
 address: string;
};

type Section = 'overview' | 'organizations' | 'clients' | 'accounts';

const allowedSections: Section[] = ['overview', 'organizations', 'clients', 'accounts'];

function getSectionFromHash(hash: string): Section {
 const normalized = hash.replace('#', '');
 return allowedSections.includes(normalized as Section) ? (normalized as Section) : 'overview';
}

const emptyOrganizationForm = (): OrganizationForm => ({
 name: '',
 email: '',
 phone: '',
 address: '',
 taxId: '',
});

const emptyClientForm = (): ClientForm => ({
 organizationId: null,
 name: '',
 email: '',
 phone: '',
 address: '',
});

export default function Home() {
 const { language, setLanguage, isRTL } = useLanguage();
 const { t } = useTranslation(language);
 const [section, setSection] = useState<Section>('overview');
 const [dbInfo, setDbInfo] = useState<DbInfo | null>(null);
 const [accounts, setAccounts] = useState<Account[]>([]);
 const [organizations, setOrganizations] = useState<Organization[]>([]);
 const [clients, setClients] = useState<Client[]>([]);
 const [code, setCode] = useState('');
 const [name, setName] = useState('');
 const [organizationForm, setOrganizationForm] = useState<OrganizationForm>(emptyOrganizationForm);
 const [clientForm, setClientForm] = useState<ClientForm>(emptyClientForm);
 const [error, setError] = useState('');

 async function loadData() {
  if (!window.accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  try {
   const [db, accountRows, organizationRows, clientRows] = await Promise.all([
    window.accountingApi.getDbInfo(),
    window.accountingApi.listAccounts(),
    window.accountingApi.listOrganizations(),
    window.accountingApi.listClients(),
   ]);

   setDbInfo(db);
   setAccounts(accountRows);
   setOrganizations(organizationRows);
   setClients(clientRows);
   setError('');
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_load'));
  }
 }

 useEffect(() => {
  const timeoutId = window.setTimeout(() => {
   void loadData();
  }, 0);

  return () => {
   window.clearTimeout(timeoutId);
  };
 }, []);

 useEffect(() => {
  const applyHashSection = () => {
   setSection(getSectionFromHash(window.location.hash));
  };

  applyHashSection();
  window.addEventListener('hashchange', applyHashSection);

  return () => {
   window.removeEventListener('hashchange', applyHashSection);
  };
 }, []);

 function navigateToSection(nextSection: Section) {
  setSection(nextSection);
  window.history.replaceState(null, '', `#${nextSection}`);
 }

 async function onSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  if (!window.accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  if (!code.trim() || !name.trim()) {
   setError(t('error_required'));
   return;
  }

  try {
   await window.accountingApi.addAccount(code.trim(), name.trim());
   setCode('');
   setName('');
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_save'));
  }
 }

 async function onOrganizationSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  if (!window.accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  if (!organizationForm.name.trim()) {
   setError(t('organization_required'));
   return;
  }

  try {
   if (organizationForm.id) {
    await window.accountingApi.updateOrganization(organizationForm);
   } else {
    await window.accountingApi.createOrganization(organizationForm);
   }

   setOrganizationForm(emptyOrganizationForm());
   setError('');
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_update'));
  }
 }

 async function onClientSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  if (!window.accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  if (!clientForm.name.trim()) {
   setError(t('client_required'));
   return;
  }

  try {
   if (clientForm.id) {
    await window.accountingApi.updateClient(clientForm);
   } else {
    await window.accountingApi.createClient(clientForm);
   }

   setClientForm(emptyClientForm());
   setError('');
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_update'));
  }
 }

 async function onDeleteOrganization(id: number) {
  if (!window.accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  if (!window.confirm(t('organization_delete_confirm'))) {
   return;
  }

  try {
   await window.accountingApi.deleteOrganization(id);
   if (organizationForm.id === id) {
    setOrganizationForm(emptyOrganizationForm());
   }
   if (clientForm.organizationId === id) {
    setClientForm((current) => ({ ...current, organizationId: null }));
   }
   setError('');
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_delete'));
  }
 }

 async function onDeleteClient(id: number) {
  if (!window.accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  if (!window.confirm(t('client_delete_confirm'))) {
   return;
  }

  try {
   await window.accountingApi.deleteClient(id);
   if (clientForm.id === id) {
    setClientForm(emptyClientForm());
   }
   setError('');
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_delete'));
  }
 }

 const navItems: Array<{ key: Section; label: string }> = [
  { key: 'overview', label: t('nav_overview') },
  { key: 'organizations', label: t('nav_organizations') },
  { key: 'clients', label: t('nav_clients') },
  { key: 'accounts', label: t('nav_accounts') },
 ];

 const overviewCards = [
  { label: t('overview_accounts'), value: accounts.length },
  { label: t('overview_organizations'), value: organizations.length },
  { label: t('overview_clients'), value: clients.length },
 ];

 return (
  <div className={`min-h-screen bg-slate-100 text-slate-900 ${isRTL ? 'rtl' : 'ltr'}`}>
   <main className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8">
    <div className="flex flex-col gap-4 rounded-3xl bg-slate-900 px-6 py-5 text-white shadow-lg lg:flex-row lg:items-center lg:justify-between">
     <div>
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-300">Arkam</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">{t('app_title')}</h1>
      <p className="mt-2 max-w-2xl text-sm text-slate-300">{t('app_description')}</p>
     </div>

     <div className="flex flex-col gap-3 lg:items-end">
      <div className="flex items-center gap-2">
       <label className="text-xs font-medium text-slate-300">{t('select_language')}:</label>
       <select
        value={language}
        onChange={(e) => setLanguage(e.target.value as 'en' | 'ar' | 'fr')}
        className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
       >
        <option value="en">{t('english')}</option>
        <option value="ar">{t('arabic')}</option>
        <option value="fr">{t('french')}</option>
       </select>
      </div>

      <p className="text-xs text-slate-400">
       {t('database_file')} <span className="font-mono text-slate-200">{dbInfo?.dbPath ?? t('loading')}</span>
      </p>
     </div>
    </div>

    <nav className="relative z-20 rounded-2xl bg-white p-2 shadow-sm">
     <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {navItems.map((item) => (
       <button
        key={item.key}
        type="button"
        onClick={() => navigateToSection(item.key)}
        aria-pressed={section === item.key}
        className={`rounded-xl px-4 py-3 text-sm font-semibold transition ${
         section === item.key ? 'bg-blue-700 text-white shadow-sm' : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
        } cursor-pointer relative z-20`}
       >
        {item.label}
       </button>
      ))}
     </div>
    </nav>

    {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

    {section === 'overview' ? (
     <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
      <div className="rounded-2xl bg-white p-6 shadow-sm">
       <h2 className="text-2xl font-semibold">{t('overview_title')}</h2>
       <p className="mt-2 text-sm text-slate-600">{t('overview_description')}</p>

       <div className="mt-6 grid gap-4 md:grid-cols-3">
        {overviewCards.map((card) => (
         <div
          key={card.label}
          className="rounded-2xl border border-slate-200 bg-slate-50 p-5"
         >
          <p className="text-sm text-slate-500">{card.label}</p>
          <p className="mt-3 text-3xl font-bold text-slate-900">{card.value}</p>
         </div>
        ))}
       </div>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm">
       <h2 className="text-xl font-semibold">{t('organizations_title')}</h2>
       <div className="mt-4 space-y-3 text-sm text-slate-600">
        {organizations.slice(0, 5).map((organization) => (
         <div
          key={organization.id}
          className="rounded-xl border border-slate-200 px-4 py-3"
         >
          <p className="font-semibold text-slate-900">{organization.name}</p>
          <p>{organization.email || organization.phone || organization.taxId || '-'}</p>
         </div>
        ))}
        {organizations.length === 0 ? <p>{t('no_organizations')}</p> : null}
       </div>
      </div>
     </section>
    ) : null}

    {section === 'organizations' ? (
     <section className="grid gap-6 xl:grid-cols-[380px_1fr]">
      <form
       onSubmit={onOrganizationSubmit}
       className="rounded-2xl bg-white p-6 shadow-sm"
      >
       <div className="flex items-center justify-between gap-3">
        <div>
         <h2 className="text-xl font-semibold">{organizationForm.id ? t('update_organization') : t('new_organization')}</h2>
         <p className="mt-1 text-sm text-slate-600">{t('organizations_description')}</p>
        </div>
        {organizationForm.id ? (
         <button
          type="button"
          onClick={() => setOrganizationForm(emptyOrganizationForm())}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
         >
          {t('cancel')}
         </button>
        ) : null}
       </div>

       <label className="mt-5 block text-sm font-medium">{t('organization_name')}</label>
       <input
        value={organizationForm.name}
        onChange={(event) => setOrganizationForm((current) => ({ ...current, name: event.target.value }))}
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
        placeholder={t('organization_name_placeholder')}
        required
       />

       <label className="mt-4 block text-sm font-medium">{t('organization_email')}</label>
       <input
        value={organizationForm.email}
        onChange={(event) => setOrganizationForm((current) => ({ ...current, email: event.target.value }))}
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
        placeholder={t('organization_email_placeholder')}
       />

       <label className="mt-4 block text-sm font-medium">{t('organization_phone')}</label>
       <input
        value={organizationForm.phone}
        onChange={(event) => setOrganizationForm((current) => ({ ...current, phone: event.target.value }))}
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
        placeholder={t('organization_phone_placeholder')}
       />

       <label className="mt-4 block text-sm font-medium">{t('organization_tax_id')}</label>
       <input
        value={organizationForm.taxId}
        onChange={(event) => setOrganizationForm((current) => ({ ...current, taxId: event.target.value }))}
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
        placeholder={t('organization_tax_id_placeholder')}
       />

       <label className="mt-4 block text-sm font-medium">{t('organization_address')}</label>
       <textarea
        value={organizationForm.address}
        onChange={(event) => setOrganizationForm((current) => ({ ...current, address: event.target.value }))}
        className="mt-2 min-h-28 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
        placeholder={t('organization_address_placeholder')}
       />

       <button
        type="submit"
        className="mt-6 w-full rounded-lg bg-blue-700 px-4 py-2 font-medium text-white transition hover:bg-blue-800"
       >
        {organizationForm.id ? t('update_organization') : t('save_organization')}
       </button>
      </form>

      <div className="rounded-2xl bg-white p-6 shadow-sm">
       <h2 className="text-xl font-semibold">{t('organizations_title')}</h2>
       <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
         <thead className="bg-slate-100 text-slate-700">
          <tr>
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('name')}</th>
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('organization_email')}</th>
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('organization_phone')}</th>
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('organization_tax_id')}</th>
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('actions')}</th>
          </tr>
         </thead>
         <tbody>
          {organizations.map((organization) => (
           <tr
            key={organization.id}
            className="border-t border-slate-200 align-top"
           >
            <td className="px-4 py-3 font-medium text-slate-900">{organization.name}</td>
            <td className="px-4 py-3 text-slate-600">{organization.email || '-'}</td>
            <td className="px-4 py-3 text-slate-600">{organization.phone || '-'}</td>
            <td className="px-4 py-3 text-slate-600">{organization.taxId || '-'}</td>
            <td className="px-4 py-3">
             <div className="flex flex-wrap gap-2">
              <button
               type="button"
               onClick={() =>
                setOrganizationForm({
                 id: organization.id,
                 name: organization.name,
                 email: organization.email,
                 phone: organization.phone,
                 address: organization.address,
                 taxId: organization.taxId,
                })
               }
               className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
               {t('edit')}
              </button>
              <button
               type="button"
               onClick={() => onDeleteOrganization(organization.id)}
               className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
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
             colSpan={5}
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
    ) : null}

    {section === 'clients' ? (
     <section className="grid gap-6 xl:grid-cols-[380px_1fr]">
      <form
       onSubmit={onClientSubmit}
       className="rounded-2xl bg-white p-6 shadow-sm"
      >
       <div className="flex items-center justify-between gap-3">
        <div>
         <h2 className="text-xl font-semibold">{clientForm.id ? t('update_client') : t('new_client')}</h2>
         <p className="mt-1 text-sm text-slate-600">{t('clients_description')}</p>
        </div>
        {clientForm.id ? (
         <button
          type="button"
          onClick={() => setClientForm(emptyClientForm())}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
         >
          {t('cancel')}
         </button>
        ) : null}
       </div>

       <label className="mt-5 block text-sm font-medium">{t('client_name')}</label>
       <input
        value={clientForm.name}
        onChange={(event) => setClientForm((current) => ({ ...current, name: event.target.value }))}
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
        placeholder={t('client_name_placeholder')}
        required
       />

       <label className="mt-4 block text-sm font-medium">{t('client_organization')}</label>
       <select
        value={clientForm.organizationId ?? ''}
        onChange={(event) =>
         setClientForm((current) => ({
          ...current,
          organizationId: event.target.value ? Number(event.target.value) : null,
         }))
        }
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
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
       </select>

       <label className="mt-4 block text-sm font-medium">{t('client_email')}</label>
       <input
        value={clientForm.email}
        onChange={(event) => setClientForm((current) => ({ ...current, email: event.target.value }))}
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
        placeholder={t('client_email_placeholder')}
       />

       <label className="mt-4 block text-sm font-medium">{t('client_phone')}</label>
       <input
        value={clientForm.phone}
        onChange={(event) => setClientForm((current) => ({ ...current, phone: event.target.value }))}
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
        placeholder={t('client_phone_placeholder')}
       />

       <label className="mt-4 block text-sm font-medium">{t('client_address')}</label>
       <textarea
        value={clientForm.address}
        onChange={(event) => setClientForm((current) => ({ ...current, address: event.target.value }))}
        className="mt-2 min-h-28 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
        placeholder={t('client_address_placeholder')}
       />

       <button
        type="submit"
        className="mt-6 w-full rounded-lg bg-blue-700 px-4 py-2 font-medium text-white transition hover:bg-blue-800"
       >
        {clientForm.id ? t('update_client') : t('save_client')}
       </button>
      </form>

      <div className="rounded-2xl bg-white p-6 shadow-sm">
       <h2 className="text-xl font-semibold">{t('clients_title')}</h2>
       <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
         <thead className="bg-slate-100 text-slate-700">
          <tr>
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('name')}</th>
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('client_organization')}</th>
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('client_email')}</th>
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('client_phone')}</th>
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('actions')}</th>
          </tr>
         </thead>
         <tbody>
          {clients.map((client) => (
           <tr
            key={client.id}
            className="border-t border-slate-200 align-top"
           >
            <td className="px-4 py-3 font-medium text-slate-900">{client.name}</td>
            <td className="px-4 py-3 text-slate-600">{client.organizationName || t('unassigned')}</td>
            <td className="px-4 py-3 text-slate-600">{client.email || '-'}</td>
            <td className="px-4 py-3 text-slate-600">{client.phone || '-'}</td>
            <td className="px-4 py-3">
             <div className="flex flex-wrap gap-2">
              <button
               type="button"
               onClick={() =>
                setClientForm({
                 id: client.id,
                 organizationId: client.organizationId,
                 name: client.name,
                 email: client.email,
                 phone: client.phone,
                 address: client.address,
                })
               }
               className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
               {t('edit')}
              </button>
              <button
               type="button"
               onClick={() => onDeleteClient(client.id)}
               className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
              >
               {t('delete')}
              </button>
             </div>
            </td>
           </tr>
          ))}
          {clients.length === 0 ? (
           <tr>
            <td
             className="px-4 py-6 text-slate-500"
             colSpan={5}
            >
             {t('no_clients')}
            </td>
           </tr>
          ) : null}
         </tbody>
        </table>
       </div>
      </div>
     </section>
    ) : null}

    {section === 'accounts' ? (
     <section className={`grid gap-6 ${isRTL ? 'lg:grid-cols-[1fr_360px]' : 'lg:grid-cols-[360px_1fr]'}`}>
      <form
       onSubmit={onSubmit}
       className="rounded-2xl bg-white p-6 shadow-sm"
      >
       <h2 className="text-xl font-semibold">{t('add_chart_account')}</h2>
       <p className="mt-1 text-sm text-slate-600">{t('example')}</p>

       <label className="mt-5 block text-sm font-medium">{t('account_code')}</label>
       <input
        value={code}
        onChange={(event) => setCode(event.target.value)}
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
        placeholder={t('account_code_placeholder')}
        required
       />

       <label className="mt-4 block text-sm font-medium">{t('account_name')}</label>
       <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
        placeholder={t('account_name_placeholder')}
        required
       />

       <button
        type="submit"
        className="mt-6 w-full rounded-lg bg-blue-700 px-4 py-2 font-medium text-white transition hover:bg-blue-800"
       >
        {t('save_account')}
       </button>
      </form>

      <div className="rounded-2xl bg-white p-6 shadow-sm">
       <h2 className="text-xl font-semibold">{t('chart_of_accounts')}</h2>
       <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-sm">
         <thead className="bg-slate-100 text-slate-700">
          <tr>
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('code')}</th>
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('name')}</th>
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('created')}</th>
          </tr>
         </thead>
         <tbody>
          {accounts.map((account) => (
           <tr
            key={account.id}
            className="border-t border-slate-200"
           >
            <td className="px-4 py-3 font-mono">{account.code}</td>
            <td className="px-4 py-3">{account.name}</td>
            <td className="px-4 py-3 text-slate-500">{new Date(account.createdAt).toLocaleString(language)}</td>
           </tr>
          ))}
          {accounts.length === 0 ? (
           <tr>
            <td
             className="px-4 py-6 text-slate-500 text-center"
             colSpan={3}
            >
             {t('no_accounts')}
            </td>
           </tr>
          ) : null}
         </tbody>
        </table>
       </div>
      </div>
     </section>
    ) : null}
   </main>
  </div>
 );
}
