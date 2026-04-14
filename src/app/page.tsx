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
 accountCount: number;
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

type ClientAccount = {
 id: number;
 clientId: number;
 clientName: string;
 currencyId: number;
 currencyCode: string;
 currencySymbol: string;
 createdAt: string;
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
 accountFromId: number;
 clientFromName: string;
 accountFromCurrencyCode: string;
 accountToId: number;
 clientToName: string;
 accountToCurrencyCode: string;
 currencyId: number;
 currencyCode: string;
 currencySymbol: string;
 amount: number;
 type: string;
 exchangeRateFrom: number;
 commissionFrom: number;
 exchangeRateTo: number;
 commissionTo: number;
 description: string;
 createdAt: string;
};

type TransactionForm = {
 accountFromId: number | null;
 accountToId: number | null;
 currencyId: number | null;
 amount: string;
 type: string;
 exchangeRateFrom: string;
 commissionFrom: string;
 exchangeRateTo: string;
 commissionTo: string;
 description: string;
};

type ClientLedgerEntry = {
 transactionId: number;
 createdAt: string;
 counterpartyName: string;
 direction: 'incoming' | 'outgoing';
 type: string;
 amount: number;
 currencyCode: string;
 exchangeRate: number;
 commission: number;
 netChange: number;
 runningBalance: number;
 description: string;
};

type ClientAccountLedger = {
 accountId: number;
 currencyCode: string;
 currencySymbol: string;
 currentBalance: number;
 transactionCount: number;
 entries: ClientLedgerEntry[];
};

type Section = 'overview' | 'organizations' | 'clients' | 'client-ledger' | 'currencies' | 'transactions' | 'accounts';

const allowedSections: Section[] = ['overview', 'organizations', 'clients', 'client-ledger', 'currencies', 'transactions', 'accounts'];

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

const emptyCurrencyForm = (): CurrencyForm => ({
 code: '',
 name: '',
 symbol: '',
});

