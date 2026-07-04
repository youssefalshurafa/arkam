'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { panelClassName, tableWrapClassName } from '@/shared/styles';
import type { Currency } from '@/shared/types';

type CurrenciesReadOnlyProps = {
 enabledCurrencies: Currency[];
 onOpenSettings: () => void;
};

export default function CurrenciesReadOnly({ enabledCurrencies, onOpenSettings }: CurrenciesReadOnlyProps) {
 const { language, isRTL } = useLanguage();
 const { t } = useTranslation(language);

 return (
  <section className={panelClassName}>
   <div className="flex items-start justify-between gap-4">
    <div>
     <h2 className="text-xl font-semibold">{t('currencies_title')}</h2>
    </div>
    <button
     type="button"
     onClick={onOpenSettings}
     className="rounded border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
    >
     {t('open_in_settings')}
    </button>
   </div>

   <div className={tableWrapClassName}>
    <table className="w-full text-sm">
     <thead className="bg-slate-100 text-slate-700">
      <tr>
       <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('currency_code')}</th>
       <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('currency_name')}</th>
       <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('currency_symbol')}</th>
       <th className={`px-4 py-3 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('main_currency')}</th>
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
        <td className="px-4 py-3 text-slate-600">{currency.symbol || '-'}</td>
        <td className="px-4 py-3">
         {currency.isMain === 1 ? (
          <span className="inline-flex items-center rounded bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">{t('main_currency')}</span>
         ) : (
          <span className="text-slate-400">-</span>
         )}
        </td>
       </tr>
      ))}
      {enabledCurrencies.length === 0 ? (
       <tr>
        <td
         className="px-4 py-6 text-slate-500"
         colSpan={4}
        >
         {t('no_used_currencies')}
        </td>
       </tr>
      ) : null}
     </tbody>
    </table>
   </div>
  </section>
 );
}
