'use client';

import { useMemo, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { accountingApi } from '@/lib/accountingApi';
import { Spinner } from '@/components/ui/Spinner';
import { useWorkspaceActions } from '@/features/workspace/hooks/useWorkspaceActions';
import type { Currency } from '@/shared/types';

type AddCurrencyDialogProps = {
 localizedCurrencies: Currency[];
 onClose: () => void;
 /** Called with the newly enabled currency's id so the opener can select it. */
 onAdded: (currencyId: number) => void;
};

/**
 * Quick "add a currency" picker for forms that choose from the workspace's used currencies
 * (e.g. a new client's accounts), so the user doesn't have to leave the form for
 * Settings → Currencies. Enabling = moving a seeded catalog currency into the used list,
 * the same action the Currencies section performs.
 */
export default function AddCurrencyDialog({ localizedCurrencies, onClose, onAdded }: AddCurrencyDialogProps) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const { invalidate, setters } = useWorkspaceActions();
 const [query, setQuery] = useState('');
 const [savingId, setSavingId] = useState<number | null>(null);
 const [error, setError] = useState('');

 const availableCurrencies = useMemo(() => localizedCurrencies.filter((currency) => currency.isEnabled !== 1), [localizedCurrencies]);
 const normalizedQuery = query.trim().toLocaleLowerCase();
 const filteredCurrencies = useMemo(
  () =>
   normalizedQuery
    ? availableCurrencies.filter((currency) => currency.code.toLocaleLowerCase().includes(normalizedQuery) || currency.name.toLocaleLowerCase().includes(normalizedQuery))
    : availableCurrencies,
  [availableCurrencies, normalizedQuery],
 );

 async function onPick(currencyId: number) {
  if (savingId != null) return;
  setSavingId(currencyId);
  setError('');
  try {
   await accountingApi.enableCurrency(currencyId);
   // Mark it enabled in the cache right away so the opener's <select> already has the
   // option when it selects it; the refetch below then reconciles with the server.
   setters.setCurrencies((current) => current.map((currency) => (currency.id === currencyId ? { ...currency, isEnabled: 1 } : currency)));
   onAdded(currencyId);
   onClose();
   void invalidate();
  } catch (e) {
   setError(e instanceof Error ? e.message : t('error_failed_update'));
   setSavingId(null);
  }
 }

 return (
  <div
   className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
   onClick={onClose}
  >
   <div
    className="flex max-h-[80vh] w-full max-w-sm flex-col rounded-xl border border-border bg-surface p-6 shadow-xl"
    onClick={(e) => e.stopPropagation()}
    onKeyDown={(e) => {
     if (e.key === 'Escape') onClose();
    }}
   >
    <h2 className="text-lg font-semibold text-fg">{t('currency_add_dialog_title')}</h2>
    {error ? <div className="mt-3 rounded bg-bad-bg px-3 py-2 text-sm text-bad-text">{error}</div> : null}
    <input
     type="text"
     value={query}
     onChange={(event) => setQuery(event.target.value)}
     onKeyDown={(event) => {
      // Enter adds the only/first match, so "type code + Enter" is enough.
      if (event.key === 'Enter' && filteredCurrencies[0]) {
       event.preventDefault();
       void onPick(filteredCurrencies[0].id);
      }
     }}
     placeholder={t('currency_catalog_search_placeholder')}
     className="mt-4 w-full rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
     autoFocus
    />
    <div className="mt-2 min-h-0 flex-1 overflow-y-auto rounded border border-border bg-surface-2">
     {availableCurrencies.length === 0 ? (
      <p className="px-3 py-3 text-sm text-fg-faint">{t('currency_catalog_empty')}</p>
     ) : filteredCurrencies.length > 0 ? (
      filteredCurrencies.map((currency) => (
       <button
        key={currency.id}
        type="button"
        disabled={savingId != null}
        onClick={() => void onPick(currency.id)}
        className="flex w-full items-center gap-3 px-3 py-2 text-start text-sm text-fg-muted transition hover:bg-surface hover:text-fg disabled:cursor-wait"
       >
        <span className="w-12 shrink-0 font-mono font-semibold text-fg">{currency.code}</span>
        <span className="flex-1 truncate">{currency.name}</span>
        {savingId === currency.id ? <Spinner className="text-base" /> : null}
       </button>
      ))
     ) : (
      <p className="px-3 py-3 text-sm text-fg-faint">{t('currency_catalog_no_match')}</p>
     )}
    </div>
    <div className="mt-4 flex justify-end">
     <button
      type="button"
      onClick={onClose}
      className="rounded border border-border px-4 py-2 text-sm font-semibold text-fg-muted transition hover:bg-surface-hover"
     >
      {t('cancel')}
     </button>
    </div>
   </div>
  </div>
 );
}
