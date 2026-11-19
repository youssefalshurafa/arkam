'use client';

import { useMemo, type ReactNode } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { panelClassName } from '@/shared/styles';
import { formatAmountInput, normalizeDecimalInput, normalizePlainDecimalInput } from '@/shared/utils/decimal';
import { ltrIsolate } from '@/shared/utils/format';
import {
 PRICE_CALCULATOR_MAX_DECIMALS,
 priceCalculatorPairKey,
 priceCalculatorRouteKey,
 type PriceCalculatorRate,
} from '@/shared/lib/localStorage';
import type { Currency } from '@/shared/types';
import { usePriceCalculatorStore } from '../store/priceCalculatorStore';
import { computePrice, type RateQuote } from '../utils/priceCalc';

type PriceCalculatorSectionProps = {
 /** All workspace currencies (localized names). The main one is the `isMain === 1` entry. */
 currencies: Currency[];
};

const DEFAULT_FOREIGN_CODE = 'AED';
const DEFAULT_BRIDGE_CODE = 'USD';

const fieldClassName = 'rounded border border-border-strong bg-surface px-3 py-2 text-sm text-fg outline-none ring-blue-300 focus:ring';
// A bordered group (chip | input | chip) that rings as a whole when its input is focused.
const groupClassName = 'flex min-w-0 flex-1 items-stretch overflow-hidden rounded border border-border-strong bg-surface ring-blue-300 focus-within:ring';
const groupInputClassName = 'min-w-0 flex-1 bg-transparent px-3 py-2 text-sm font-semibold tabular-nums text-fg outline-none placeholder:font-normal placeholder:text-fg-faint';
const chipClassName = 'flex shrink-0 items-center whitespace-nowrap bg-surface-2 px-3 text-xs font-semibold text-fg-muted';
const stepperButtonClassName =
 'flex h-5 w-7 items-center justify-center bg-surface text-fg-muted transition hover:bg-surface-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface';

const parseNumber = (raw: string) => {
 const n = parseFloat(normalizeDecimalInput(raw));
 return Number.isFinite(n) ? n : NaN;
};

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
const fmtNum = (n: number, maxDigits = 4) => n.toLocaleString('en-US', { maximumFractionDigits: maxDigits });
const cleanRate = (raw: string) => normalizePlainDecimalInput(raw).replace(/-/g, '');

function SwapIcon() {
 return (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
   <path d="M7 4 3 8l4 4M3 8h13.5" />
   <path d="M17 20l4-4-4-4m4 4H7.5" />
  </svg>
 );
}

