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
 currencyId: number | null;
 currencyCode: string | null;
 currencySymbol: string | null;
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
 currencyId: number | null;
 name: string;
 email: string;
 phone: string;
 address: string;
};

type Currency = {
 id: number;
 code: string;
 name: string;
 symbol: string;
 isMain: number;
 createdAt: string;
};

type CurrencyForm = {
 id?: number;
 code: string;
 name: string;
 symbol: string;
};

type Transaction = {
 id: number;
 clientId: number;
 clientName: string;
 type: string;
 currencyFromId: number;
 currencyFromCode: string;
 currencyFromSymbol: string;
 currencyToId: number;
 currencyToCode: string;
 currencyToSymbol: string;
 amountFrom: number;
 amountTo: number;
 exchangeRate: number;
 description: string;
 createdAt: string;
};

type TransactionForm = {
 clientId: number | null;
 type: string;
 currencyFromId: number | null;
 currencyToId: number | null;
 amountFrom: string;
 amountTo: string;
 exchangeRate: string;
 description: string;
};

type Section = 'overview' | 'organizations' | 'clients' | 'currencies' | 'transactions' | 'accounts';

const allowedSections: Section[] = ['overview', 'organizations', 'clients', 'currencies', 'transactions', 'accounts'];

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
 currencyId: null,
 name: '',
 email: '',
 phone: '',
 address: '',
});

const emptyCurrencyForm = (): CurrencyForm => ({
 code: '',
 name: '',
 symbol: '',
});

const emptyTransactionForm = (): TransactionForm => ({
 clientId: null,
 type: 'exchange',
 currencyFromId: null,
 currencyToId: null,
 amountFrom: '',
 amountTo: '',
 exchangeRate: '',
 description: '',
});

