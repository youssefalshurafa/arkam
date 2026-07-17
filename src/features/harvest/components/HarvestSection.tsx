'use client';

import { useCallback, useMemo, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { accountingApi } from '@/lib/accountingApi';
import { useWorkspaceActions } from '@/features/workspace/hooks/useWorkspaceActions';
import { SkBar } from '@/shared/components/skeletons/Skeletons';
import { panelClassName, mutedPanelClassName } from '@/shared/styles';
import { renderIcon } from '@/shared/utils/icons';
import { formatDateValue, localDateKey } from '@/shared/utils/date';
import type { Client, ClientAccount, ClientAdjustment, Currency, HarvestRate, Section, Transaction } from '@/shared/types';
import { computeHarvestFlow } from '../utils/harvestFlow';
import { computeGeneralBalance } from '../utils/harvestBalance';
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

export default function HarvestSection({ clientAccounts, clients, currencies, transactions, adjustments, harvestRates, isLoading, navigateToSection }: HarvestSectionProps) {
  const { language, isRTL } = useLanguage();
  const { t } = useTranslation(language);
  const numLocale = language === 'fr' ? 'en-US' : language;
  const { setters, invalidate, setError } = useWorkspaceActions();
  const setHarvestRates = setters.setHarvestRates;
  // The harvest day being viewed, as local `yyyy-mm-dd`. Defaults to today; the day
  // navigator lets the user step back to earlier days (and forward, up to today).
  const [selectedDay, setSelectedDay] = useState<string>(() => localDateKey());
  const [showRatesModal, setShowRatesModal] = useState(false);
  const [showAwaitingPricingModal, setShowAwaitingPricingModal] = useState(false);
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
  const accountMap = useMemo(() => new Map(clientAccounts.map((a) => [a.id, a])), [clientAccounts]);
  const clientMap = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);

  const rateGroupOfAccount = useCallback(
    (accountId: number | null): { key: string; name: string; organizationId: number | null } | null => {
      if (accountId == null) return null;
      const account = accountMap.get(accountId);
      if (!account) return null;
      const client = clientMap.get(account.clientId);
      const organizationId = client?.organizationId ?? null;
      return {
        key: orgGroupKey(organizationId),
        name: organizationId != null ? client?.organizationName || t('unassigned') : t('overview_no_organization'),
        organizationId,
      };
    },
    [accountMap, clientMap, t],
  );

  const dateKey = selectedDay;

  // Effective rate for a day/currency/organization, inheriting the nearest earlier
  // explicit day when this exact day has no rate of its own (resolveHarvestRate
  // never writes, so this fallback can never mutate a past day's saved value).
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

  // Resolver for computeHarvestFlow (per-transaction-leg accountId, today only).
  const refRate = useCallback(
    (currencyId: number, accountId: number | null) => {
      if (mainCurrency && currencyId === mainCurrency.id) return 1;
      const group = rateGroupOfAccount(accountId);
      if (!group) return NaN;
      return rateForGroup(selectedDay, currencyId, group.organizationId);
    },
    [mainCurrency, rateGroupOfAccount, rateForGroup, selectedDay],
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

  // A cell counts as "missing" only when there's no EFFECTIVE rate at all (not even
  // an inherited one from an earlier day) — an inherited value is not missing.
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

  // Pre-resolved effective rate strings for the rates modal, keyed the same way its
  // own inputs are (`${currencyId}:${groupKey}`) — lets the modal keep its existing
  // buffer-then-Save logic unchanged while showing inherited values as live defaults.
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

  // Today's individual transactions still lacking a resolvable rate — informational only
  // (the "N transactions awaiting pricing" popup), not shown as page content anymore.
  const flow = useMemo(
    () => computeHarvestFlow({ transactions, clientAccounts, currencies, refRate, day: selectedDay }),
    [transactions, clientAccounts, currencies, refRate, selectedDay],
  );
  const awaitingPricingEntries = useMemo(
    () =>
      [...flow.incoming, ...flow.outgoing]
        .filter((e) => e.hasMissingRate)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [flow.incoming, flow.outgoing],
  );

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

      {awaitingPricingEntries.length > 0 ? (
        <button
          type="button"
          onClick={() => setShowAwaitingPricingModal(true)}
          className="inline-flex w-fit items-center gap-2 rounded-full bg-warn-bg px-3 py-1.5 text-sm font-semibold text-warn-text transition hover:opacity-90"
        >
          <WarnGlyph className="h-4 w-4 shrink-0" />
          {t('harvest_awaiting_pricing_count', { count: awaitingPricingEntries.length })}
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
        <HarvestAwaitingPricingModal entries={awaitingPricingEntries} onClose={() => setShowAwaitingPricingModal(false)} />
      ) : null}
    </div>
  );
}
