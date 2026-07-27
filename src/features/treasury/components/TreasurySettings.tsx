'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { accountingApi } from '@/lib/accountingApi';
import { useAppStatusStore } from '@/shared/store/appStatusStore';
import { panelClassName } from '@/shared/styles';
import { normalizeDecimalInput, formatAmountInput } from '@/shared/utils/decimal';
import { cashboxOwnerName } from '@/shared/utils/systemAccounts';
import { useWorkspaceCache } from '@/features/workspace/hooks/useWorkspaceData';
import { useSystemClients, useInvalidateSystemClients } from '@/features/treasury/hooks/useSystemClients';
import type { ClientAccount, Currency, SystemClient } from '@/shared/types';

type TreasurySettingsProps = {
 sessionUserId: string | null;
 workspaceId: string | null;
 isWorkspaceOwner: boolean;
 isWorkspaceOwnerOrAdmin: boolean;
 treasuryEnabled: boolean;
 setTreasuryEnabled: (enabled: boolean) => void;
 clientAccounts: ClientAccount[];
 enabledCurrencies: Currency[];
};

/**
 * A single Treasury/Cashbox system client's opening-balance card: one row per currency
 * account it already holds, plus a picker to open a new currency (created at 0, then
 * immediately editable) — the same idempotent ensureSystemAccount used by the entry form.
 */
function SystemClientBalanceCard({
 systemClient,
 accounts,
 enabledCurrencies,
 canEdit,
 onSaved,
}: {
 systemClient: SystemClient;
 accounts: ClientAccount[];
 enabledCurrencies: Currency[];
 canEdit: boolean;
 onSaved: () => void;
}) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const setError = useAppStatusStore((s) => s.setError);
 const showToast = useAppStatusStore((s) => s.showToast);

 const [drafts, setDrafts] = useState<Record<number, string>>({});
 const [busyId, setBusyId] = useState<number | null>(null);
 const [newCurrencyId, setNewCurrencyId] = useState('');

 // Sign note: `client_accounts.starting_balance` feeds computeClientLedgers using the same
 // Sender-increases/Receiver-decreases convention as every transaction (see
 // SystemAccountLedgerTable's sign-note comment) — a positive stored value reads as MORE
 // owed to this account, not more cash held. Since this field is a direct entry rather than
 // a transaction, there's no counterparty ledger depending on its raw sign, so it's negated
 // here at both the read and write edges: the owner types/sees a plain "cash on hand" number,
 // and the ledger table's own display-negation then shows that exact number back correctly.
 const draftFor = (account: ClientAccount) => (account.id in drafts ? drafts[account.id] : String(-(account.startingBalance ?? 0)));

 const availableCurrencies = enabledCurrencies.filter((currency) => !accounts.some((a) => a.currencyId === currency.id));

 const saveBalance = async (account: ClientAccount) => {
  setBusyId(account.id);
  try {
   const cashOnHand = Number(normalizeDecimalInput(draftFor(account))) || 0;
   await accountingApi.updateClientAccountStartingBalance({ accountId: account.id, startingBalance: -cashOnHand });
   showToast(t('settings_treasury_balance_saved'));
   onSaved();
  } catch (error) {
   setError(error instanceof Error ? error.message : t('error_failed_save'));
  } finally {
   setBusyId(null);
  }
 };

 const addCurrency = async () => {
  const currencyId = Number(newCurrencyId);
  if (!currencyId) return;
  setBusyId(-1);
  try {
   await accountingApi.ensureSystemAccount({ systemClientId: systemClient.id, currencyId });
   setNewCurrencyId('');
   onSaved();
  } catch (error) {
   setError(error instanceof Error ? error.message : t('error_failed_save'));
  } finally {
   setBusyId(null);
  }
 };

 return (
  <div className="border border-border p-4">
   <h4 className="text-sm font-semibold text-fg">
    {systemClient.systemKind === 'treasury' ? t('treasury_tab_treasury') : t('treasury_cashbox_of', { name: cashboxOwnerName(systemClient) })}
   </h4>
   <div className="mt-3 flex flex-col gap-2">
    {accounts.map((account) => (
     <div
      key={account.id}
      className="flex items-center gap-2"
     >
      <span className="w-16 shrink-0 text-xs font-medium text-fg-muted">{account.currencyCode}</span>
      <input
       type="text"
       inputMode="decimal"
       disabled={!canEdit || busyId === account.id}
       value={formatAmountInput(draftFor(account))}
       onChange={(event) => setDrafts((prev) => ({ ...prev, [account.id]: normalizeDecimalInput(event.target.value) }))}
       className="w-40 rounded border border-border-strong bg-surface px-2 py-1 text-sm text-fg outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
      />
      {canEdit ? (
       <button
        type="button"
        disabled={busyId === account.id}
        onClick={() => void saveBalance(account)}
        className="rounded bg-accent px-3 py-1 text-xs font-semibold text-accent-contrast transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
       >
        {t('save')}
       </button>
      ) : null}
     </div>
    ))}
   </div>
   {canEdit && availableCurrencies.length > 0 ? (
    <div className="mt-3 flex items-center gap-2">
     <select
      value={newCurrencyId}
      onChange={(event) => setNewCurrencyId(event.target.value)}
      className="rounded border border-border-strong bg-surface px-2 py-1 text-xs text-fg outline-none focus:ring-1 focus:ring-accent"
     >
      <option value="">{t('settings_treasury_add_currency')}</option>
      {availableCurrencies.map((currency) => (
       <option
        key={currency.id}
        value={currency.id}
       >
        {currency.code}
       </option>
      ))}
     </select>
     <button
      type="button"
      disabled={!newCurrencyId || busyId === -1}
      onClick={() => void addCurrency()}
      className="rounded border border-border-strong px-3 py-1 text-xs font-semibold text-fg-muted transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
     >
      {t('settings_treasury_add_currency')}
     </button>
    </div>
   ) : null}
  </div>
 );
}