export default function Home() {
 const { language, setLanguage, isRTL } = useLanguage();
 const { t } = useTranslation(language);
 const [section, setSection] = useState<Section>('overview');
 const [dbInfo, setDbInfo] = useState<DbInfo | null>(null);
 const [accounts, setAccounts] = useState<Account[]>([]);
 const [organizations, setOrganizations] = useState<Organization[]>([]);
 const [clients, setClients] = useState<Client[]>([]);
 const [currencies, setCurrencies] = useState<Currency[]>([]);
 const [transactions, setTransactions] = useState<Transaction[]>([]);
 const [code, setCode] = useState('');
 const [name, setName] = useState('');
 const [organizationForm, setOrganizationForm] = useState<OrganizationForm>(emptyOrganizationForm);
 const [clientForm, setClientForm] = useState<ClientForm>(emptyClientForm);
 const [currencyForm, setCurrencyForm] = useState<CurrencyForm>(emptyCurrencyForm);
 const [transactionForm, setTransactionForm] = useState<TransactionForm>(emptyTransactionForm);
 const [error, setError] = useState('');

 async function loadData() {
  if (!window.accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  try {
   const [db, accountRows, organizationRows, clientRows, currencyRows, transactionRows] = await Promise.all([
    window.accountingApi.getDbInfo(),
    window.accountingApi.listAccounts(),
    window.accountingApi.listOrganizations(),
    window.accountingApi.listClients(),
    window.accountingApi.listCurrencies(),
    window.accountingApi.listTransactions(),
   ]);

   setDbInfo(db);
   setAccounts(accountRows);
   setOrganizations(organizationRows);
   setClients(clientRows);
   setCurrencies(currencyRows);
   setTransactions(transactionRows);
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

  if (!clientForm.currencyId) {
   setError(t('client_currency_required'));
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

 async function onCurrencySubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  if (!window.accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  if (!currencyForm.code.trim() || !currencyForm.name.trim()) {
   setError(t('currency_required'));
   return;
  }

  try {
   if (currencyForm.id) {
    await window.accountingApi.updateCurrency(currencyForm);
   } else {
    await window.accountingApi.createCurrency(currencyForm);
   }

   setCurrencyForm(emptyCurrencyForm());
   setError('');
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_update'));
  }
 }

 async function onDeleteCurrency(id: number) {
  if (!window.accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  if (!window.confirm(t('currency_delete_confirm'))) {
   return;
  }

  try {
   await window.accountingApi.deleteCurrency(id);
   if (currencyForm.id === id) {
    setCurrencyForm(emptyCurrencyForm());
   }
   if (clientForm.currencyId === id) {
    setClientForm((current) => ({ ...current, currencyId: null }));
   }
   setError('');
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_delete'));
  }
 }

 async function onSetMainCurrency(id: number) {
  if (!window.accountingApi) return;
  try {
   await window.accountingApi.setMainCurrency(id);
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_update'));
  }
 }

 async function onTransactionSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  if (!window.accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  const amountFrom = parseFloat(transactionForm.amountFrom);
  const exchangeRate = parseFloat(transactionForm.exchangeRate);

  if (!transactionForm.clientId || !transactionForm.currencyFromId || !transactionForm.currencyToId || !amountFrom || !exchangeRate) {
   setError(t('transaction_required'));
   return;
  }

  const amountTo = parseFloat(transactionForm.amountTo) || amountFrom * exchangeRate;

  try {
   await window.accountingApi.createTransaction({
    clientId: transactionForm.clientId,
    type: transactionForm.type,
    currencyFromId: transactionForm.currencyFromId,
    currencyToId: transactionForm.currencyToId,
    amountFrom,
    amountTo,
    exchangeRate,
    description: transactionForm.description,
   });

   setTransactionForm(emptyTransactionForm());
   setError('');
   await loadData();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_save'));
  }
 }

 async function onDeleteTransaction(id: number) {
  if (!window.accountingApi) {
   setError(t('error_bridge'));
   return;
  }

  if (!window.confirm(t('transaction_delete_confirm'))) {
   return;
  }

  try {
   await window.accountingApi.deleteTransaction(id);
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
  { key: 'currencies', label: t('nav_currencies') },
  { key: 'transactions', label: t('nav_transactions') },
  { key: 'accounts', label: t('nav_accounts') },
 ];

 const overviewCards = [
  { label: t('overview_currencies'), value: currencies.length },
  { label: t('overview_organizations'), value: organizations.length },
  { label: t('overview_clients'), value: clients.length },
  { label: t('overview_transactions'), value: transactions.length },
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
     <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
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

       <label className="mt-4 block text-sm font-medium">
        {t('client_currency')} <span className="text-red-500">*</span>
       </label>
       <select
        value={clientForm.currencyId ?? ''}
        onChange={(event) =>
         setClientForm((current) => ({
          ...current,
          currencyId: event.target.value ? Number(event.target.value) : null,
         }))
        }
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
        required
       >
        <option value="">{t('client_currency_placeholder')}</option>
        {currencies.map((currency) => (
         <option
          key={currency.id}
          value={currency.id}
         >
          {currency.code} – {currency.name}
          {currency.symbol ? ` (${currency.symbol})` : ''}
         </option>
        ))}
       </select>

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
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('client_currency')}</th>
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
            <td className="px-4 py-3 text-slate-600">
             {client.currencyCode ? (
              <span className="inline-flex items-center gap-1">
               <span className="font-semibold text-slate-800">{client.currencyCode}</span>
               {client.currencySymbol ? <span className="text-slate-500">({client.currencySymbol})</span> : null}
              </span>
             ) : (
              '-'
             )}
            </td>
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
                 currencyId: client.currencyId,
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
             colSpan={6}
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

    {section === 'currencies' ? (
     <section className={`grid gap-6 ${isRTL ? 'xl:grid-cols-[1fr_380px]' : 'xl:grid-cols-[380px_1fr]'}`}>
      <form
       onSubmit={onCurrencySubmit}
       className="rounded-2xl bg-white p-6 shadow-sm"
      >
       <div className="flex items-center justify-between gap-3">
        <div>
         <h2 className="text-xl font-semibold">{currencyForm.id ? t('update_currency') : t('new_currency')}</h2>
         <p className="mt-1 text-sm text-slate-600">{t('currencies_description')}</p>
        </div>
        {currencyForm.id ? (
         <button
          type="button"
          onClick={() => setCurrencyForm(emptyCurrencyForm())}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
         >
          {t('cancel')}
         </button>
        ) : null}
       </div>

       <label className="mt-5 block text-sm font-medium">{t('currency_code')}</label>
       <input
        value={currencyForm.code}
        onChange={(event) => setCurrencyForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))}
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
        placeholder={t('currency_code_placeholder')}
        maxLength={10}
        required
       />

       <label className="mt-4 block text-sm font-medium">{t('currency_name')}</label>
       <input
        value={currencyForm.name}
        onChange={(event) => setCurrencyForm((current) => ({ ...current, name: event.target.value }))}
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
        placeholder={t('currency_name_placeholder')}
        required
       />

       <label className="mt-4 block text-sm font-medium">{t('currency_symbol')}</label>
       <input
        value={currencyForm.symbol}
        onChange={(event) => setCurrencyForm((current) => ({ ...current, symbol: event.target.value }))}
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
        placeholder={t('currency_symbol_placeholder')}
       />

       <button
        type="submit"
        className="mt-6 w-full rounded-lg bg-blue-700 px-4 py-2 font-medium text-white transition hover:bg-blue-800"
       >
        {currencyForm.id ? t('update_currency') : t('save_currency')}
       </button>
      </form>

      <div className="rounded-2xl bg-white p-6 shadow-sm">
       <h2 className="text-xl font-semibold">{t('currencies_title')}</h2>
       <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
         <thead className="bg-slate-100 text-slate-700">
          <tr>
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('currency_code')}</th>
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('currency_name')}</th>
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('currency_symbol')}</th>
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('main_currency')}</th>
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('actions')}</th>
          </tr>
         </thead>
         <tbody>
          {currencies.map((currency) => (
           <tr
            key={currency.id}
            className="border-t border-slate-200 align-top"
           >
            <td className="px-4 py-3 font-mono font-semibold text-slate-900">{currency.code}</td>
            <td className="px-4 py-3 text-slate-700">{currency.name}</td>
            <td className="px-4 py-3 text-slate-600">{currency.symbol || '-'}</td>
            <td className="px-4 py-3">
             {currency.isMain === 1 ? (
              <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">{t('main_currency')}</span>
             ) : (
              <span className="text-slate-400">—</span>
             )}
            </td>
            <td className="px-4 py-3">
             <div className="flex flex-wrap gap-2">
              <button
               type="button"
               onClick={() =>
                setCurrencyForm({
                 id: currency.id,
                 code: currency.code,
                 name: currency.name,
                 symbol: currency.symbol,
                })
               }
               className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
               {t('edit')}
              </button>
              <button
               type="button"
               onClick={() => onDeleteCurrency(currency.id)}
               disabled={currency.isMain === 1}
               className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
               {t('delete')}
              </button>
              {currency.isMain !== 1 ? (
               <button
                type="button"
                onClick={() => onSetMainCurrency(currency.id)}
                className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
               >
                {t('set_as_main')}
               </button>
              ) : null}
             </div>
            </td>
           </tr>
          ))}
          {currencies.length === 0 ? (
           <tr>
            <td
             className="px-4 py-6 text-slate-500"
             colSpan={5}
            >
             {t('no_currencies')}
            </td>
           </tr>
          ) : null}
         </tbody>
        </table>
       </div>
      </div>
     </section>
    ) : null}

    {section === 'transactions' ? (
     <section className="grid gap-6 xl:grid-cols-[380px_1fr]">
      <form
       onSubmit={onTransactionSubmit}
       className="rounded-2xl bg-white p-6 shadow-sm"
      >
       <div>
        <h2 className="text-xl font-semibold">{t('new_transaction')}</h2>
        <p className="mt-1 text-sm text-slate-600">{t('transactions_description')}</p>
       </div>

       <label className="mt-5 block text-sm font-medium">
        {t('transaction_client')} <span className="text-red-500">*</span>
       </label>
       <select
        value={transactionForm.clientId ?? ''}
        onChange={(event) =>
         setTransactionForm((current) => ({
          ...current,
          clientId: event.target.value ? Number(event.target.value) : null,
         }))
        }
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
        required
       >
        <option value="">{t('transaction_client_placeholder')}</option>
        {clients.map((client) => (
         <option key={client.id} value={client.id}>
          {client.name}
         </option>
        ))}
       </select>

       <label className="mt-4 block text-sm font-medium">{t('transaction_type')}</label>
       <select
        value={transactionForm.type}
        onChange={(event) => setTransactionForm((current) => ({ ...current, type: event.target.value }))}
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
       >
        <option value="exchange">{t('transaction_type_exchange')}</option>
        <option value="transfer">{t('transaction_type_transfer')}</option>
       </select>

       <label className="mt-4 block text-sm font-medium">
        {t('transaction_currency_from')} <span className="text-red-500">*</span>
       </label>
       <select
        value={transactionForm.currencyFromId ?? ''}
        onChange={(event) =>
         setTransactionForm((current) => ({
          ...current,
          currencyFromId: event.target.value ? Number(event.target.value) : null,
         }))
        }
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
        required
       >
        <option value="">{t('transaction_currency_placeholder')}</option>
        {currencies.map((currency) => (
         <option key={currency.id} value={currency.id}>
          {currency.code} – {currency.name}
          {currency.symbol ? ` (${currency.symbol})` : ''}
         </option>
        ))}
       </select>

       <label className="mt-4 block text-sm font-medium">
        {t('transaction_currency_to')} <span className="text-red-500">*</span>
       </label>
       <select
        value={transactionForm.currencyToId ?? ''}
        onChange={(event) =>
         setTransactionForm((current) => ({
          ...current,
          currencyToId: event.target.value ? Number(event.target.value) : null,
         }))
        }
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
        required
       >
        <option value="">{t('transaction_currency_placeholder')}</option>
        {currencies.map((currency) => (
         <option key={currency.id} value={currency.id}>
          {currency.code} – {currency.name}
          {currency.symbol ? ` (${currency.symbol})` : ''}
         </option>
        ))}
       </select>

       <label className="mt-4 block text-sm font-medium">
        {t('transaction_amount_from')} <span className="text-red-500">*</span>
       </label>
       <input
        type="number"
        step="any"
        min="0"
        value={transactionForm.amountFrom}
        onChange={(event) => {
         const val = event.target.value;
         const rate = parseFloat(transactionForm.exchangeRate);
         setTransactionForm((current) => ({
          ...current,
          amountFrom: val,
          amountTo: val && rate ? (parseFloat(val) * rate).toFixed(2) : current.amountTo,
         }));
        }}
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
        placeholder="0.00"
        required
       />

       <label className="mt-4 block text-sm font-medium">
        {t('transaction_exchange_rate')} <span className="text-red-500">*</span>
       </label>
       <input
        type="number"
        step="any"
        min="0"
        value={transactionForm.exchangeRate}
        onChange={(event) => {
         const val = event.target.value;
         const amount = parseFloat(transactionForm.amountFrom);
         setTransactionForm((current) => ({
          ...current,
          exchangeRate: val,
          amountTo: amount && val ? (amount * parseFloat(val)).toFixed(2) : current.amountTo,
         }));
        }}
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
        placeholder="1.00"
        required
       />

       <label className="mt-4 block text-sm font-medium">{t('transaction_amount_to')}</label>
       <input
        type="number"
        step="any"
        min="0"
        value={transactionForm.amountTo}
        onChange={(event) => setTransactionForm((current) => ({ ...current, amountTo: event.target.value }))}
        className="mt-2 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 outline-none ring-blue-300 focus:ring"
        placeholder="0.00"
       />

       <label className="mt-4 block text-sm font-medium">{t('transaction_description')}</label>
       <textarea
        value={transactionForm.description}
        onChange={(event) => setTransactionForm((current) => ({ ...current, description: event.target.value }))}
        className="mt-2 min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
        placeholder={t('transaction_description_placeholder')}
       />

       <button
        type="submit"
        className="mt-6 w-full rounded-lg bg-blue-700 px-4 py-2 font-medium text-white transition hover:bg-blue-800"
       >
        {t('save_transaction')}
       </button>
      </form>

      <div className="rounded-2xl bg-white p-6 shadow-sm">
       <h2 className="text-xl font-semibold">{t('transactions_title')}</h2>
       <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
         <thead className="bg-slate-100 text-slate-700">
          <tr>
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_client')}</th>
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_type')}</th>
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_amount_from')}</th>
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_exchange_rate')}</th>
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_amount_to')}</th>
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('created')}</th>
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('actions')}</th>
          </tr>
         </thead>
         <tbody>
          {transactions.map((txn) => (
           <tr key={txn.id} className="border-t border-slate-200 align-top">
            <td className="px-4 py-3 font-medium text-slate-900">{txn.clientName}</td>
            <td className="px-4 py-3 text-slate-600 capitalize">{t(txn.type === 'transfer' ? 'transaction_type_transfer' : 'transaction_type_exchange')}</td>
            <td className="px-4 py-3 text-slate-700">
             <span className="font-semibold">{txn.amountFrom.toLocaleString()}</span>{' '}
             <span className="text-slate-500">{txn.currencyFromCode}</span>
            </td>
            <td className="px-4 py-3 font-mono text-slate-600">{txn.exchangeRate}</td>
            <td className="px-4 py-3 text-slate-700">
             <span className="font-semibold">{txn.amountTo.toLocaleString()}</span>{' '}
             <span className="text-slate-500">{txn.currencyToCode}</span>
            </td>
            <td className="px-4 py-3 text-slate-500">{new Date(txn.createdAt).toLocaleString(language)}</td>
            <td className="px-4 py-3">
             <button
              type="button"
              onClick={() => onDeleteTransaction(txn.id)}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
             >
              {t('delete')}
             </button>
            </td>
           </tr>
          ))}
          {transactions.length === 0 ? (
           <tr>
            <td className="px-4 py-6 text-slate-500" colSpan={7}>
             {t('no_transactions')}
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
