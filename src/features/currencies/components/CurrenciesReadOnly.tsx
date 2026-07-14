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
     className="rounded border border-blue-200 px-3 py-2 text-sm font-semibold text-accent hover:bg-accent-weak"
    >
     {t('open_in_settings')}
    </button>
   </div>

   <div className={tableWrapClassName}>
    <table className="w-full text-sm">
     <thead className="bg-surface-hover text-fg-muted">
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
        className="border-t border-border align-top"
       >
        <td className="px-4 py-3 font-mono font-semibold text-fg">{currency.code}</td>
        <td className="px-4 py-3 text-fg-muted">{currency.name}</td>
        <td className="px-4 py-3 text-fg-muted">{currency.symbol || '-'}</td>
        <td className="px-4 py-3">
         {currency.isMain === 1 ? (
          <span className="inline-flex items-center rounded bg-good-bg px-2.5 py-0.5 text-xs font-semibold text-good-text">{t('main_currency')}</span>
         ) : (
          <span className="text-fg-faint">-</span>
         )}
        </td>
       </tr>
      ))}
      {enabledCurrencies.length === 0 ? (
       <tr>
        <td
         className="px-4 py-6 text-fg-faint"
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
