'use client';

import { useMemo, type ReactNode } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { panelClassName } from '@/shared/styles';
import { formatAmountInput, normalizeDecimalInput, normalizePlainDecimalInput } from '@/shared/utils/decimal';
import { ltrIsolate } from '@/shared/utils/format';
import type { PriceCalculatorQuote } from '@/shared/lib/localStorage';
import { usePriceCalculatorStore } from '../store/priceCalculatorStore';
import { CommissionDirectionToggle } from '@/shared/components/CommissionDirectionToggle';
import type { Currency } from '@/shared/types';
import { computePrice } from '../utils/priceCalc';

type PriceCalculatorSectionProps = {
 /** All workspace currencies (localized names). The main one is the `isMain === 1` entry. */
 currencies: Currency[];
};

const DEFAULT_FOREIGN_CODE = 'AED';
const DEFAULT_QUOTE: PriceCalculatorQuote = 'foreign-per-usd';

// No text colour here, so a field can pick its own without two colour classes fighting.
const inputBaseClassName =
 'w-full min-w-0 rounded border border-border-strong bg-surface px-3 py-2 text-sm outline-none ring-blue-300 focus:ring disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-faint';
const inputClassName = `${inputBaseClassName} text-fg`;

const parseNumber = (raw: string) => {
 const n = parseFloat(normalizeDecimalInput(raw));
 return Number.isFinite(n) ? n : NaN;
};

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
const fmtSignedInt = (n: number) => `${Math.round(n) > 0 ? '+' : ''}${fmtInt(n)}`;

// A label + a control flanked by fixed-width prefix/suffix slots. The slots are always
// rendered (empty when unused) so every row's input lines up to the same width. The control
// group is forced LTR so rate relations like "1 CHF = [1.1862] USD" read the same in Arabic.
function FieldRow({ label, htmlFor, prefix, suffix, children }: { label: string; htmlFor: string; prefix?: ReactNode; suffix?: ReactNode; children: ReactNode }) {
 return (
  <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:items-center sm:gap-4">
   <label htmlFor={htmlFor} className="text-sm font-medium text-fg-muted">
    {label}
   </label>
   <div dir="ltr" className="flex items-center gap-2">
    <span className="flex w-20 shrink-0 items-center justify-end text-xs font-semibold text-fg-faint">{prefix}</span>
    {children}
    <span className="flex w-16 shrink-0 items-center justify-start text-xs font-semibold text-fg-faint">{suffix}</span>
   </div>
  </div>
 );
}

