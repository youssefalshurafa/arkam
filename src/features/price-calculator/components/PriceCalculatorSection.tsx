'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { panelClassName } from '@/shared/styles';
import { formatAmountInput, normalizeDecimalInput, normalizePlainDecimalInput } from '@/shared/utils/decimal';
import { ltrIsolate } from '@/shared/utils/format';
import { getStoredPriceCalculator, savePriceCalculator } from '@/shared/lib/localStorage';
import type { Currency } from '@/shared/types';
import { computePrice } from '../utils/priceCalc';

type PriceCalculatorSectionProps = {
 /** All workspace currencies (localized names). The main one is the `isMain === 1` entry. */
 currencies: Currency[];
};

const DEFAULT_FOREIGN_CODE = 'AED';
const SAVE_DEBOUNCE_MS = 400;

const inputClassName =
 'w-full rounded border border-border-strong bg-surface px-3 py-2 text-sm text-fg outline-none ring-blue-300 focus:ring disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-faint';

const parseNumber = (raw: string) => {
 const n = parseFloat(normalizeDecimalInput(raw));
 return Number.isFinite(n) ? n : NaN;
};

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

function FieldRow({ label, htmlFor, suffix, children }: { label: string; htmlFor: string; suffix?: string; children: ReactNode }) {
 return (
  <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-4">
   <label htmlFor={htmlFor} className="text-sm font-medium text-fg-muted">
    {label}
   </label>
   <div className="flex items-center gap-2">
    {children}
    {/* Always rendered (empty when there's no suffix) so every field lines up to the same width. */}
    <span dir="ltr" aria-hidden={!suffix} className="min-w-12 shrink-0 text-center text-xs font-semibold text-fg-faint">
     {suffix}
    </span>
   </div>
  </div>
 );
}

