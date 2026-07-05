'use client';

import { useMemo, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { accountingApi } from '@/lib/accountingApi';
import { confirmDialog } from '@/components/ui/AppDialog';
import { useWorkspaceActions } from '@/features/workspace/hooks/useWorkspaceActions';
import { panelClassName, tableWrapClassName } from '@/shared/styles';
import type { ClientAccount, Currency, Transaction } from '@/shared/types';

type CurrenciesSectionProps = {
 localizedCurrencies: Currency[];
 enabledCurrencies: Currency[];
 clientAccounts: ClientAccount[];
 transactions: Transaction[];
};

export default function CurrenciesSection({ localizedCurrencies, enabledCurrencies, clientAccounts, transactions }: CurrenciesSectionProps) {
 const { language, isRTL } = useLanguage();
 const { t } = useTranslation(language);
 const { invalidate, setters, setError } = useWorkspaceActions();
 const setCurrencies = setters.setCurrencies;
 const onReload = invalidate;
 const onError = setError;

 const [catalogCurrencyQuery, setCatalogCurrencyQuery] = useState('');
 const [selectedCatalogCurrencyId, setSelectedCatalogCurrencyId] = useState<number | null>(null);
 const [editingCurrencySymbolId, setEditingCurrencySymbolId] = useState<number | null>(null);
 const [editingCurrencySymbolValue, setEditingCurrencySymbolValue] = useState('');

 const availableCurrencies = useMemo(() => localizedCurrencies.filter((currency) => currency.isEnabled !== 1), [localizedCurrencies]);
 const normalizedCatalogCurrencyQuery = catalogCurrencyQuery.trim().toLocaleLowerCase();
 const filteredAvailableCurrencies = useMemo(
  () =>
   availableCurrencies.filter((currency) => {
    if (!normalizedCatalogCurrencyQuery) {
     return true;
    }

    return currency.code.toLocaleLowerCase().includes(normalizedCatalogCurrencyQuery) || currency.name.toLocaleLowerCase().includes(normalizedCatalogCurrencyQuery);
   }),
  [availableCurrencies, normalizedCatalogCurrencyQuery],
 );

 function onStartEditCurrencySymbol(currency: Currency) {
  setEditingCurrencySymbolId(currency.id);
  setEditingCurrencySymbolValue(currency.symbol || '');
 }

 function onCancelEditCurrencySymbol() {
  setEditingCurrencySymbolId(null);
  setEditingCurrencySymbolValue('');
 }

 async function onSaveCurrencySymbol(currency: Currency) {
  const symbol = editingCurrencySymbolValue.trim();
  try {
   await accountingApi.updateCurrency({ id: currency.id, code: currency.code, name: currency.name, symbol });
   setEditingCurrencySymbolId(null);
   setEditingCurrencySymbolValue('');
   onError('');
   setCurrencies((prev) => prev.map((c) => (c.id === currency.id ? { ...c, symbol } : c)));
   void onReload();
  } catch (e) {
   onError(e instanceof Error ? e.message : t('error_failed_update'));
  }
 }

 async function onEnableCurrency(id: number) {
  try {
   await accountingApi.enableCurrency(id);
   setSelectedCatalogCurrencyId(null);
   setCatalogCurrencyQuery('');
   onError('');
   await onReload();
  } catch (e) {
   onError(e instanceof Error ? e.message : t('error_failed_update'));
  }
 }

 async function onDisableCurrency(id: number) {
  const isUsedInClientAccounts = clientAccounts.some((account) => account.currencyId === id);
  const isUsedInTransactions = transactions.some((transaction) => {
   if (transaction.currencyId === id) {
    return true;
   }

   const fromAccount = clientAccounts.find((account) => account.id === transaction.accountFromId);
   const toAccount = clientAccounts.find((account) => account.id === transaction.accountToId);

   return fromAccount?.currencyId === id || toAccount?.currencyId === id;
  });

  const confirmMessage = isUsedInClientAccounts || isUsedInTransactions ? t('currency_disable_confirm_used') : t('currency_disable_confirm');

  if (!(await confirmDialog({ message: confirmMessage, tone: 'danger' }))) {
   return;
  }

  try {
   await accountingApi.disableCurrency(id);
   onError('');
   await onReload();
  } catch (e) {
   onError(e instanceof Error ? e.message : t('error_failed_update'));
  }
 }

 async function onSetMainCurrency(id: number) {
  try {
   await accountingApi.setMainCurrency(id);
   await onReload();
  } catch (e) {
   onError(e instanceof Error ? e.message : t('error_failed_update'));
  }
 }

 return (
  <section className="flex flex-col gap-6">
   <div className={panelClassName}>
    <div className="flex items-start justify-between gap-4">
     <div>
      <h2 className="text-xl font-semibold">{t('currencies_title')}</h2>
      <p className="mt-1 text-sm text-slate-600">{t('currencies_description')}</p>
     </div>
     <div className="rounded border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">{t('currencies_seeded_hint')}</div>
    </div>

    <div className="mt-4 rounded border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">{t('currencies_seeded_description')}</div>

    <div className="mt-4 rounded border border-slate-200 bg-white px-4 py-4">
     <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
      <div className="flex-1">
       <label className="block text-sm font-medium text-slate-700">{t('currency_catalog_title')}</label>
       <input
        value={catalogCurrencyQuery}
        onChange={(event) => {
         setCatalogCurrencyQuery(event.target.value);
         setSelectedCatalogCurrencyId(null);
        }}
        className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
        placeholder={t('currency_catalog_search_placeholder')}
       />
       <div className="mt-2 max-h-64 overflow-y-auto rounded border border-slate-200 bg-slate-50">
        {filteredAvailableCurrencies.length > 0 ? (
         filteredAvailableCurrencies.map((currency) => (
          <button
           key={currency.id}
           type="button"
           onClick={() => {
            setSelectedCatalogCurrencyId(currency.id);
            setCatalogCurrencyQuery(`${currency.code} - ${currency.name}`);
           }}
           className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-sm transition ${
            selectedCatalogCurrencyId === currency.id ? 'bg-blue-100 text-blue-900' : 'text-slate-700 hover:bg-white'
           }`}
          >
           <span className="font-semibold">{currency.code}</span>
           <span className="flex-1 truncate text-slate-600">{currency.name}</span>
          </button>
         ))
        ) : (
         <p className="px-3 py-3 text-sm text-slate-500">{t('currency_catalog_no_match')}</p>
        )}
       </div>
      </div>
      <button
       type="button"
       onClick={() => (selectedCatalogCurrencyId ? void onEnableCurrency(selectedCatalogCurrencyId) : undefined)}
       disabled={!selectedCatalogCurrencyId}
       className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-40"
      >
       {t('currency_add_to_used')}
      </button>
     </div>
     {availableCurrencies.length === 0 ? <p className="mt-3 text-sm text-slate-500">{t('currency_catalog_empty')}</p> : null}
    </div>

    <div className={tableWrapClassName}>
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
       {enabledCurrencies.map((currency) => (
        <tr
         key={currency.id}
         className="border-t border-slate-200 align-top"
        >
         <td className="px-4 py-3 font-mono font-semibold text-slate-900">{currency.code}</td>
         <td className="px-4 py-3 text-slate-700">{currency.name}</td>
         <td className="px-4 py-3 text-slate-600">
          {editingCurrencySymbolId === currency.id ? (
           <div className="flex items-center gap-2">
            <input
             autoFocus
             value={editingCurrencySymbolValue}
             onChange={(event) => setEditingCurrencySymbolValue(event.target.value)}
             onKeyDown={(event) => {
              if (event.key === 'Enter') void onSaveCurrencySymbol(currency);
              if (event.key === 'Escape') onCancelEditCurrencySymbol();
             }}
             maxLength={8}
             className="w-20 rounded border border-slate-300 px-2 py-1 text-sm outline-none ring-blue-300 focus:ring"
             placeholder={t('currency_symbol')}
            />
            <button
             type="button"
             onClick={() => void onSaveCurrencySymbol(currency)}
             className="rounded border border-green-200 px-2.5 py-1 text-xs font-semibold text-green-700 hover:bg-green-50"
            >
             {t('client_account_save')}
            </button>
            <button
             type="button"
             onClick={onCancelEditCurrencySymbol}
             className="rounded border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
             {t('cancel')}
            </button>
           </div>
          ) : (
           <div className="flex items-center gap-2">
            <span>{currency.symbol || '-'}</span>
            <button
             type="button"
             onClick={() => onStartEditCurrencySymbol(currency)}
             title={t('edit')}
             aria-label={t('edit')}
             className="rounded border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-700"
            >
             <svg
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
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
             </svg>
            </button>
           </div>
          )}
         </td>
         <td className="px-4 py-3">
          {currency.isMain === 1 ? (
           <span className="inline-flex items-center rounded bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">{t('main_currency')}</span>
          ) : (
           <span className="text-slate-400">-</span>
          )}
         </td>
         <td className="px-4 py-3">
          <div className="flex flex-wrap gap-2">
           <button
            type="button"
            onClick={() => onDisableCurrency(currency.id)}
            className="rounded border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
           >
            {t('currency_remove_from_used')}
           </button>
           {currency.isMain !== 1 ? (
            <button
             type="button"
             onClick={() => onSetMainCurrency(currency.id)}
             className="rounded border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
            >
             {t('set_as_main')}
            </button>
           ) : null}
          </div>
         </td>
        </tr>
       ))}
       {enabledCurrencies.length === 0 ? (
        <tr>
         <td
          className="px-4 py-6 text-slate-500"
          colSpan={5}
         >
          {t('no_used_currencies')}
         </td>
        </tr>
       ) : null}
      </tbody>
     </table>
    </div>
   </div>
  </section>
 );
}