function SwapIcon() {
 return (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
   <path d="M7 4 3 8l4 4M3 8h13.5" />
   <path d="M17 20l4-4-4-4m4 4H7.5" />
  </svg>
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

 // Last-typed values, restored from (and synced through) the per-user settings — see the store
 // for why they live there. The rate, its quote direction and the signed commission are kept
 // per currency.
 const pickedCode = usePriceCalculatorStore((s) => s.foreignCode);
 const amount = usePriceCalculatorStore((s) => s.amount);
 const mainPerUsdRaw = usePriceCalculatorStore((s) => s.mainPerUsd);
 const foreignRates = usePriceCalculatorStore((s) => s.foreignRates);
 const foreignQuotes = usePriceCalculatorStore((s) => s.foreignQuotes);
 const commissions = usePriceCalculatorStore((s) => s.commissions);
 const legacyCommission = usePriceCalculatorStore((s) => s.commissionPct);
 const { setForeignCode, setAmount, setMainPerUsd, setForeignRate, setForeignQuote, setCommission: setCommissionFor } = usePriceCalculatorStore.getState();

 // The picked currency may have been disabled since; fall back to AED, then the first option.
 const foreignCurrency =
  foreignOptions.find((c) => c.code === pickedCode) ??
  foreignOptions.find((c) => c.code === DEFAULT_FOREIGN_CODE) ??
  foreignOptions[0];
 const foreignCode = foreignCurrency?.code ?? '';
 const foreignIsUsd = foreignCode === 'USD';

 const quote = foreignQuotes[foreignCode] ?? DEFAULT_QUOTE;
 const foreignRateRaw = foreignIsUsd ? '1' : (foreignRates[foreignCode] ?? '');
 const commissionRaw = commissions[foreignCode] ?? legacyCommission;
 const mainRateRaw = mainIsUsd ? '1' : mainPerUsdRaw;

 // "1 USD = X AED" or "1 CHF = X USD", whichever way the user's source quotes it.
 const quoteBase = quote === 'usd-per-foreign' ? foreignCode : 'USD';
 const quoteTerm = quote === 'usd-per-foreign' ? 'USD' : foreignCode;

 const setCommission = (next: string) => setCommissionFor(foreignCode, next);

 const amountValue = parseNumber(amount);
 const commissionValue = parseNumber(commissionRaw);
 const result = foreignCurrency
  ? computePrice({
     amount: Number.isFinite(amountValue) ? amountValue : 0,
     rate: parseNumber(foreignRateRaw),
     rateQuote: quote,
     commissionPct: commissionValue,
     mainPerUsd: parseNumber(mainRateRaw),
    })
  : null;
 const showValues = result !== null && Number.isFinite(amountValue) && amountValue !== 0;
 const hasCommission = Number.isFinite(commissionValue) && commissionValue !== 0;

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
       onChange={(e) => setForeignCode(e.target.value)}
       dir={language === 'ar' ? 'rtl' : 'ltr'}
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
       value={amount}
       placeholder="100,000"
       onChange={(e) => setAmount(formatAmountInput(e.target.value).replace(/-/g, ''))}
       className={inputClassName}
      />
     </FieldRow>

     <FieldRow
      label={t('price_calculator_foreign_rate')}
      htmlFor="pc-foreign-rate"
      prefix={`1 ${quoteBase} =`}
      suffix={
       foreignIsUsd ? (
        'USD'
       ) : (
        <button
         type="button"
         title={t('price_calculator_swap_quote')}
         aria-label={t('price_calculator_swap_quote')}
         onClick={() => setForeignQuote(foreignCode, quote === 'usd-per-foreign' ? 'foreign-per-usd' : 'usd-per-foreign')}
         className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-fg-muted transition hover:bg-surface-hover hover:text-fg"
        >
         <span>{quoteTerm}</span>
         <SwapIcon />
        </button>
       )
      }
     >
      <input
       id="pc-foreign-rate"
       type="text"
       inputMode="decimal"
       value={foreignRateRaw}
       disabled={foreignIsUsd}
       placeholder={quote === 'usd-per-foreign' ? '1.1862' : '3.67'}
       onChange={(e) => {
        setForeignRate(foreignCode, normalizePlainDecimalInput(e.target.value).replace(/-/g, ''));
       }}
       className={inputClassName}
      />
     </FieldRow>

     <FieldRow
      label={t('price_calculator_commission')}
      htmlFor="pc-commission"
      prefix={
       <CommissionDirectionToggle
        value={commissionRaw}
        onChange={setCommission}
        t={t}
        labels={{ positive: t('price_calculator_commission_add'), negative: t('price_calculator_commission_deduct') }}
       />
      }
      suffix="%"
     >
      <input
       id="pc-commission"
       type="text"
       inputMode="decimal"
       value={commissionRaw}
       placeholder="0.5"
       onChange={(e) => setCommission(normalizePlainDecimalInput(e.target.value))}
       className={`${inputBaseClassName} ${hasCommission ? (commissionValue < 0 ? 'text-bad-text' : 'text-good-text') : 'text-fg'}`}
      />
     </FieldRow>

     <FieldRow label={t('price_calculator_main_rate', { currency: mainName })} htmlFor="pc-main-rate" prefix="1 USD =" suffix={mainCode}>
      <input
       id="pc-main-rate"
       type="text"
       inputMode="decimal"
       value={mainRateRaw}
       disabled={mainIsUsd}
       placeholder="10.45"
       onChange={(e) => setMainPerUsd(normalizePlainDecimalInput(e.target.value).replace(/-/g, ''))}
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
     {result ? ltrIsolate(`1 ${foreignCode} = ${result.price.toFixed(3)} ${mainCode}`) : t('price_calculator_result_hint')}
    </p>

    {showValues ? (
     <dl className="mt-4 grid gap-2 border-t border-border pt-3 text-sm">
      <div className="flex items-center justify-between gap-2">
       <dt className="text-fg-muted">{t('price_calculator_usd_before')}</dt>
       <dd dir="ltr" className="tabular-nums text-fg">
        ${fmtInt(result.usdBase)}
       </dd>
      </div>
      {hasCommission ? (
       <div className="flex items-center justify-between gap-2">
        <dt className="text-fg-muted">{t('price_calculator_commission_amount', { pct: ltrIsolate(`${commissionValue > 0 ? '+' : ''}${commissionValue}%`) })}</dt>
        <dd dir="ltr" className={`tabular-nums ${result.commissionUsd < 0 ? 'text-bad-text' : 'text-good-text'}`}>
         {fmtSignedInt(result.commissionUsd)} $
        </dd>
       </div>
      ) : null}
      {!mainIsUsd ? (
       <div className="flex items-center justify-between gap-2">
        <dt className="text-fg-muted">{t('price_calculator_usd_after')}</dt>
        <dd dir="ltr" className="font-semibold tabular-nums text-fg">
         ${fmtInt(result.usdValue)}
        </dd>
       </div>
      ) : null}
      <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
       <dt className="font-semibold text-fg">{t('price_calculator_value_main', { currency: mainName })}</dt>
       <dd dir="ltr" className="text-base font-bold tabular-nums text-fg">
        {fmtInt(result.mainValue)} {mainSymbol}
       </dd>
      </div>
     </dl>
    ) : null}
   </div>
  </section>
 );
}
