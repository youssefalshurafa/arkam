'use client';

import { useCallback, useMemo, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { accountingApi } from '@/lib/accountingApi';
import { useWorkspaceActions } from '@/features/workspace/hooks/useWorkspaceActions';
import { useLedgerStore } from '@/features/ledger/store/ledgerStore';
import { SkBar } from '@/shared/components/skeletons/Skeletons';
import { panelClassName, mutedPanelClassName } from '@/shared/styles';
import { renderIcon } from '@/shared/utils/icons';
import { formatDateValue, localDateKey } from '@/shared/utils/date';
import type { Client, ClientAccount, ClientAdjustment, Currency, HarvestRate, Section, Transaction } from '@/shared/types';
import type { PendingPricingEntry } from '@/features/clients/utils/clientBalances';
import PendingPricingModal from '@/features/organizations/components/PendingPricingModal';
import { computeGeneralBalance } from '../utils/harvestBalance';
import { computeHarvestAwaitingPricingByClient } from '../utils/harvestAwaitingPricing';
import { resolveHarvestRate } from '../utils/harvestRateResolver';
import HarvestRatesModal, { type HarvestPriceGroup } from './HarvestRatesModal';
import HarvestAwaitingPricingModal from './HarvestAwaitingPricingModal';

type HarvestSectionProps = {
  clientAccounts: ClientAccount[];
  clients: Client[];
  currencies: Currency[];
  transactions: Transaction[];
  adjustments: ClientAdjustment[];
  harvestRates: HarvestRate[];
  isLoading: boolean;
  navigateToSection: (section: Section) => void;
  onSaveRate: (entry: PendingPricingEntry, rate: string, reversed: boolean) => Promise<boolean>;
};

function WarnGlyph({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5" />
      <circle cx="12" cy="16" r="0.5" fill="currentColor" />
    </svg>
  );
}

// Every rate-group is keyed by organization only — every organization-less client is
// merged into one "no organization" bucket. Matches computeOverviewBalances's own
// grouping exactly (see harvestBalance.ts), since the general balance below IS the
// overview's grand-total calculation, just re-run with a cutoff date.
function orgGroupKey(organizationId: number | null): string {
  return `org:${organizationId ?? 'none'}`;
}

export default function HarvestSection({ clientAccounts, clients, currencies, transactions, adjustments, harvestRates, isLoading, navigateToSection, onSaveRate }: HarvestSectionProps) {
  const { language, isRTL } = useLanguage();
  const { t } = useTranslation(language);
  const numLocale = language === 'fr' ? 'en-US' : language;
  const ledgerDecimals = useLedgerStore((s) => s.ledgerDecimals);
  const ledgerDateFormat = useLedgerStore((s) => s.ledgerDateFormat);
  const { setters, invalidate, setError } = useWorkspaceActions();
  const setHarvestRates = setters.setHarvestRates;
  // The harvest day being viewed, as local `yyyy-mm-dd`. Defaults to today; the day
  // navigator lets the user step back to earlier days (and forward, up to today).
  const [selectedDay, setSelectedDay] = useState<string>(() => localDateKey());
  const [showRatesModal, setShowRatesModal] = useState(false);
  const [showAwaitingPricingModal, setShowAwaitingPricingModal] = useState(false);
  // Which client's pending rows are being priced from the second-level popup (opened by
  // clicking a client's count inside the awaiting-pricing list) — the same nested popup
  // pattern and component (PendingPricingModal) the organization page uses.
  const [pendingPricingClientId, setPendingPricingClientId] = useState<number | null>(null);
  const today = localDateKey();

  // Step the viewed day by whole days; clamp forward navigation at today (no future harvest).
  const shiftDay = useCallback(
    (deltaDays: number) => {
      const d = new Date(`${selectedDay}T12:00:00`);
      d.setDate(d.getDate() + deltaDays);
      const next = localDateKey(d);
      setSelectedDay(next > today ? today : next);
    },
    [selectedDay, today],
  );

  const dayBefore = useMemo(() => {
    const d = new Date(`${selectedDay}T12:00:00`);
    d.setDate(d.getDate() - 1);
    return localDateKey(d);
  }, [selectedDay]);

  const mainCurrency = useMemo(() => currencies.find((c) => c.isMain === 1) ?? null, [currencies]);

  const dateKey = selectedDay;

  // Effective rate for a day/currency/organization — an exact-day lookup only, no
  // inheritance from another day, so a rate saved for one day never affects another.
  const rateForGroup = useCallback(
    (day: string, currencyId: number, organizationId: number | null) => {
      if (mainCurrency && currencyId === mainCurrency.id) return 1;
      return resolveHarvestRate(harvestRates, day, organizationId, currencyId);
    },
    [harvestRates, mainCurrency],
  );

  // Resolver for the general-balance calc: keyed straight off an organizationId.
  const refRateForOrgOnDay = useCallback(
    (day: string) => (currencyId: number, organizationId: number | null) => rateForGroup(day, currencyId, organizationId),
    [rateForGroup],
  );

  const todayBalance = useMemo(
    () => computeGeneralBalance({ transactions, adjustments, clientAccounts, clients, currencies, language, day: selectedDay, refRate: refRateForOrgOnDay(selectedDay) }),
    [transactions, adjustments, clientAccounts, clients, currencies, language, selectedDay, refRateForOrgOnDay],
  );
  const yesterdayBalance = useMemo(
    () => computeGeneralBalance({ transactions, adjustments, clientAccounts, clients, currencies, language, day: dayBefore, refRate: refRateForOrgOnDay(dayBefore) }),
    [transactions, adjustments, clientAccounts, clients, currencies, language, dayBefore, refRateForOrgOnDay],
  );
  const profitLossMain = todayBalance.totalMain - yesterdayBalance.totalMain;

  // Every organization (and the "no organization" bucket) that currently holds a non-zero
  // balance in a non-main currency gets a price box — regardless of whether it transacted
  // today, since the general balance above prices EVERY held currency, not just today's.
  const priceGroups: HarvestPriceGroup[] = useMemo(() => {
    if (!mainCurrency) return [];
    const enabledNonMainIds = new Set(currencies.filter((c) => c.isMain !== 1 && c.isEnabled !== 0).map((c) => c.id));
    const currencyById = new Map(currencies.map((c) => [c.id, c]));
    const groups = new Map<string, HarvestPriceGroup>();
    for (const g of todayBalance.groups) {
      if (g.isMain || g.total === 0 || !enabledNonMainIds.has(g.currencyId)) continue;
      const currency = currencyById.get(g.currencyId);
      if (!currency) continue;
      const key = orgGroupKey(g.organizationId);
      let entry = groups.get(key);
      if (!entry) {
        entry = { key, name: g.organizationName ?? t('overview_no_organization'), organizationId: g.organizationId, currencies: new Map() };
        groups.set(key, entry);
      }
      entry.currencies.set(currency.id, currency);
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [currencies, mainCurrency, todayBalance.groups, t]);

  // A cell counts as "missing" when this exact day has no explicit rate of its own.
  const missingPriceInputCount = useMemo(() => {
    let n = 0;
    for (const group of priceGroups) {
      for (const currencyId of group.currencies.keys()) {
        const v = resolveHarvestRate(harvestRates, dateKey, group.organizationId, currencyId);
        if (!Number.isFinite(v) || v <= 0) n++;
      }
    }
    return n;
  }, [priceGroups, harvestRates, dateKey]);

  // Pre-resolved rate strings for the rates modal, keyed the same way its own inputs
  // are (`${currencyId}:${groupKey}`) — only this exact day's explicit rates, if any.
  const effectiveRateStrings = useMemo(() => {
    const map: Record<string, string> = {};
    for (const group of priceGroups) {
      for (const currencyId of group.currencies.keys()) {
        const v = resolveHarvestRate(harvestRates, dateKey, group.organizationId, currencyId);
        if (Number.isFinite(v)) map[`${currencyId}:${group.key}`] = String(v);
      }
    }
    return map;
  }, [priceGroups, harvestRates, dateKey]);

  // This day's transactions/adjustments still missing their own exchange rate entirely,
  // per client — the same pending list (and PendingPricingEntry shape) the organization
  // page and client ledger show, surfaced via the "N transactions awaiting pricing" popup.
  const awaitingPricingByClient = useMemo(
    () => computeHarvestAwaitingPricingByClient({ transactions, adjustments, clientAccounts, day: selectedDay }),
    [transactions, adjustments, clientAccounts, selectedDay],
  );
  const awaitingPricingTotalCount = useMemo(
    () => [...awaitingPricingByClient.values()].reduce((sum, entries) => sum + entries.length, 0),
    [awaitingPricingByClient],
  );
  const awaitingPricingRows = useMemo(() => {
    const clientNameById = new Map(clients.map((c) => [c.id, c.name]));
    return [...awaitingPricingByClient.entries()]
      .map(([clientId, entries]) => ({ clientId, clientName: clientNameById.get(clientId) ?? '', count: entries.length }))
      .sort((a, b) => a.clientName.localeCompare(b.clientName, language, { sensitivity: 'base' }));
  }, [awaitingPricingByClient, clients, language]);

  const mainCode = mainCurrency?.code ?? '';
  const money = (n: number) =>
    Number.isFinite(n) ? n.toLocaleString(numLocale, { maximumFractionDigits: 0 }) : '—';
  const signCls = (n: number) => (n > 0 ? 'text-good-text' : n < 0 ? 'text-bad-text' : 'text-fg-muted');

  const header = (
    <div className={`${panelClassName} flex flex-wrap items-start justify-between gap-4`}>
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-weak text-accent">
          {renderIcon('harvest', 'h-6 w-6')}
        </div>
        <div>
          <h2 className="text-xl font-bold text-fg">{t('harvest_title')}</h2>
          <p className="mt-0.5 max-w-xl text-sm text-fg-faint">{t('harvest_description')}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="inline-flex items-center gap-0.5 rounded border border-border-strong bg-surface-2 p-0.5">
          <button
            type="button"
            onClick={() => shiftDay(-1)}
            title={t('harvest_prev_day')}
            aria-label={t('harvest_prev_day')}
            className="rounded p-1.5 text-fg-muted transition hover:bg-surface-hover"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d={isRTL ? 'M9 18l6-6-6-6' : 'M15 18l-6-6 6-6'} />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setSelectedDay(today)}
            disabled={selectedDay === today}
            title={selectedDay === today ? undefined : t('harvest_day_today')}
            className="min-w-22 rounded px-2 py-1 text-center text-sm font-semibold text-fg tabular-nums transition hover:bg-surface-hover disabled:cursor-default disabled:hover:bg-transparent"
          >
            {selectedDay === today ? t('harvest_day_today') : formatDateValue(selectedDay, 'day-month-year-2')}
          </button>
          <button
            type="button"
            onClick={() => shiftDay(1)}
            disabled={selectedDay >= today}
            title={t('harvest_next_day')}
            aria-label={t('harvest_next_day')}
            className="rounded p-1.5 text-fg-muted transition hover:bg-surface-hover disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d={isRTL ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'} />
            </svg>
          </button>
        </div>
        <button
          type="button"
          onClick={() => setShowRatesModal(true)}
          className="inline-flex h-9 items-center gap-1.5 rounded border border-border-strong bg-surface-2 px-3 text-sm font-semibold text-fg-muted transition hover:bg-surface-hover"
        >
          {t('harvest_todays_price_title')}
          {missingPriceInputCount > 0 ? (
            <span className="rounded-full bg-warn-bg px-1.5 py-0.5 text-xs font-semibold text-warn-text">{missingPriceInputCount}</span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => navigateToSection('transactions')}
          className="inline-flex h-9 items-center rounded border border-border-strong bg-surface-2 px-3 text-sm font-semibold text-fg-muted transition hover:bg-surface-hover"
        >
          {t('nav_transactions')}
        </button>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <div className={panelClassName}>
          <SkBar w="w-40" h="h-5" />
          <div className="mt-4 flex flex-col gap-2">
            {Array.from({ length: 5 }, (_, i) => (
              <SkBar key={i} w="w-full" h="h-4" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!mainCurrency) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <div className={`${panelClassName} flex flex-col items-center justify-center gap-2 px-6 py-16 text-center`}>
          <span className="inline-flex items-center gap-2 rounded-full bg-warn-bg px-3 py-1 text-xs font-semibold text-warn-text">
            {t('harvest_no_main_currency')}
          </span>
          <button
            type="button"
            onClick={() => navigateToSection('currencies')}
            className="mt-2 inline-flex h-9 items-center rounded border border-border-strong bg-surface-2 px-3 text-sm font-semibold text-fg-muted transition hover:bg-surface-hover"
          >
            {t('nav_currencies')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {header}

      {awaitingPricingTotalCount > 0 ? (
        <button
          type="button"
          onClick={() => setShowAwaitingPricingModal(true)}
          className="inline-flex w-fit items-center gap-2 rounded-full bg-warn-bg px-3 py-1.5 text-sm font-semibold text-warn-text transition hover:opacity-90"
        >
          <WarnGlyph className="h-4 w-4 shrink-0" />
          {t('harvest_awaiting_pricing_count', { count: awaitingPricingTotalCount })}
        </button>
      ) : null}

      <div className={mutedPanelClassName}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-fg">{t('overview_general_balance')}</span>
          <span className="text-xs text-fg-faint">{selectedDay === today ? t('harvest_day_today') : formatDateValue(selectedDay, 'day-month-year-2')}</span>
        </div>

        {todayBalance.orgTotals.length === 0 ? (
          <p className="mt-4 text-sm text-fg-faint">{t('harvest_no_transactions_today')}</p>
        ) : (
          <div className="mt-2 flex flex-col divide-y divide-border">
            {todayBalance.orgTotals.map((org) => (
              <div key={org.organizationId ?? 'none'} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="truncate text-fg-muted">{org.organizationName ?? t('overview_no_organization')}</span>
                <span dir="ltr" className={`shrink-0 font-medium ${signCls(org.totalMain)}`}>
                  {money(org.totalMain)} {mainCode}
                  {org.rateMissing ? <span className="ms-1 text-warn-text">*</span> : null}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-2 flex items-center justify-between gap-3 border-t border-border pt-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('overview_grand_total')}</span>
          <span dir="ltr" className={`text-lg font-bold ${signCls(todayBalance.totalMain)}`}>
            {money(todayBalance.totalMain)} {mainCode}
          </span>
        </div>
        {todayBalance.anyRateMissing ? <p className="mt-1 text-xs text-warn-text">{t('overview_set_rate')}</p> : null}
      </div>

      <div className={`${mutedPanelClassName} flex flex-wrap items-center justify-between gap-4`}>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{t('harvest_balance_yesterday')}</div>
          <div dir="ltr" className={`mt-1 text-lg font-bold ${signCls(yesterdayBalance.totalMain)}`}>
            {money(yesterdayBalance.totalMain)} {mainCode}
            {yesterdayBalance.anyRateMissing ? <span className="ms-1 text-warn-text">*</span> : null}
          </div>
        </div>
        <div className={isRTL ? 'text-left' : 'text-right'}>
          <div className="text-xs font-semibold uppercase tracking-wide text-fg-faint">
            {profitLossMain >= 0 ? t('harvest_profit') : t('harvest_loss')}
          </div>
          <div dir="ltr" className={`mt-1 text-2xl font-bold ${signCls(profitLossMain)}`}>
            {profitLossMain > 0 ? '+' : ''}
            {money(profitLossMain)} {mainCode}
          </div>
        </div>
      </div>

      {showRatesModal ? (
        <HarvestRatesModal
          mainCode={mainCode}
          priceGroups={priceGroups}
          rates={effectiveRateStrings}
          onSave={async (edits) => {
            const orgIdByGroupKey = new Map(priceGroups.map((g) => [g.key, g.organizationId]));
            try {
              await Promise.all(
                edits.map(async (edit) => {
                  const organizationId = orgIdByGroupKey.get(edit.groupKey) ?? null;
                  const result = (await accountingApi.saveHarvestRate({
                    day: dateKey,
                    organizationId,
                    currencyId: edit.currencyId,
                    rate: edit.value,
                  })) as { ok: true; deleted?: boolean; row?: HarvestRate };
                  setHarvestRates((prev) => {
                    const withoutThis = prev.filter(
                      (r) => !(r.day === dateKey && r.currencyId === edit.currencyId && (r.organizationId ?? null) === organizationId),
                    );
                    return result.deleted || !result.row ? withoutThis : [...withoutThis, result.row];
                  });
                }),
              );
              setError('');
              await invalidate();
            } catch (e) {
              setError(e instanceof Error ? e.message : t('error_failed_save'));
            }
          }}
          onClose={() => setShowRatesModal(false)}
        />
      ) : null}

      {showAwaitingPricingModal ? (
        <HarvestAwaitingPricingModal
          rows={awaitingPricingRows}
          onSelectClient={(clientId) => setPendingPricingClientId(clientId)}
          onClose={() => setShowAwaitingPricingModal(false)}
        />
      ) : null}

      {pendingPricingClientId != null ? (
        <PendingPricingModal
          clientName={clients.find((c) => c.id === pendingPricingClientId)?.name ?? null}
          entries={awaitingPricingByClient.get(pendingPricingClientId) ?? []}
          numLocale={numLocale}
          ledgerDecimals={ledgerDecimals}
          ledgerDateFormat={ledgerDateFormat}
          onClose={() => setPendingPricingClientId(null)}
          onSaveRate={onSaveRate}
        />
      ) : null}
    </div>
  );
}