export default function PriceCalculatorSection({ currencies }: PriceCalculatorSectionProps) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);

 const mainCurrency = currencies.find((c) => c.isMain === 1);
 const mainCode = mainCurrency?.code ?? 'USD';
 const mainSymbol = mainCurrency?.symbol || mainCode;
 const mainName = mainCurrency?.name || mainCode;
 const mainIsUsd = mainCode === 'USD';

 const foreignOptions = useMemo(() => currencies.filter((c) => c.isEnabled === 1 && c.isMain !== 1), [currencies]);

 // Last-typed values, restored from (and synced through) the per-user settings.
 const [stored] = useState(() => getStoredPriceCalculator());
 const [pickedCode, setPickedCode] = useState(stored.foreignCode);
 const [amount, setAmount] = useState(stored.amount);
 const [commissionPct, setCommissionPct] = useState(stored.commissionPct);
 const [mainPerUsdRaw, setMainPerUsdRaw] = useState(stored.mainPerUsd);
 const [foreignRates, setForeignRates] = useState<Record<string, string>>(stored.foreignRates);

 // The picked currency may have been disabled since; fall back to AED, then the first option.
 const foreignCurrency =
  foreignOptions.find((c) => c.code === pickedCode) ??
  foreignOptions.find((c) => c.code === DEFAULT_FOREIGN_CODE) ??
  foreignOptions[0];
 const foreignCode = foreignCurrency?.code ?? '';
 const foreignName = foreignCurrency?.name || foreignCode;
 const foreignIsUsd = foreignCode === 'USD';

 const foreignRateRaw = foreignIsUsd ? '1' : (foreignRates[foreignCode] ?? '');
 const mainRateRaw = mainIsUsd ? '1' : mainPerUsdRaw;

 useEffect(() => {
  const timer = window.setTimeout(() => {
   savePriceCalculator({ foreignCode, amount, commissionPct, mainPerUsd: mainPerUsdRaw, foreignRates });
  }, SAVE_DEBOUNCE_MS);
  return () => window.clearTimeout(timer);
 }, [foreignCode, amount, commissionPct, mainPerUsdRaw, foreignRates]);

 const amountValue = parseNumber(amount);
 const result = foreignCurrency
  ? computePrice({
     amount: Number.isFinite(amountValue) ? amountValue : 0,
     foreignPerUsd: parseNumber(foreignRateRaw),
     commissionPct: parseNumber(commissionPct),
     mainPerUsd: parseNumber(mainRateRaw),
    })
  : null;
 const showValues = result !== null && Number.isFinite(amountValue) && amountValue !== 0;

 if (foreignOptions.length === 0) {
  return (
   <section className={panelClassName}>
    <p className="text-sm text-fg-muted">{t('price_calculator_no_currencies')}</p>
   </section>
  );
 }

 return (
  <section className="flex max-w-2xl flex-col gap-4">
   <div className={panelClassName}>
    <div className="flex flex-col gap-4">
     <FieldRow label={t('price_calculator_currency')} htmlFor="pc-currency">
      <select
       id="pc-currency"
       value={foreignCode}
       onChange={(e) => setPickedCode(e.target.value)}
       className={`${inputClassName} cursor-pointer`}
      >
       {foreignOptions.map((c) => (
        <option key={c.id} value={c.code}>
         {c.code} — {c.name}
        </option>
       ))}
      </select>
     </FieldRow>

     <FieldRow label={t('price_calculator_amount')} htmlFor="pc-amount" suffix={foreignCurrency?.symbol || foreignCode}>
      <input
       id="pc-amount"
       type="text"
       inputMode="decimal"
       dir="ltr"
       value={amount}
       placeholder="100,000"
       onChange={(e) => setAmount(formatAmountInput(e.target.value).replace(/-/g, ''))}
       className={inputClassName}
      />
     </FieldRow>

     <FieldRow label={t('price_calculator_foreign_rate', { currency: foreignName })} htmlFor="pc-foreign-rate" suffix={foreignCode}>
      <input
       id="pc-foreign-rate"
       type="text"
       inputMode="decimal"
       dir="ltr"
       value={foreignRateRaw}
       disabled={foreignIsUsd}
       placeholder="3.67"
       onChange={(e) => {
        const next = normalizePlainDecimalInput(e.target.value).replace(/-/g, '');
        setForeignRates((prev) => ({ ...prev, [foreignCode]: next }));
       }}
       className={inputClassName}
      />
     </FieldRow>

     <FieldRow label={t('price_calculator_commission')} htmlFor="pc-commission" suffix="%">
      <input
       id="pc-commission"
       type="text"
       inputMode="decimal"
       dir="ltr"
       value={commissionPct}
       placeholder="0.5"
       onChange={(e) => setCommissionPct(normalizePlainDecimalInput(e.target.value))}
       className={inputClassName}
      />
     </FieldRow>

     <FieldRow label={t('price_calculator_main_rate', { currency: mainName })} htmlFor="pc-main-rate" suffix={mainCode}>
      <input
       id="pc-main-rate"
       type="text"
       inputMode="decimal"
       dir="ltr"
       value={mainRateRaw}
       disabled={mainIsUsd}
       placeholder="10.45"
       onChange={(e) => setMainPerUsdRaw(normalizePlainDecimalInput(e.target.value).replace(/-/g, ''))}
       className={inputClassName}
      />
     </FieldRow>
    </div>
   </div>

   <div className="border border-accent bg-accent-weak p-5 shadow-sm">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
     <span className="text-sm font-semibold text-fg">{t('price_calculator_result')}</span>
     <span dir="ltr" className="text-3xl font-bold tabular-nums text-fg">
      {result ? result.price.toFixed(3) : '—'}
     </span>
    </div>
    <p className="mt-1 text-xs text-fg-muted">
     {result
      ? ltrIsolate(`1 ${foreignCode} = ${result.price.toFixed(3)} ${mainCode}`)
      : t('price_calculator_result_hint')}
    </p>

    {showValues ? (
     <dl className="mt-4 grid gap-2 border-t border-border pt-3 text-sm">
      <div className="flex items-center justify-between gap-2">
       <dt className="text-fg-muted">{t('price_calculator_value_main', { currency: mainName })}</dt>
       <dd dir="ltr" className="font-semibold tabular-nums text-fg">
        {fmtInt(result.mainValue)} {mainSymbol}
       </dd>
      </div>
      {!mainIsUsd ? (
       <div className="flex items-center justify-between gap-2">
        <dt className="text-fg-muted">{t('price_calculator_value_usd')}</dt>
        <dd dir="ltr" className="font-semibold tabular-nums text-fg">
         ${fmtInt(result.usdValue)}
        </dd>
       </div>
      ) : null}
     </dl>
    ) : null}
   </div>
  </section>
 );
}
