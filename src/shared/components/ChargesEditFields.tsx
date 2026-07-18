'use client';

import ChargesPayerSelects from '@/shared/components/ChargesPayerSelects';
import { compactFieldInputClassName, compactFieldLabelClassName, compactFieldSelectClassName } from '@/shared/styles';
import { formatAmountInput, normalizeDecimalInput, normalizePlainDecimalInput } from '@/shared/utils/decimal';
import type { Currency } from '@/shared/types';

type ChargesEditFieldsProps = {
 t: (key: string, params?: Record<string, string | number>) => string;
 charges: string;
 onChargesChange: (value: string) => void;
 chargesCurrencyId: number | null;
 onChargesCurrencyIdChange: (value: number | null) => void;
 chargesPayer: string;
 onChargesPayerChange: (value: string) => void;
 chargesDescription: string;
 onChargesDescriptionChange: (value: string) => void;
 chargesExchangeRate: string;
 onChargesExchangeRateChange: (value: string) => void;
 enabledCurrencies: Currency[];
 fromLabel: string;
 toLabel: string;
 meLabel: string;
 // The currency the charge amount needs converting into (the paying account's currency),
 // so we know whether to show the rate field at all — callers work this out differently
 // (TransactionsSection depends on which side was picked as payer; LedgerSection always
 // targets its own account's currency), so it's computed by the caller, not here.
 rateTargetCurrencyCode?: string;
};

// The expanded "مصاريف" (expenses/charges) editor, shared by TransactionsSection's inline
// row edit and LedgerSection's charges sub-row (previously duplicated ~90-120 lines in each).
// Every control gets its own visible label and border (see compactField* tokens in
// shared/styles.ts) instead of the old borderless underline inputs, so amount / currency /
// payer / payee / description read as distinct fields instead of one run-together line of
// placeholder text.
export default function ChargesEditFields({
 t,
 charges,
 onChargesChange,
 chargesCurrencyId,
 onChargesCurrencyIdChange,
 chargesPayer,
 onChargesPayerChange,
 chargesDescription,
 onChargesDescriptionChange,
 chargesExchangeRate,
 onChargesExchangeRateChange,
 enabledCurrencies,
 fromLabel,
 toLabel,
 meLabel,
 rateTargetCurrencyCode,
}: ChargesEditFieldsProps) {
 const chargesCurrencyCode = enabledCurrencies.find((cur) => cur.id === chargesCurrencyId)?.code;
 const showRate = !!(chargesCurrencyCode && rateTargetCurrencyCode && chargesCurrencyCode !== rateTargetCurrencyCode);

 return (
  <div className="flex flex-wrap items-start gap-3">
   <div className="flex flex-col gap-1">
    <label className={compactFieldLabelClassName}>{t('amount')}</label>
    <div className="flex">
     <input
      type="text"
      inputMode="decimal"
      dir="ltr"
      value={formatAmountInput(charges)}
      onChange={(event) => onChargesChange(normalizeDecimalInput(event.target.value))}
      className={`${compactFieldInputClassName} w-20 rounded-r-none border-r-0`}
      placeholder="0"
     />
     <select
      value={chargesCurrencyId ?? ''}
      onChange={(event) => onChargesCurrencyIdChange(event.target.value ? Number(event.target.value) : null)}
      className={`${compactFieldSelectClassName} w-16 rounded-l-none`}
     >
      <option value="">{t('currency')}</option>
      {enabledCurrencies.map((cur) => (
       <option
        key={cur.id}
        value={cur.id}
       >
        {cur.code}
       </option>
      ))}
     </select>
    </div>
   </div>

   <div className="flex flex-col gap-1">
    <label className={compactFieldLabelClassName}>
     {t('charges_payer_placeholder')} → {t('charges_payer_to_placeholder')}
    </label>
    <div className="flex divide-x divide-border-strong rounded border border-border-strong bg-surface">
     <ChargesPayerSelects
      value={chargesPayer}
      onChange={onChargesPayerChange}
      fromLabel={fromLabel}
      toLabel={toLabel}
      meLabel={meLabel}
      paidByPlaceholder={t('charges_payer_placeholder')}
      paidToPlaceholder={t('charges_payer_to_placeholder')}
      className="cursor-pointer border-0 bg-transparent px-1.5 py-1 text-xs text-fg outline-none"
     />
    </div>
   </div>

   {showRate ? (
    <div className="flex flex-col gap-1">
     <label className={compactFieldLabelClassName}>{t('charges_exchange_rate')}</label>
     <input
      type="text"
      inputMode="decimal"
      dir="ltr"
      value={chargesExchangeRate}
      onChange={(event) => onChargesExchangeRateChange(normalizePlainDecimalInput(event.target.value))}
      className={`${compactFieldInputClassName} w-20`}
      placeholder="1"
     />
     <span
      dir="ltr"
      className="text-[10px] text-fg-faint"
     >
      {chargesCurrencyCode} → {rateTargetCurrencyCode}
     </span>
    </div>
   ) : null}

   <div className="flex min-w-40 flex-1 basis-full flex-col gap-1 sm:basis-52">
    <label className={compactFieldLabelClassName}>{t('charges_description')}</label>
    <input
     type="text"
     value={chargesDescription}
     onChange={(event) => onChargesDescriptionChange(event.target.value)}
     className={`${compactFieldInputClassName} w-full`}
     placeholder={t('charges_description_placeholder')}
    />
   </div>
  </div>
 );
}