/**
 * Settings > Treasury: the nav-visibility toggle plus the opening-balance editor. Both the
 * toggle and the balance editor operate on the SAME underlying Treasury/Cashbox
 * clients/accounts as the main Treasury page — this is deliberately not a separate config
 * store, just an owner/admin-facing view into `starting_balance` on those accounts (exactly
 * the same field every normal client account already has).
 */
export default function TreasurySettings({
 sessionUserId,
 workspaceId,
 isWorkspaceOwner,
 isWorkspaceOwnerOrAdmin,
 treasuryEnabled,
 setTreasuryEnabled,
 clientAccounts,
 enabledCurrencies,
}: TreasurySettingsProps) {
 const { language, isRTL } = useLanguage();
 const { t } = useTranslation(language);
 const { invalidate } = useWorkspaceCache(sessionUserId, workspaceId);

 const systemClientsQuery = useSystemClients(sessionUserId, workspaceId, isWorkspaceOwnerOrAdmin);
 const invalidateSystemClients = useInvalidateSystemClients(sessionUserId, workspaceId);
 const systemClients = useMemo(() => systemClientsQuery.data ?? [], [systemClientsQuery.data]);

 // Opening this tab bootstraps Treasury + every member's cashbox, same as visiting the
 // Treasury page itself — so opening balances can be set up before ever flipping the
 // nav-visibility toggle on.
 const bootstrapped = useRef(false);
 useEffect(() => {
  if (bootstrapped.current || !isWorkspaceOwnerOrAdmin || !workspaceId) return;
  bootstrapped.current = true;
  void (async () => {
   try {
    await accountingApi.ensureTreasuryAndCashboxes();
    invalidate();
    await invalidateSystemClients();
   } catch {
    // Non-fatal — retried next time this tab opens.
   }
  })();
 }, [isWorkspaceOwnerOrAdmin, workspaceId, invalidate, invalidateSystemClients]);

 const treasury = useMemo(() => systemClients.find((c) => c.systemKind === 'treasury') ?? null, [systemClients]);
 const cashboxes = useMemo(() => systemClients.filter((c) => c.systemKind === 'cashbox'), [systemClients]);

 const accountsByClientId = useMemo(() => {
  const map = new Map<number, ClientAccount[]>();
  for (const account of clientAccounts) {
   if (!account.isSystem) continue;
   const list = map.get(account.clientId) ?? [];
   list.push(account);
   map.set(account.clientId, list);
  }
  return map;
 }, [clientAccounts]);

 const onSaved = () => {
  invalidate();
  void invalidateSystemClients();
 };

 if (!isWorkspaceOwnerOrAdmin) return null;

 return (
  <section className="flex flex-col gap-6">
   <div className={panelClassName}>
    <div className="flex items-start justify-between gap-4">
     <div>
      <h3 className="text-lg font-semibold">{t('settings_treasury_enable_title')}</h3>
      <p className="mt-1 text-sm text-fg-muted">{t('settings_treasury_enable_description')}</p>
     </div>
     <button
      type="button"
      role="switch"
      aria-checked={treasuryEnabled}
      onClick={() => setTreasuryEnabled(!treasuryEnabled)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${treasuryEnabled ? 'bg-blue-600' : 'bg-slate-300'}`}
     >
      <span
       className={`inline-block h-5 w-5 transform rounded-full bg-surface shadow transition ${
        treasuryEnabled ? (isRTL ? '-translate-x-5' : 'translate-x-5') : isRTL ? '-translate-x-0.5' : 'translate-x-0.5'
       }`}
      />
     </button>
    </div>
   </div>

   <div className={panelClassName}>
    <h3 className="text-lg font-semibold">{t('settings_treasury_opening_balance_title')}</h3>
    <p className="mt-1 text-sm text-fg-muted">{t('settings_treasury_opening_balance_description')}</p>
    {!isWorkspaceOwner ? <p className="mt-2 text-xs text-fg-faint">{t('settings_treasury_opening_balance_owner_only')}</p> : null}

    <div className="mt-4 flex flex-col gap-3">
     {treasury ? (
      <SystemClientBalanceCard
       systemClient={treasury}
       accounts={accountsByClientId.get(treasury.id) ?? []}
       enabledCurrencies={enabledCurrencies}
       canEdit={isWorkspaceOwner}
       onSaved={onSaved}
      />
     ) : null}
     {cashboxes.map((cashbox) => (
      <SystemClientBalanceCard
       key={cashbox.id}
       systemClient={cashbox}
       accounts={accountsByClientId.get(cashbox.id) ?? []}
       enabledCurrencies={enabledCurrencies}
       canEdit={isWorkspaceOwner}
       onSaved={onSaved}
      />
     ))}
    </div>
   </div>
  </section>
 );
}
