'use client';

import { useCallback, useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { SkBar } from '@/shared/components/skeletons/Skeletons';
import { panelClassName, mutedPanelClassName, tableWrapClassName } from '@/shared/styles';
import { renderIcon } from '@/shared/utils/icons';
import { normalizeDecimalInput } from '@/shared/utils/decimal';
import type { ClientAccount, Currency, Section, Transaction } from '@/shared/types';
import { computeHarvest, type HarvestTxKind } from '../utils/harvestProfit';
import { useHarvestRatesStore, harvestRateKey, localDateKey } from '../store/harvestRatesStore';

type HarvestSectionProps = {
  clientAccounts: ClientAccount[];
  currencies: Currency[];
  transactions: Transaction[];
  isLoading: boolean;
  navigateToSection: (section: Section) => void;
};

const KIND_TONE: Record<HarvestTxKind, string> = {
  sell: 'bg-good-bg text-good-text',
  buy: 'bg-info-bg text-info-text',
  exchange: 'bg-violet-bg text-violet-text',
  transfer: 'bg-surface-2 text-fg-faint',
  neutral: 'bg-surface-2 text-fg-faint',
};

export default function HarvestSection({ clientAccounts, currencies, transactions, isLoading, navigateToSection }: HarvestSectionProps) {
  const { language, isRTL } = useLanguage();
  const { t } = useTranslation(language);
  const numLocale = language === 'fr' ? 'en-US' : language;

  const mainCurrency = useMemo(() => currencies.find((c) => c.isMain === 1) ?? null, [currencies]);
  const pricedCurrencies = useMemo(() => currencies.filter((c) => c.isMain !== 1 && c.isEnabled !== 0), [currencies]);
  const dateKey = localDateKey();
  const { rates, updateRate } = useHarvestRatesStore();

  const refRate = useCallback(
    (currencyId: number) => {
      if (mainCurrency && currencyId === mainCurrency.id) return 1;
      const raw = rates[harvestRateKey(dateKey, currencyId)];
      const n = Number(raw);
      return raw && Number.isFinite(n) && n > 0 ? n : NaN;
    },
    [rates, dateKey, mainCurrency],
  );

  const harvest = useMemo(
    () => computeHarvest({ transactions, clientAccounts, currencies, refRate }),
    [transactions, clientAccounts, currencies, refRate],
  );

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

      {pricedCurrencies.length > 0 ? (
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
          <div className="mt-3 flex flex-wrap gap-3">
            {pricedCurrencies.map((c) => (
              <label key={c.id} className="flex items-center gap-2 rounded border border-border bg-surface-2 px-2.5 py-1.5 text-sm text-fg-muted">
                <span dir="ltr" className="font-semibold text-fg">
                  1 {c.symbol || c.code} =
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  value={rates[harvestRateKey(dateKey, c.id)] ?? ''}
                  onChange={(e) => updateRate(dateKey, c.id, normalizeDecimalInput(e.target.value))}
                  className="w-24 rounded border border-border-strong bg-surface px-2 py-1 text-sm outline-none ring-blue-300 focus:ring"
                />
                <span className="text-fg-faint">{mainCode}</span>
              </label>
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
                  <th className={`px-3 py-2 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_account_from')}</th>
                  <th className={`px-3 py-2 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_account_to')}</th>
                  <th className={`px-3 py-2 font-semibold ${isRTL ? 'text-right' : 'text-left'}`}>{t('transaction_type')}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t('amount')}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t('harvest_profit_column')} ({mainCode})</th>
                </tr>
              </thead>
              <tbody>
                {harvest.rows.map((row) => (
                  <tr key={row.transactionId} className="border-b border-border/60 last:border-0">
                    <td className={`px-3 py-2 font-semibold text-fg ${isRTL ? 'text-right' : 'text-left'}`}>{row.clientFromName || '—'}</td>
                    <td className={`px-3 py-2 text-fg-muted ${isRTL ? 'text-right' : 'text-left'}`}>{row.clientToName || '—'}</td>
                    <td className={`px-3 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>
                      <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ${KIND_TONE[row.kind]}`}>
                        {t(`harvest_kind_${row.kind}`)}
                      </span>
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
    </div>
  );
}