const emptyTransactionForm = (): TransactionForm => ({
 accountFromId: null,
 accountToId: null,
 currencyId: null,
 amount: '',
 type: 'exchange',
 exchangeRateFrom: '1',
 commissionFrom: '0',
 exchangeRateTo: '1',
 commissionTo: '0',
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
 const [clientAccounts, setClientAccounts] = useState<ClientAccount[]>([]);
 const [selectedClientForAccounts, setSelectedClientForAccounts] = useState<Client | null>(null);
 const [selectedClientForLedger, setSelectedClientForLedger] = useState<Client | null>(null);
 const [newAccountCurrencyId, setNewAccountCurrencyId] = useState<number | null>(null);
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
   const [db, accountRows, organizationRows, clientRows, currencyRows, transactionRows, clientAccountRows] = await Promise.all([
    window.accountingApi.getDbInfo(),
    window.accountingApi.listAccounts(),
    window.accountingApi.listOrganizations(),
    window.accountingApi.listClients(),
    window.accountingApi.listCurrencies(),
    window.accountingApi.listTransactions(),
    window.accountingApi.listAllClientAccounts(),
   ]);

   setDbInfo(db);
   setAccounts(accountRows);
   setOrganizations(organizationRows);
   setClients(clientRows);
   setCurrencies(currencyRows);
   setTransactions(transactionRows);
   setClientAccounts(clientAccountRows);
  setSelectedClientForAccounts((current) => (current ? clientRows.find((client) => client.id === current.id) ?? null : null));
  setSelectedClientForLedger((current) => (current ? clientRows.find((client) => client.id === current.id) ?? null : null));
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
    if (selectedClientForAccounts?.id === id) {
     setSelectedClientForAccounts(null);
    }
    if (selectedClientForLedger?.id === id) {
     setSelectedClientForLedger(null);
     navigateToSection('clients');
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

  const amount = parseFloat(transactionForm.amount);

  if (!transactionForm.accountFromId || !transactionForm.accountToId || !transactionForm.currencyId || !amount) {
   setError(t('transaction_required'));
   return;
  }

  try {
   await window.accountingApi.createTransaction({
    accountFromId: transactionForm.accountFromId,
    accountToId: transactionForm.accountToId,
    currencyId: transactionForm.currencyId,
    amount,
    type: transactionForm.type,
    exchangeRateFrom: parseFloat(transactionForm.exchangeRateFrom) || 1,
    commissionFrom: parseFloat(transactionForm.commissionFrom) || 0,
    exchangeRateTo: parseFloat(transactionForm.exchangeRateTo) || 1,
    commissionTo: parseFloat(transactionForm.commissionTo) || 0,
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

 async function onAddClientAccount(clientId: number) {
  if (!window.accountingApi || !newAccountCurrencyId) return;
  try {
   await window.accountingApi.createClientAccount({ clientId, currencyId: newAccountCurrencyId });
   setNewAccountCurrencyId(null);
   await loadData();
   // Re-sync selectedClientForAccounts with updated client data
   setSelectedClientForAccounts((prev) => (prev ? { ...prev } : null));
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_save'));
  }
 }

 async function onDeleteClientAccount(accountId: number) {
  if (!window.accountingApi) return;
  if (!window.confirm(t('client_account_delete_confirm'))) return;
  try {
   await window.accountingApi.deleteClientAccount(accountId);
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

 const clientAccountMap = new Map(clientAccounts.map((account) => [account.id, account]));

 const selectedClientLedgers: ClientAccountLedger[] = selectedClientForLedger
  ? clientAccounts
    .filter((account) => account.clientId === selectedClientForLedger.id)
    .map((account) => {
     const entries = transactions
      .flatMap((transaction) => {
       if (transaction.accountFromId === account.id) {
        const counterparty = clientAccountMap.get(transaction.accountToId);
        return [{
         transactionId: transaction.id,
         createdAt: transaction.createdAt,
         counterpartyName: counterparty?.clientName || '-',
         direction: 'outgoing' as const,
         type: transaction.type,
         amount: transaction.amount,
         currencyCode: transaction.currencyCode,
         exchangeRate: transaction.exchangeRateFrom,
         commission: transaction.commissionFrom,
         netChange: -((transaction.amount * transaction.exchangeRateFrom) + transaction.commissionFrom),
         runningBalance: 0,
         description: transaction.description,
        }];
       }

       if (transaction.accountToId === account.id) {
        const counterparty = clientAccountMap.get(transaction.accountFromId);
        return [{
         transactionId: transaction.id,
         createdAt: transaction.createdAt,
         counterpartyName: counterparty?.clientName || '-',
         direction: 'incoming' as const,
         type: transaction.type,
         amount: transaction.amount,
         currencyCode: transaction.currencyCode,
         exchangeRate: transaction.exchangeRateTo,
         commission: transaction.commissionTo,
         netChange: (transaction.amount * transaction.exchangeRateTo) - transaction.commissionTo,
         runningBalance: 0,
         description: transaction.description,
        }];
       }

       return [];
      })
      .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());

     let runningBalance = 0;
     const entriesWithBalance = entries.map((entry) => {
      runningBalance += entry.netChange;
      return {
       ...entry,
       runningBalance,
      };
     });

     return {
      accountId: account.id,
      currencyCode: account.currencyCode,
      currencySymbol: account.currencySymbol,
      currentBalance: runningBalance,
      transactionCount: entriesWithBalance.length,
      entries: entriesWithBalance,
     };
    })
    .sort((left, right) => left.currencyCode.localeCompare(right.currencyCode))
  : [];

 const selectedClientTransactionCount = selectedClientLedgers.reduce((sum, ledger) => sum + ledger.transactionCount, 0);

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

      <div className="flex flex-col gap-4">
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
            <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('client_accounts')}</th>
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
              <button
               type="button"
               onClick={() => setSelectedClientForAccounts(selectedClientForAccounts?.id === client.id ? null : client)}
               className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                selectedClientForAccounts?.id === client.id ? 'border-blue-600 bg-blue-700 text-white' : 'border-slate-300 text-slate-700 hover:bg-slate-50'
               }`}
              >
               {t('client_accounts')} ({client.accountCount})
              </button>
             </td>
             <td className="px-4 py-3">
              <div className="flex flex-wrap gap-2">
                 <button
                  type="button"
                  onClick={() => {
                   setSelectedClientForLedger(client);
                   navigateToSection('client-ledger');
                  }}
                  className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                 >
                  {t('client_page_open')}
                 </button>
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

       {selectedClientForAccounts ? (
        <div className="rounded-2xl bg-white p-6 shadow-sm">
         <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">
           {t('client_accounts_for')}: <span className="text-blue-700">{selectedClientForAccounts.name}</span>
          </h2>
          <button
           type="button"
           onClick={() => setSelectedClientForAccounts(null)}
           className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
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
             className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3"
            >
             <span className="font-mono font-semibold text-slate-800">{account.currencyCode}</span>
             {account.currencySymbol ? <span className="text-slate-500">{account.currencySymbol}</span> : null}
             <button
              type="button"
              onClick={() => onDeleteClientAccount(account.id)}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
             >
              {t('delete')}
             </button>
            </div>
           ))}
          {clientAccounts.filter((a) => a.clientId === selectedClientForAccounts.id).length === 0 ? <p className="text-sm text-slate-500">{t('no_client_accounts')}</p> : null}
         </div>

         <div className="mt-4 flex gap-2">
          <select
           value={newAccountCurrencyId ?? ''}
           onChange={(event) => setNewAccountCurrencyId(event.target.value ? Number(event.target.value) : null)}
           className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
          >
           <option value="">{t('client_account_currency_placeholder')}</option>
           {currencies
            .filter((cur) => !clientAccounts.some((a) => a.clientId === selectedClientForAccounts.id && a.currencyId === cur.id))
            .map((cur) => (
             <option
              key={cur.id}
              value={cur.id}
             >
              {cur.code} – {cur.name}
             </option>
            ))}
          </select>
          <button
           type="button"
           onClick={() => onAddClientAccount(selectedClientForAccounts.id)}
           disabled={!newAccountCurrencyId}
           className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
           {t('client_account_open')}
          </button>
         </div>
        </div>
       ) : null}
      </div>
     </section>
    ) : null}

      {section === 'client-ledger' ? (
       <section className="flex flex-col gap-6">
        <div className="rounded-2xl bg-white p-6 shadow-sm">
         <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
         <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-700">{t('client_page_title')}</p>
         <h2 className="mt-2 text-2xl font-semibold text-slate-900">{selectedClientForLedger?.name ?? t('clients_title')}</h2>
         <p className="mt-2 text-sm text-slate-600">
          {selectedClientForLedger ? t('client_page_description') : t('client_page_no_client')}
         </p>
        </div>

        <button
         type="button"
         onClick={() => navigateToSection('clients')}
         className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
         {t('client_page_back')}
        </button>
         </div>

         {selectedClientForLedger ? (
        <div className="mt-6 grid gap-4 md:grid-cols-3">
         <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm text-slate-500">{t('client_organization')}</p>
          <p className="mt-2 text-lg font-semibold text-slate-900">{selectedClientForLedger.organizationName || t('unassigned')}</p>
         </div>
         <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm text-slate-500">{t('client_accounts')}</p>
          <p className="mt-2 text-lg font-semibold text-slate-900">{selectedClientLedgers.length}</p>
         </div>
         <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm text-slate-500">{t('client_page_transaction_count')}</p>
          <p className="mt-2 text-lg font-semibold text-slate-900">{selectedClientTransactionCount}</p>
         </div>
        </div>
         ) : null}
        </div>

        {!selectedClientForLedger ? (
         <div className="rounded-2xl bg-white p-6 shadow-sm text-sm text-slate-600">{t('client_page_no_client')}</div>
        ) : selectedClientLedgers.length === 0 ? (
         <div className="rounded-2xl bg-white p-6 shadow-sm text-sm text-slate-600">{t('no_client_accounts')}</div>
        ) : (
         selectedClientLedgers.map((ledger) => (
        <div key={ledger.accountId} className="rounded-2xl bg-white p-6 shadow-sm">
         <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
           <h3 className="text-xl font-semibold text-slate-900">
          {ledger.currencyCode}
          {ledger.currencySymbol ? ` (${ledger.currencySymbol})` : ''}
           </h3>
           <p className="mt-1 text-sm text-slate-600">{t('client_page_account_summary')}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
           <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('client_page_current_balance')}</p>
          <p className={`mt-2 text-xl font-bold ${ledger.currentBalance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
           {ledger.currentBalance.toLocaleString(language, { maximumFractionDigits: 2 })}
          </p>
           </div>
           <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('client_page_transaction_count')}</p>
          <p className="mt-2 text-xl font-bold text-slate-900">{ledger.transactionCount}</p>
           </div>
          </div>
         </div>

         {ledger.entries.length === 0 ? (
          <p className="mt-5 text-sm text-slate-500">{t('client_page_no_transactions')}</p>
         ) : (
          <div className="mt-5 overflow-x-auto rounded-lg border border-slate-200">
           <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-700">
           <tr>
            <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('created')}</th>
            <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('counterparty')}</th>
            <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('direction')}</th>
            <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_type')}</th>
            <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_amount')}</th>
            <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_exchange_rate')}</th>
            <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('commission')}</th>
            <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('net_change')}</th>
            <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('running_balance')}</th>
            <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_description')}</th>
           </tr>
          </thead>
          <tbody>
           {ledger.entries.map((entry) => (
            <tr key={`${ledger.accountId}-${entry.transactionId}-${entry.direction}`} className="border-t border-slate-200 align-top">
             <td className="px-4 py-3 text-slate-500">{new Date(entry.createdAt).toLocaleDateString(language)}</td>
             <td className="px-4 py-3 font-medium text-slate-900">{entry.counterpartyName}</td>
             <td className="px-4 py-3">
            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${entry.direction === 'incoming' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
             {entry.direction === 'incoming' ? t('incoming') : t('outgoing')}
            </span>
             </td>
             <td className="px-4 py-3 text-slate-600">{t(entry.type === 'transfer' ? 'transaction_type_transfer' : 'transaction_type_exchange')}</td>
             <td className="px-4 py-3 text-slate-700">
            {entry.amount.toLocaleString(language, { maximumFractionDigits: 2 })} {entry.currencyCode}
             </td>
             <td className="px-4 py-3 text-slate-600">{entry.exchangeRate.toLocaleString(language, { maximumFractionDigits: 4 })}</td>
             <td className="px-4 py-3 text-slate-600">{entry.commission.toLocaleString(language, { maximumFractionDigits: 2 })}</td>
             <td className={`px-4 py-3 font-semibold ${entry.netChange >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {entry.netChange.toLocaleString(language, { maximumFractionDigits: 2 })} {ledger.currencyCode}
             </td>
             <td className={`px-4 py-3 font-semibold ${entry.runningBalance >= 0 ? 'text-slate-900' : 'text-red-600'}`}>
            {entry.runningBalance.toLocaleString(language, { maximumFractionDigits: 2 })} {ledger.currencyCode}
             </td>
             <td className="px-4 py-3 text-slate-500">{entry.description || '-'}</td>
            </tr>
           ))}
          </tbody>
           </table>
          </div>
         )}
        </div>
         ))
        )}
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
        {t('transaction_account_from')} <span className="text-red-500">*</span>
       </label>
       <select
        value={transactionForm.accountFromId ?? ''}
        onChange={(event) =>
         setTransactionForm((current) => ({
          ...current,
          accountFromId: event.target.value ? Number(event.target.value) : null,
         }))
        }
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
        required
       >
        <option value="">{t('transaction_account_placeholder')}</option>
        {clientAccounts.map((account) => (
         <option
          key={account.id}
          value={account.id}
         >
          {account.clientName} — {account.currencyCode}
         </option>
        ))}
       </select>

       <label className="mt-4 block text-sm font-medium">
        {t('transaction_account_to')} <span className="text-red-500">*</span>
       </label>
       <select
        value={transactionForm.accountToId ?? ''}
        onChange={(event) =>
         setTransactionForm((current) => ({
          ...current,
          accountToId: event.target.value ? Number(event.target.value) : null,
         }))
        }
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
        required
       >
        <option value="">{t('transaction_account_placeholder')}</option>
        {clientAccounts.map((account) => (
         <option
          key={account.id}
          value={account.id}
         >
          {account.clientName} — {account.currencyCode}
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
        {t('transaction_amount')} <span className="text-red-500">*</span>
       </label>
       <div className="mt-2 flex gap-2">
        <input
         type="number"
         step="any"
         min="0"
         value={transactionForm.amount}
         onChange={(event) => setTransactionForm((current) => ({ ...current, amount: event.target.value }))}
         className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 outline-none ring-blue-300 focus:ring"
         placeholder="0.00"
         required
        />
        <select
         value={transactionForm.currencyId ?? ''}
         onChange={(event) =>
          setTransactionForm((current) => ({
           ...current,
           currencyId: event.target.value ? Number(event.target.value) : null,
          }))
         }
         className="w-28 rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none ring-blue-300 focus:ring"
         required
        >
         <option value="">{t('transaction_currency_placeholder')}</option>
         {currencies.map((cur) => (
          <option key={cur.id} value={cur.id}>
           {cur.code}
          </option>
         ))}
        </select>
       </div>

       <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-sm font-semibold text-slate-700">{t('transaction_account_from')}</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
         <div>
          <label className="block text-xs font-medium text-slate-500">{t('transaction_exchange_rate_from')}</label>
          <input
           type="number"
           step="any"
           min="0"
           value={transactionForm.exchangeRateFrom}
           onChange={(event) => setTransactionForm((current) => ({ ...current, exchangeRateFrom: event.target.value }))}
           className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
           placeholder="1"
          />
         </div>
         <div>
          <label className="block text-xs font-medium text-slate-500">{t('transaction_commission_from')}</label>
          <input
           type="number"
           step="any"
           min="0"
           value={transactionForm.commissionFrom}
           onChange={(event) => setTransactionForm((current) => ({ ...current, commissionFrom: event.target.value }))}
           className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
           placeholder="0"
          />
         </div>
        </div>
       </div>

       <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-sm font-semibold text-slate-700">{t('transaction_account_to')}</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
         <div>
          <label className="block text-xs font-medium text-slate-500">{t('transaction_exchange_rate_to')}</label>
          <input
           type="number"
           step="any"
           min="0"
           value={transactionForm.exchangeRateTo}
           onChange={(event) => setTransactionForm((current) => ({ ...current, exchangeRateTo: event.target.value }))}
           className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
           placeholder="1"
          />
         </div>
         <div>
          <label className="block text-xs font-medium text-slate-500">{t('transaction_commission_to')}</label>
          <input
           type="number"
           step="any"
           min="0"
           value={transactionForm.commissionTo}
           onChange={(event) => setTransactionForm((current) => ({ ...current, commissionTo: event.target.value }))}
           className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
           placeholder="0"
          />
         </div>
        </div>
       </div>

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
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_account_from')}</th>
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_account_to')}</th>
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_type')}</th>
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_amount')}</th>
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_commission_from')}</th>
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_commission_to')}</th>
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('created')}</th>
           <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('actions')}</th>
          </tr>
         </thead>
         <tbody>
          {transactions.map((txn) => (
           <tr
            key={txn.id}
            className="border-t border-slate-200 align-top"
           >
            <td className="px-4 py-3 font-medium text-slate-900">
             <div>{txn.clientFromName} <span className="text-xs font-normal text-slate-500">{txn.accountFromCurrencyCode}</span></div>
             {txn.exchangeRateFrom !== 1 ? <div className="text-xs text-slate-500">{t('transaction_exchange_rate')}: {txn.exchangeRateFrom}</div> : null}
            </td>
            <td className="px-4 py-3 font-medium text-slate-900">
             <div>{txn.clientToName} <span className="text-xs font-normal text-slate-500">{txn.accountToCurrencyCode}</span></div>
             {txn.exchangeRateTo !== 1 ? <div className="text-xs text-slate-500">{t('transaction_exchange_rate')}: {txn.exchangeRateTo}</div> : null}
            </td>
            <td className="px-4 py-3 text-slate-600 capitalize">{t(txn.type === 'transfer' ? 'transaction_type_transfer' : 'transaction_type_exchange')}</td>
            <td className="px-4 py-3 text-slate-700">
             <span className="font-semibold">{txn.amount.toLocaleString()}</span>{' '}
             <span className="text-slate-500">{txn.currencyCode}</span>
            </td>
            <td className="px-4 py-3 font-mono text-slate-600">{txn.commissionFrom || '-'}</td>
            <td className="px-4 py-3 font-mono text-slate-600">{txn.commissionTo || '-'}</td>
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
            <td
             className="px-4 py-6 text-slate-500"
             colSpan={8}
            >
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
