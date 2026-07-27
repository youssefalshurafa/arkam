'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { renderIcon } from '@/shared/utils/icons';
import { panelClassName } from '@/shared/styles';
import { cashboxOwnerName } from '@/shared/utils/systemAccounts';
import { accountingApi } from '@/lib/accountingApi';
import { useSystemClients, useInvalidateSystemClients } from '@/features/treasury/hooks/useSystemClients';
import { computeClientLedgers } from '@/features/ledger/utils/ledgerBalances';
import SystemAccountLedgerTable from '@/features/treasury/components/SystemAccountLedgerTable';
import SystemEntryForm from '@/features/treasury/components/SystemEntryForm';
import type { ClientAccount, ClientAdjustment, Currency, Transaction } from '@/shared/types';

type TreasurySectionProps = {
 sessionUserId: string | null;
 workspaceId: string | null;
 // Empty string covers the brief window before the workspace roster has loaded.
 workspaceRole: 'owner' | 'admin' | 'member' | 'viewer' | '';
 // Owner/admin-controlled nav visibility toggle (Settings > Treasury) — see
 // saveTreasuryEnabled in db.js. The sidebar already hides the nav item when this is off;
 // this covers a direct deep-link to /treasury while it's disabled.
 treasuryEnabled: boolean;
 clientAccounts: ClientAccount[];
 transactions: Transaction[];
 adjustments: ClientAdjustment[];
 enabledCurrencies: Currency[];
 currencyMap: Map<number, Currency>;
 lockPastEditsEnabled: boolean;
 isRTL: boolean;
 invalidateWorkspace: () => void;
};

/**
 * Treasury & Cashbox: a workspace-wide Treasury (one central cash position, held in the
 * main currency) plus one personal Cashbox per non-viewer member. Both are ordinary hidden
 * `clients`/`client_accounts` rows (see listSystemClients/ensureTreasuryAndCashboxes in
 * db.js) — this page is deliberately modeled on the client ledger page (running-balance
 * table + a "new entry" form) rather than built from scratch.
 */
