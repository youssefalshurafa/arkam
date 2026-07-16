'use client';

import { useCallback, useMemo, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { SkBar } from '@/shared/components/skeletons/Skeletons';
import { panelClassName, mutedPanelClassName, tableWrapClassName } from '@/shared/styles';
import { renderIcon } from '@/shared/utils/icons';
import { normalizeDecimalInput } from '@/shared/utils/decimal';
import { formatTimeValue } from '@/shared/utils/date';
import { ContextMenu, useContextMenu } from '@/shared/components/ContextMenu';
import { useTransactionsStore } from '@/features/transactions/store/transactionsStore';
import type { Client, ClientAccount, Currency, Section, Transaction } from '@/shared/types';
import { computeHarvest } from '../utils/harvestProfit';
import { useHarvestRatesStore, harvestRateKey, localDateKey } from '../store/harvestRatesStore';

type HarvestSectionProps = {
  clientAccounts: ClientAccount[];
  clients: Client[];
  currencies: Currency[];
  transactions: Transaction[];
  isLoading: boolean;
  navigateToSection: (section: Section) => void;
  onSaveHarvestRowType: (transactionId: number, type: string) => void | Promise<void>;
};

export default function HarvestSection({ clientAccounts, clients, currencies, transactions, isLoading, navigateToSection, onSaveHarvestRowType }: HarvestSectionProps) {
  const { language, isRTL } = useLanguage();
  const { t } = useTranslation(language);
  const numLocale = language === 'fr' ? 'en-US' : language;
  const [rowSortDir, setRowSortDir] = useState<'asc' | 'desc'>('asc');
  const setInfoTransactionId = useTransactionsStore((s) => s.setInfoTransactionId);
  const rowContextMenu = useContextMenu();

  const mainCurrency = useMemo(() => currencies.find((c) => c.isMain === 1) ?? null, [currencies]);
  const accountMap = useMemo(() => new Map(clientAccounts.map((a) => [a.id, a])), [clientAccounts]);
  const clientMap = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);

  // Different organizations (or standalone clients with no organization) trade the
  // same foreign currency at different rates, so "today's price" is entered per
  // rate-group rather than once globally per currency.
  const rateGroupOfAccount = useCallback(
    (accountId: number | null): { key: string; name: string } | null => {
      if (accountId == null) return null;
      const account = accountMap.get(accountId);
      if (!account) return null;
      const client = clientMap.get(account.clientId);
      if (client?.organizationId != null) {
        return { key: `org:${client.organizationId}`, name: client.organizationName || t('unassigned') };
      }
      return { key: `client:${account.clientId}`, name: account.clientName || client?.name || '' };
    },
    [accountMap, clientMap, t],
  );

  const dateKey = localDateKey();
  const { rates, updateRate } = useHarvestRatesStore();

  const refRate = useCallback(
    (currencyId: number, accountId: number | null) => {
      if (mainCurrency && currencyId === mainCurrency.id) return 1;
      const group = rateGroupOfAccount(accountId);
      if (!group) return NaN;
      const raw = rates[harvestRateKey(dateKey, currencyId, group.key)];
      const n = Number(raw);
      return raw && Number.isFinite(n) && n > 0 ? n : NaN;
    },
    [rates, dateKey, mainCurrency, rateGroupOfAccount],
  );

  const harvest = useMemo(
    () => computeHarvest({ transactions, clientAccounts, currencies, refRate }),
    [transactions, clientAccounts, currencies, refRate],
  );

  // Only organizations/standalone clients that actually appear in today's transactions
  // table get a rate box — no point pricing currencies nobody traded today.
  const priceGroups = useMemo(() => {
    if (!mainCurrency) return [];
    const enabledNonMainIds = new Set(currencies.filter((c) => c.isMain !== 1 && c.isEnabled !== 0).map((c) => c.id));
    const currencyById = new Map(currencies.map((c) => [c.id, c]));
    const todayTransactionIds = new Set(harvest.rows.map((r) => r.transactionId));
    const todayAccountIds = new Set<number>();
    for (const tx of transactions) {
      if (!todayTransactionIds.has(tx.id)) continue;
      if (tx.accountFromId != null) todayAccountIds.add(tx.accountFromId);
      if (tx.accountToId != null) todayAccountIds.add(tx.accountToId);
    }
    const groups = new Map<string, { key: string; name: string; currencies: Map<number, Currency> }>();
    for (const accountId of todayAccountIds) {
      const account = accountMap.get(accountId);
      if (!account || !enabledNonMainIds.has(account.currencyId)) continue;
      const group = rateGroupOfAccount(accountId);
      const currency = currencyById.get(account.currencyId);
      if (!group || !currency) continue;
      let entry = groups.get(group.key);
      if (!entry) {
        entry = { key: group.key, name: group.name, currencies: new Map() };
        groups.set(group.key, entry);
      }
      entry.currencies.set(currency.id, currency);
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [accountMap, currencies, mainCurrency, rateGroupOfAccount, harvest.rows, transactions]);

  // harvest.rows is engine-sorted oldest → newest; flip it for a descending view.
  const sortedRows = useMemo(() => (rowSortDir === 'asc' ? harvest.rows : [...harvest.rows].reverse()), [harvest.rows, rowSortDir]);

  const mainCode = harvest.mainCurrencyCode;
  const money = (n: number) =>
    Number.isFinite(n) ? n.toLocaleString(numLocale, { maximumFractionDigits: 2 }) : '—';
  const units = (n: number) => n.toLocaleString(numLocale, { maximumFractionDigits: 2 });
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
      <button
        type="button"
        onClick={() => navigateToSection('transactions')}
        className="inline-flex h-9 items-center rounded border border-border-strong bg-surface-2 px-3 text-sm font-semibold text-fg-muted transition hover:bg-surface-hover"
      >
        {t('nav_transactions')}
      </button>
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className={mutedPanelClassName}>
              <SkBar w="w-20" h="h-3" />
              <div className="mt-3">
                <SkBar w="w-28" h="h-6" />
              </div>
            </div>
          ))}
        </div>
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

  if (!harvest.hasMainCurrency) {
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

  const kpis = [
    { label: t('harvest_total_profit'), value: `${money(harvest.totalProfitMain)} ${mainCode}`, tone: signCls(harvest.totalProfitMain), big: true },
    { label: t('harvest_bought'), value: `${money(harvest.totalBoughtMain)} ${mainCode}`, tone: 'text-fg' },
    { label: t('harvest_sold'), value: `${money(harvest.totalSoldMain)} ${mainCode}`, tone: 'text-fg' },
    { label: t('harvest_tx_count'), value: String(harvest.rows.length), tone: 'text-fg' },
  ];

  return (
    <div className="flex flex-col gap-6">
      {header}

      {priceGroups.length > 0 ? (
        <div className={panelClassName}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-fg">{t('harvest_todays_price_title')}</h3>
            {harvest.missingRateCount > 0 ? (
              <span className="rounded-full bg-warn-bg px-2 py-0.5 text-xs font-semibold text-warn-text">
                {t('harvest_missing_rate_warning', { count: harvest.missingRateCount })}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-fg-faint">{t('harvest_todays_price_hint', { currency: mainCode })}</p>
          <div className="mt-3 flex flex-col gap-2.5">
            {priceGroups.map((group) => (
              <div key={group.key} className="rounded border border-border bg-surface-2 px-2.5 py-2">
                <div className="text-xs font-semibold text-fg">{group.name}</div>
                <div className="mt-1.5 flex flex-wrap gap-3">
                  {[...group.currencies.values()].map((c) => (
                    <label key={c.id} className="flex items-center gap-2 rounded border border-border bg-surface px-2.5 py-1.5 text-sm text-fg-muted">
                      <span dir="ltr" className="font-semibold text-fg">
                        1 {c.symbol || c.code} =
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        dir="ltr"
                        value={rates[harvestRateKey(dateKey, c.id, group.key)] ?? ''}
                        onChange={(e) => updateRate(dateKey, c.id, group.key, normalizeDecimalInput(e.target.value))}
                        className="w-24 rounded border border-border-strong bg-surface px-2 py-1 text-sm outline-none ring-blue-300 focus:ring"
                      />
                      <span className="text-fg-faint">{mainCode}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className={mutedPanelClassName}>
            <div className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{k.label}</div>
            <div dir="ltr" className={`mt-2 ${k.big ? 'text-2xl' : 'text-xl'} font-bold ${k.tone} ${isRTL ? 'text-right' : 'text-left'}`}>
              {k.value}
            </div>
          </div>
        ))}
      </div>

      {harvest.turnover.length > 0 ? (
        <div className={panelClassName}>
          <h3 className="text-sm font-semibold text-fg">{t('harvest_turnover')}</h3>
          <div className={tableWrapClassName}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-fg-faint">
                  <th className={`px-3 py-2 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('currency')}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t('harvest_bought')}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t('harvest_sold')}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t('harvest_net')}</th>
                </tr>
              </thead>
              <tbody>
                {harvest.turnover.map((row) => {
                  const net = row.boughtUnits - row.soldUnits;
                  return (
                    <tr key={row.currencyId} className="border-b border-border/60 last:border-0">
                      <td className={`px-3 py-2 font-semibold text-fg ${isRTL ? 'text-right' : 'text-left'}`}>{row.code}</td>
                      <td dir="ltr" className="px-3 py-2 text-right text-fg-muted">
                        {units(row.boughtUnits)}
                        <span className="text-fg-faint"> · {money(row.boughtMain)} {mainCode}</span>
                      </td>
                      <td dir="ltr" className="px-3 py-2 text-right text-fg-muted">
                        {units(row.soldUnits)}
                        <span className="text-fg-faint"> · {money(row.soldMain)} {mainCode}</span>
                      </td>
                      <td dir="ltr" className={`px-3 py-2 text-right font-semibold ${signCls(net)}`}>{units(net)} {row.code}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className={panelClassName}>
        <h3 className="text-sm font-semibold text-fg">{t('harvest_transactions_title')}</h3>
        {harvest.rows.length === 0 ? (
          <p className="mt-4 text-sm text-fg-faint">{t('harvest_no_transactions_today')}</p>
        ) : (
          <div className={tableWrapClassName}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-fg-faint">
                  <th className={`w-16 px-3 py-2 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>
                    <button
                      type="button"
                      onClick={() => setRowSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                      className="inline-flex items-center gap-1 hover:text-accent transition-colors"
                      title={rowSortDir === 'asc' ? t('sort_desc') : t('sort_asc')}
                    >
                      {t('harvest_time_column')}
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        {rowSortDir === 'asc' ? (
                          <>
                            <path d="M12 19V5" />
                            <path d="M5 12l7-7 7 7" />
                          </>
                        ) : (
                          <>
                            <path d="M12 5v14" />
                            <path d="M5 12l7 7 7-7" />
                          </>
                        )}
                      </svg>
                    </button>
                  </th>
                  <th className={`px-3 py-2 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_account_from')}</th>
                  <th className={`px-3 py-2 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_account_to')}</th>
                  <th className={`px-3 py-2 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_type')}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t('amount')}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t('harvest_profit_column')} ({mainCode})</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => (
                  <tr
                    key={row.transactionId}
                    className="border-b border-border/60 last:border-0"
                    onContextMenu={(e) =>
                      rowContextMenu.open(e, [
                        { key: 'info', label: t('transaction_more_info_action'), onSelect: () => setInfoTransactionId(row.transactionId) },
                      ])
                    }
                  >
                    <td dir="ltr" className="px-3 py-2 text-xs text-fg-faint whitespace-nowrap">{formatTimeValue(row.createdAt)}</td>
                    <td className={`px-3 py-2 font-semibold text-fg ${isRTL ? 'text-right' : 'text-left'}`}>{row.clientFromName || '—'}</td>
                    <td className={`px-3 py-2 text-fg-muted ${isRTL ? 'text-right' : 'text-left'}`}>{row.clientToName || '—'}</td>
                    <td className={`px-3 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>
                      {row.type === 'adjustment' ? (
                        <span className="inline-flex rounded bg-violet-bg px-2.5 py-1 text-xs font-semibold text-violet-text">{t('adjustment_label')}</span>
                      ) : (
                        <select
                          value={row.type}
                          onChange={(e) => void onSaveHarvestRowType(row.transactionId, e.target.value)}
                          className="rounded border border-border-strong bg-surface px-2 py-1.5 text-xs outline-none ring-blue-300 focus:ring"
                        >
                          <option value="buy">{t('transaction_type_buy')}</option>
                          <option value="sell">{t('transaction_type_sell')}</option>
                          <option value="exchange">{t('transaction_type_exchange')}</option>
                          <option value="transfer">{t('transaction_type_transfer')}</option>
                        </select>
                      )}
                    </td>
                    <td dir="ltr" className="px-3 py-2 text-right text-fg-muted">
                      {units(row.amount)} {row.currencySymbol || row.currencyCode}
                    </td>
                    <td dir="ltr" className={`px-3 py-2 text-right font-bold ${signCls(row.realizedProfitMain)}`}>
                      {row.kind === 'buy' || row.kind === 'transfer' || row.kind === 'neutral' || Math.abs(row.realizedProfitMain) < 0.005 ? '—' : money(row.realizedProfitMain)}
                      {row.hasMissingRate ? <span className="text-warn-text" title={t('harvest_row_missing_rate')}> *</span> : null}
                      {row.hasShortInventory ? <span className="text-warn-text" title={t('harvest_row_short_inventory')}> ⚠</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(harvest.missingRateCount > 0 || harvest.rows.some((r) => r.hasShortInventory)) ? (
          <p className="mt-3 text-xs text-warn-text">
            {harvest.missingRateCount > 0 ? `* ${t('harvest_row_missing_rate')} ` : ''}
            {harvest.rows.some((r) => r.hasShortInventory) ? `⚠ ${t('harvest_row_short_inventory')}` : ''}
          </p>
        ) : null}
      </div>
      <ContextMenu menu={rowContextMenu.menu} onClose={rowContextMenu.close} />
    </div>
  );
}
