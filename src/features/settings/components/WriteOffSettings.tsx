'use client';

import { useMemo, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { accountingApi } from '@/lib/accountingApi';
import { useAppStatusStore } from '@/shared/store/appStatusStore';
import { panelClassName } from '@/shared/styles';
import { normalizeDecimalInput, formatAmountInput } from '@/shared/utils/decimal';
import { filterRealClientAccounts } from '@/shared/utils/systemAccounts';
import { SMALL_BALANCE_THRESHOLD } from '@/shared/utils/accountBalances';
import { useWorkspaceCache } from '@/features/workspace/hooks/useWorkspaceData';
import type { ClientAccount, Currency, WriteOffMargin } from '@/shared/types';

type WriteOffSettingsProps = {
 sessionUserId: string | null;
 workspaceId: string | null;
 isWorkspaceOwnerOrAdmin: boolean;
 clientAccounts: ClientAccount[];
 enabledCurrencies: Currency[];
 writeOffMargins: WriteOffMargin[];
};

/**
 * Settings > Write-off: per-currency margin around zero at which the Clients page offers
 * a one-click write-off. Only lists currencies that actually have a real (non-Treasury/
 * Cashbox) client account open — a currency enabled workspace-wide with no client using
 * it yet has nothing to configure here.
 */
export default function WriteOffSettings({
 sessionUserId,
 workspaceId,
 isWorkspaceOwnerOrAdmin,
 clientAccounts,
 enabledCurrencies,
 writeOffMargins,
}: WriteOffSettingsProps) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const setError = useAppStatusStore((s) => s.setError);
 const { invalidate } = useWorkspaceCache(sessionUserId, workspaceId);

 const [drafts, setDrafts] = useState<Record<number, string>>({});
 const [busyId, setBusyId] = useState<number | null>(null);

 const marginByCurrency = useMemo(() => new Map(writeOffMargins.map((margin) => [margin.currencyId, margin.threshold])), [writeOffMargins]);

 const eligibleCurrencies = useMemo(() => {
  const currencyIdsWithAccounts = new Set(filterRealClientAccounts(clientAccounts).map((account) => account.currencyId));
  return enabledCurrencies.filter((currency) => currencyIdsWithAccounts.has(currency.id)).sort((a, b) => a.code.localeCompare(b.code));
 }, [clientAccounts, enabledCurrencies]);

 const draftFor = (currency: Currency) => (currency.id in drafts ? drafts[currency.id] : String(marginByCurrency.get(currency.id) ?? SMALL_BALANCE_THRESHOLD));

 const saveMargin = async (currency: Currency) => {
  setBusyId(currency.id);
  try {
   const threshold = Number(normalizeDecimalInput(draftFor(currency))) || 0;
   await accountingApi.saveWriteOffMargin({ currencyId: currency.id, threshold });
   invalidate();
  } catch (error) {
   setError(error instanceof Error ? error.message : t('error_failed_save'));
  } finally {
   setBusyId(null);
  }
 };

 if (!isWorkspaceOwnerOrAdmin) return null;

 return (
  <section className={panelClassName}>
   <h3 className="text-lg font-semibold">{t('settings_writeoff_title')}</h3>
   <p className="mt-1 text-sm text-fg-muted">{t('settings_writeoff_description')}</p>

   {eligibleCurrencies.length === 0 ? (
    <p className="mt-4 text-sm text-fg-faint">{t('settings_writeoff_no_currencies')}</p>
   ) : (
    <div className="mt-4 flex flex-col gap-2">
     {eligibleCurrencies.map((currency) => (
      <div
       key={currency.id}
       className="flex items-center gap-2"
      >
       <span className="w-20 shrink-0 text-sm font-medium text-fg">{currency.symbol || currency.code}</span>
       <span className="text-fg-faint">±</span>
       <input
        type="text"
        inputMode="decimal"
        disabled={busyId === currency.id}
        value={formatAmountInput(draftFor(currency))}
        onChange={(event) => setDrafts((prev) => ({ ...prev, [currency.id]: normalizeDecimalInput(event.target.value) }))}
        className="w-32 rounded border border-border-strong bg-surface px-2 py-1 text-sm text-fg outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
       />
       <button
        type="button"
        disabled={busyId === currency.id}
        onClick={() => void saveMargin(currency)}
        className="rounded bg-accent px-3 py-1 text-xs font-semibold text-accent-contrast transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
       >
        {t('save')}
       </button>
      </div>
     ))}
    </div>
   )}
  </section>
 );
}