function ChevronIcon({ up }: { up?: boolean }) {
 return (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
   <path d={up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
  </svg>
 );
}

// One numbered step of the form: a badge, a title, an optional one-line hint, then its fields.
function Step({ index, title, hint, children }: { index: number; title: string; hint?: string; children: ReactNode }) {
 return (
  <section className="flex flex-col gap-3 py-5 first:pt-0 last:pb-0">
   <div className="flex items-start gap-3">
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-weak text-xs font-bold text-accent">{index}</span>
    <div className="min-w-0">
     <h3 className="text-sm font-semibold text-fg">{title}</h3>
     {hint ? <p className="mt-0.5 text-xs text-fg-faint">{hint}</p> : null}
    </div>
   </div>
   <div className="flex flex-col gap-4 ps-9">{children}</div>
  </section>
 );
}

// A rate written as the equation it is — "1 USD = [3.8] SAR" — so the direction is never in
// doubt. Forced LTR: a math relation reads left-to-right in Arabic too.
function RateEquation({
 id,
 label,
 base,
 term,
 value,
 placeholder,
 onChange,
 onSwap,
 swapLabel,
 footnote,
}: {
 id: string;
 label: string;
 base: string;
 term: string;
 value: string;
 placeholder: string;
 onChange: (raw: string) => void;
 onSwap: () => void;
 swapLabel: string;
 footnote?: string;
}) {
 return (
  <div className="flex flex-col gap-1.5">
   <label htmlFor={id} className="text-xs font-medium text-fg-muted">
    {label}
   </label>
   <div dir="ltr" className="flex items-stretch gap-2">
    <div className={groupClassName}>
     <span className={`${chipClassName} border-e border-border`}>1 {base} =</span>
     <input id={id} type="text" inputMode="decimal" dir="ltr" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={groupInputClassName} />
     <span className={`${chipClassName} border-s border-border`}>{term}</span>
    </div>
    <button
     type="button"
     onClick={onSwap}
     title={swapLabel}
     aria-label={swapLabel}
     className="flex shrink-0 items-center justify-center rounded border border-border-strong bg-surface-2 px-3 text-fg-muted transition hover:bg-surface-hover hover:text-fg"
    >
     <SwapIcon />
    </button>
   </div>
   {footnote ? <p className="text-xs text-fg-faint">{footnote}</p> : null}
  </div>
 );
}

function BreakdownRow({ label, formula, value, tone, total }: { label: string; formula?: string; value: string; tone?: string; total?: boolean }) {
 return (
  <div className={`flex items-center justify-between gap-3 ${total ? 'mt-1 border-t border-border pt-3' : ''}`}>
   {/* The formula sits on its own line: mixing an LTR "100,000 ÷ 3.8" into the same line as
       an Arabic label garbles the order and spacing. */}
   <dt className="flex min-w-0 flex-col">
    <span className={total ? 'font-semibold text-fg' : 'text-fg-muted'}>{label}</span>
    {formula ? (
     <span dir="ltr" className="self-start text-xs text-fg-faint">
      {formula}
     </span>
    ) : null}
   </dt>
   <dd dir="ltr" className={`shrink-0 tabular-nums ${tone ?? 'text-fg'} ${total ? 'text-base font-bold' : 'font-semibold'}`}>
    {value}
   </dd>
  </div>
 );
}

export default function PriceCalculatorSection({ currencies }: PriceCalculatorSectionProps) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const selectDir = language === 'ar' ? 'rtl' : 'ltr';

 const mainCurrency = currencies.find((c) => c.isMain === 1);
 const mainCode = mainCurrency?.code ?? 'USD';
 const nameOf = (code: string) => currencies.find((c) => c.code === code)?.name;

 const foreignOptions = useMemo(() => currencies.filter((c) => c.isEnabled === 1 && c.isMain !== 1), [currencies]);

 // Last-typed values, restored from (and synced through) the per-user settings — see the store
 // for why they live there.
 const pickedCode = usePriceCalculatorStore((s) => s.foreignCode);
 const amount = usePriceCalculatorStore((s) => s.amount);
 const decimals = usePriceCalculatorStore((s) => s.decimals);
 const bridges = usePriceCalculatorStore((s) => s.bridges);
 const rates = usePriceCalculatorStore((s) => s.rates);
 const commissions = usePriceCalculatorStore((s) => s.commissions);
 const legacyMainPerUsd = usePriceCalculatorStore((s) => s.mainPerUsd);
 const legacyCommission = usePriceCalculatorStore((s) => s.commissionPct);
 const { setForeignCode, setAmount, setDecimals, setBridge, setRate, setCommission } = usePriceCalculatorStore.getState();

 // The picked currency may have been disabled since; fall back to AED, then the first option.
 const foreignCurrency =
  foreignOptions.find((c) => c.code === pickedCode) ??
  foreignOptions.find((c) => c.code === DEFAULT_FOREIGN_CODE) ??
  foreignOptions[0];
 const foreignCode = foreignCurrency?.code ?? '';

 // The currency the price goes THROUGH: USD by default, any other enabled currency, or the main
 // currency itself — "direct", a single rate with nothing in between. The foreign currency
 // can't be its own bridge (that would just be "direct" again).
 const bridgeOptions = useMemo(() => {
  const codes = [DEFAULT_BRIDGE_CODE, ...foreignOptions.map((c) => c.code)];
  return [...new Set(codes)].filter((code) => code !== foreignCode && code !== mainCode);
 }, [foreignOptions, foreignCode, mainCode]);
 const storedBridge = bridges[foreignCode];
 const bridge =
  storedBridge && (storedBridge === mainCode || bridgeOptions.includes(storedBridge))
   ? storedBridge
   : bridgeOptions.includes(DEFAULT_BRIDGE_CODE)
     ? DEFAULT_BRIDGE_CODE
     : mainCode;
 const direct = bridge === mainCode;

 // A rate is stored per currency pair, without direction: "1 base = value <other>". The older
 // single main-currency rate ("1 USD = x <main>") stands in until that pair has its own entry.
 const readRate = (code: string, defaultBase: string): PriceCalculatorRate => {
  const key = priceCalculatorPairKey(code, bridge);
  const stored = rates[key];
  if (stored && (stored.base === code || stored.base === bridge)) return stored;
  if (key === priceCalculatorPairKey(mainCode, 'USD') && legacyMainPerUsd) return { base: 'USD', value: legacyMainPerUsd };
  return { base: defaultBase, value: '' };
 };
 // Defaults follow how rates are usually quoted: against a bridge, "1 USD = 3.67 AED"; direct,
 // "1 SAR = 2.78 MAD" — which reads the same way as the result.
 const foreignRate = readRate(foreignCode, direct ? foreignCode : bridge);
 const mainRate: PriceCalculatorRate = direct ? { base: bridge, value: '1' } : readRate(mainCode, bridge);
 const quoteOf = (rate: PriceCalculatorRate): RateQuote => (rate.base === bridge ? 'units-per-bridge' : 'bridge-per-unit');
 const otherOf = (rate: PriceCalculatorRate, code: string) => (rate.base === bridge ? code : bridge);

 // The commission is stored signed (the app-wide convention: the sign is the direction), but
 // shown as a magnitude plus an explicit Add / Deduct choice, which is easier to read than a sign.
 // It is kept per route: SAR through USD and SAR through AED are different deals.
 const commissionRaw = (commissions[priceCalculatorRouteKey(foreignCode, bridge)] ?? (bridge === 'USD' ? legacyCommission : '')).trim();
 const commissionDeduct = commissionRaw.startsWith('-');
 const commissionMagnitude = commissionRaw.replace(/^-/, '');
 const writeCommission = (deduct: boolean, magnitude: string) => setCommission(foreignCode, bridge, `${deduct ? '-' : ''}${magnitude}`);
 const onCommissionInput = (raw: string) => {
  // Typing a sign is a shortcut for the switch: "-" deducts, "+" adds.
  const deduct = raw.includes('-') ? true : raw.includes('+') ? false : commissionDeduct;
  writeCommission(deduct, normalizePlainDecimalInput(raw).replace(/-/g, ''));
 };

 const amountValue = parseNumber(amount);
 const rateValue = parseNumber(foreignRate.value);
 const mainRateValue = parseNumber(mainRate.value);
 const commissionValue = parseNumber(commissionRaw);
 const hasCommission = Number.isFinite(commissionValue) && commissionValue !== 0;
 const result = foreignCurrency
  ? computePrice({
     amount: Number.isFinite(amountValue) ? amountValue : 0,
     rate: rateValue,
     rateQuote: quoteOf(foreignRate),
     commissionPct: commissionValue,
     mainRate: mainRateValue,
     mainQuote: quoteOf(mainRate),
    })
  : null;
 const hasAmount = Number.isFinite(amountValue) && amountValue !== 0;

 if (foreignOptions.length === 0) {
  return (
   <section className={panelClassName}>
    <p className="text-sm text-fg-muted">{t('price_calculator_no_currencies')}</p>
   </section>
  );
 }

 // The same rate read the other way round, so the user can match it to their source either way.
 const inverseFootnote = (rate: PriceCalculatorRate, code: string) => {
  const n = parseNumber(rate.value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return t('price_calculator_inverse', { relation: ltrIsolate(`1 ${otherOf(rate, code)} = ${fmtNum(1 / n, 6)} ${rate.base}`) });
 };
 const rateEquation = (id: string, code: string, rate: PriceCalculatorRate, placeholder: string) => (
  <RateEquation
   id={id}
   label={t('price_calculator_rate_label', { currency: code, bridge })}
   base={rate.base}
   term={otherOf(rate, code)}
   value={rate.value}
   placeholder={placeholder}
   onChange={(raw) => setRate(code, bridge, { base: rate.base, value: cleanRate(raw) })}
   onSwap={() => setRate(code, bridge, { base: otherOf(rate, code), value: rate.value })}
   swapLabel={t('price_calculator_swap_quote')}
   footnote={inverseFootnote(rate, code)}
  />
 );

 // Codes, not symbols: they match the labels ("Amount in AED") and never collide ($ vs. US$).
 const money = (n: number, code: string) => `${fmtInt(n)} ${code}`;
 const signedMoney = (n: number, code: string) => `${n < 0 ? '−' : '+'}${money(Math.abs(n), code)}`;
 const opOf = (quote: RateQuote, toBridge: boolean) => ((quote === 'bridge-per-unit') === toBridge ? '×' : '÷');
 const rateValid = Number.isFinite(rateValue) && rateValue > 0;
 const toBridgeFormula = rateValid && hasAmount ? `${fmtNum(amountValue, 2)} ${opOf(quoteOf(foreignRate), true)} ${fmtNum(rateValue, 6)}` : undefined;
 const toMainFormula = `${opOf(quoteOf(mainRate), false)} ${fmtNum(mainRateValue, 6)}`;
 const pctLabel = ltrIsolate(`${commissionDeduct ? '−' : '+'}${commissionMagnitude}%`);
 const route = (direct ? [foreignCode, mainCode] : [foreignCode, bridge, mainCode]).join(' → ');

 return (
  <div className="grid max-w-5xl grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
   <div className={`${panelClassName} divide-y divide-border`}>
    <Step index={1} title={t('price_calculator_step_amount')} hint={t('price_calculator_amount_hint')}>
     <div className="flex items-stretch gap-2">
      <input
       id="pc-amount"
       type="text"
       inputMode="decimal"
       dir="ltr"
       aria-label={t('price_calculator_step_amount')}
       value={amount}
       placeholder="100,000"
       onChange={(e) => setAmount(formatAmountInput(e.target.value).replace(/-/g, ''))}
       className={`${fieldClassName} min-w-0 flex-1 text-base font-semibold tabular-nums placeholder:font-normal placeholder:text-fg-faint`}
      />
      <select
       id="pc-currency"
       aria-label={t('price_calculator_currency')}
       value={foreignCode}
       onChange={(e) => setForeignCode(e.target.value)}
       dir={selectDir}
       className={`${fieldClassName} max-w-[50%] shrink-0 cursor-pointer font-semibold`}
      >
       {foreignOptions.map((c) => (
        <option key={c.id} value={c.code}>
         {c.code} — {c.name}
        </option>
       ))}
      </select>
     </div>
    </Step>

    <Step index={2} title={t('price_calculator_step_rates')} hint={t('price_calculator_rates_hint')}>
     <div className="flex flex-col gap-1.5">
      <label htmlFor="pc-bridge" className="text-xs font-medium text-fg-muted">
       {t('price_calculator_via')}
      </label>
      <select id="pc-bridge" value={bridge} onChange={(e) => setBridge(foreignCode, e.target.value)} dir={selectDir} className={`${fieldClassName} w-full cursor-pointer font-semibold sm:max-w-xs`}>
       {bridgeOptions.map((code) => (
        <option key={code} value={code}>
         {nameOf(code) ? `${code} — ${nameOf(code)}` : code}
        </option>
       ))}
       <option value={mainCode}>{t('price_calculator_via_direct')}</option>
      </select>
      <p dir="ltr" data-testid="pc-route" className="self-start text-xs font-medium text-fg-faint">
       {route}
      </p>
     </div>
     {rateEquation('pc-foreign-rate', foreignCode, foreignRate, foreignRate.base === bridge ? '3.67' : '1.1862')}
     {!direct ? rateEquation('pc-main-rate', mainCode, mainRate, mainRate.base === bridge ? '10.45' : '0.0957') : null}
    </Step>

    <Step
     index={3}
     title={t('price_calculator_step_commission')}
     hint={t(commissionDeduct ? 'price_calculator_commission_hint_deduct' : 'price_calculator_commission_hint_add', { currency: bridge })}
    >
     <div className="flex flex-wrap items-stretch gap-2">
      <div role="radiogroup" aria-label={t('price_calculator_step_commission')} className="inline-flex shrink-0 overflow-hidden rounded border border-border-strong">
       {[false, true].map((deduct) => {
        const active = deduct === commissionDeduct;
        const activeTone = deduct ? 'bg-bad-bg text-bad-text' : 'bg-good-bg text-good-text';
        return (
         <button
          key={String(deduct)}
          type="button"
          role="radio"
          aria-checked={active}
          onClick={() => writeCommission(deduct, commissionMagnitude)}
          className={`px-3 py-2 text-sm font-semibold transition ${deduct ? 'border-s border-border-strong' : ''} ${active ? activeTone : 'bg-surface text-fg-muted hover:bg-surface-hover'}`}
         >
          {deduct ? `− ${t('price_calculator_commission_deduct')}` : `+ ${t('price_calculator_commission_add')}`}
         </button>
        );
       })}
      </div>
      <div dir="ltr" className={`${groupClassName} min-w-[8rem]`}>
       <input
        id="pc-commission"
        type="text"
        inputMode="decimal"
        dir="ltr"
        aria-label={t('price_calculator_step_commission')}
        value={commissionMagnitude}
        placeholder="0"
        onChange={(e) => onCommissionInput(e.target.value)}
        className={groupInputClassName}
       />
       <span className={`${chipClassName} border-s border-border`}>%</span>
      </div>
     </div>
    </Step>
   </div>

   <aside className="flex flex-col gap-4 border border-accent bg-accent-weak p-5 shadow-sm lg:sticky lg:top-4">
    <div>
     <p className="text-sm font-semibold text-fg-muted">{t('price_calculator_result')}</p>
     <div className="mt-1 flex items-center gap-2">
      <span dir="ltr" data-testid="pc-price" className="min-w-0 break-all text-4xl font-bold tabular-nums text-fg">
       {result ? result.price.toFixed(decimals) : '—'}
      </span>
      {result ? (
       <>
        <span className="shrink-0 text-base font-semibold text-fg-muted">{mainCode}</span>
        {/* More / fewer decimals on the price. */}
        <div className="flex shrink-0 flex-col overflow-hidden rounded border border-border-strong">
         <button
          type="button"
          onClick={() => setDecimals(Math.min(PRICE_CALCULATOR_MAX_DECIMALS, decimals + 1))}
          disabled={decimals >= PRICE_CALCULATOR_MAX_DECIMALS}
          title={t('price_calculator_more_decimals')}
          aria-label={t('price_calculator_more_decimals')}
          className={stepperButtonClassName}
         >
          <ChevronIcon up />
         </button>
         <button
          type="button"
          onClick={() => setDecimals(Math.max(0, decimals - 1))}
          disabled={decimals <= 0}
          title={t('price_calculator_fewer_decimals')}
          aria-label={t('price_calculator_fewer_decimals')}
          className={`${stepperButtonClassName} border-t border-border-strong`}
         >
          <ChevronIcon />
         </button>
        </div>
       </>
      ) : null}
     </div>
     <p className="mt-1 text-xs text-fg-muted">{result ? t('price_calculator_result_per', { currency: foreignCode }) : t('price_calculator_result_hint')}</p>
    </div>

    {result ? (
     <div className="border-t border-border pt-4">
      <p className="mb-2 text-xs font-semibold text-fg-muted">{t('price_calculator_breakdown')}</p>
      {hasAmount ? (
       <dl className="flex flex-col gap-2 text-sm">
        {/* Direct with no commission: the amount converts straight into the total. */}
        {direct && !hasCommission ? null : (
         <BreakdownRow label={t('price_calculator_in_currency', { currency: bridge })} formula={toBridgeFormula} value={money(result.bridgeBase, bridge)} />
        )}
        {hasCommission ? (
         <BreakdownRow
          label={t('price_calculator_commission_amount', { pct: pctLabel })}
          value={signedMoney(result.commissionBridge, bridge)}
          tone={result.commissionBridge < 0 ? 'text-bad-text' : 'text-good-text'}
         />
        ) : null}
        {hasCommission && !direct ? <BreakdownRow label={t('price_calculator_after_commission')} value={money(result.bridgeValue, bridge)} /> : null}
        <BreakdownRow
         label={t('price_calculator_total', { currency: mainCode })}
         formula={direct ? (hasCommission ? undefined : toBridgeFormula) : toMainFormula}
         value={money(result.mainValue, mainCode)}
         total
        />
       </dl>
      ) : (
       <p className="text-xs text-fg-faint">{t('price_calculator_breakdown_hint')}</p>
      )}
     </div>
    ) : null}
   </aside>
  </div>
 );
}