export default function TreasurySection({
 sessionUserId,
 workspaceId,
 workspaceRole,
 treasuryEnabled,
 clientAccounts,
 transactions,
 adjustments,
 enabledCurrencies,
 currencyMap,
 lockPastEditsEnabled,
 isRTL,
 invalidateWorkspace,
}: TreasurySectionProps) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const isViewer = workspaceRole === 'viewer';
 const isMember = workspaceRole === 'member';

 const systemClientsQuery = useSystemClients(sessionUserId, workspaceId, treasuryEnabled);
 const invalidateSystemClients = useInvalidateSystemClients(sessionUserId, workspaceId);
 const systemClients = useMemo(() => systemClientsQuery.data ?? [], [systemClientsQuery.data]);

 // Lazily bootstraps Treasury + one Cashbox per non-viewer member on first visit to this
 // section — safe to repeat (idempotent server-side), but only needs to fire once per mount.
 const bootstrapped = useRef(false);
 useEffect(() => {
  if (bootstrapped.current || isViewer || !workspaceId || !treasuryEnabled) return;
  bootstrapped.current = true;
  void (async () => {
   try {
    await accountingApi.ensureTreasuryAndCashboxes();
    invalidateWorkspace();
    await invalidateSystemClients();
   } catch {
    // Non-fatal: a transient failure here self-heals the next time this section opens.
   }
  })();
 }, [isViewer, workspaceId, treasuryEnabled, invalidateWorkspace, invalidateSystemClients]);

 const treasury = useMemo(() => systemClients.find((c) => c.systemKind === 'treasury') ?? null, [systemClients]);
 const cashboxes = useMemo(() => systemClients.filter((c) => c.systemKind === 'cashbox'), [systemClients]);
 const myCashbox = useMemo(() => cashboxes.find((c) => c.ownerUserId === sessionUserId) ?? null, [cashboxes, sessionUserId]);

 // A member never sees Treasury's own ledger (only uses it as a transfer counterparty from
 // inside their own cashbox's entry form), so their view auto-selects their cashbox and the
 // tab list never offers Treasury at all.
 const [selectedId, setSelectedId] = useState<number | null>(null);
 useEffect(() => {
  if (selectedId != null) return;
  if (isMember) {
   if (myCashbox) setSelectedId(myCashbox.id);
  } else if (treasury) {
   setSelectedId(treasury.id);
  } else if (myCashbox) {
   setSelectedId(myCashbox.id);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [isMember, treasury, myCashbox]);

 const selected = systemClients.find((c) => c.id === selectedId) ?? null;
 const clientAccountMap = useMemo(() => new Map(clientAccounts.map((a) => [a.id, a])), [clientAccounts]);

 const ledgers = useMemo(() => {
  if (!selected) return [];
  return computeClientLedgers({
   selectedClientForLedger: selected,
   section: 'treasury',
   pdfExportModal: null,
   enabled: true,
   clientAccounts,
   transactions,
   adjustments,
   reconciliations: [],
   clientAccountMap,
   currencyMap,
  });
 }, [selected, clientAccounts, transactions, adjustments, clientAccountMap, currencyMap]);

 if (!treasuryEnabled) {
  return <div className={`${panelClassName} text-sm text-fg-faint`}>{t('treasury_disabled_notice')}</div>;
 }

 if (systemClientsQuery.isLoading) {
  return <div className={`${panelClassName} text-sm text-fg-faint`}>{t('loading')}</div>;
 }

 if (isMember && !myCashbox) {
  return <div className={`${panelClassName} text-sm text-fg-faint`}>{t('treasury_empty_ledger')}</div>;
 }

 return (
  <section className="grid gap-6 xl:grid-cols-[260px_1fr]">
   <div className="flex flex-col gap-2">
    {!isMember && treasury ? (
     <button
      type="button"
      onClick={() => setSelectedId(treasury.id)}
      className={`flex items-center gap-2 rounded px-3 py-2 text-start text-sm font-medium transition ${
       selectedId === treasury.id ? 'bg-accent-weak text-accent' : 'bg-surface text-fg-muted hover:bg-surface-hover'
      }`}
     >
      {renderIcon('treasury', 'h-4 w-4')}
      {t('treasury_tab_treasury')}
     </button>
    ) : null}
    <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('treasury_tab_cashboxes')}</div>
    {(isMember ? (myCashbox ? [myCashbox] : []) : cashboxes).map((cashbox) => (
     <button
      key={cashbox.id}
      type="button"
      onClick={() => setSelectedId(cashbox.id)}
      className={`rounded px-3 py-2 text-start text-sm font-medium transition ${
       selectedId === cashbox.id ? 'bg-accent-weak text-accent' : 'bg-surface text-fg-muted hover:bg-surface-hover'
      }`}
     >
      {cashbox.ownerUserId === sessionUserId ? t('treasury_my_cashbox') : t('treasury_cashbox_of', { name: cashboxOwnerName(cashbox) })}
     </button>
    ))}
   </div>

   <div className="flex flex-col gap-6">
    {selected ? (
     <>
      <SystemAccountLedgerTable ledgers={ledgers} />
      {!isViewer ? (
       <SystemEntryForm
        mode={selected.systemKind}
        fixedSystemClient={selected}
        clientAccounts={clientAccounts}
        systemClients={systemClients}
        enabledCurrencies={enabledCurrencies}
        transactions={transactions}
        adjustments={adjustments}
        lockPastEditsEnabled={lockPastEditsEnabled}
        isRTL={isRTL}
        onSubmitted={() => {
         invalidateWorkspace();
         void invalidateSystemClients();
        }}
       />
      ) : null}
     </>
    ) : (
     <div className={`${panelClassName} text-sm text-fg-faint`}>{t('treasury_no_main_currency')}</div>
    )}
   </div>
  </section>
 );
}
