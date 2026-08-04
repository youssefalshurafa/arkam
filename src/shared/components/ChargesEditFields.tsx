'use client';

import ChargesPayerSelects from '@/shared/components/ChargesPayerSelects';
import { compactFieldInputClassName, compactFieldLabelClassName } from '@/shared/styles';
import { formatAmountInput, normalizeDecimalInput } from '@/shared/utils/decimal';

type ChargesEditFieldsProps = {
 t: (key: string, params?: Record<string, string | number>) => string;
 charges: string;
 onChargesChange: (value: string) => void;
 chargesPayer: string;
 onChargesPayerChange: (value: string) => void;
 chargesDescription: string;
 onChargesDescriptionChange: (value: string) => void;
 fromLabel: string;
 toLabel: string;
 meLabel: string;
};

// The expanded "مصاريف" (expenses/charges) editor, shared by TransactionsSection's inline
// row edit and LedgerSection's charges sub-row (previously duplicated ~90-120 lines in each).
// Every control gets its own visible label and border (see compactField* tokens in
// shared/styles.ts) instead of the old borderless underline inputs, so amount / payer / payee /
// description read as distinct fields instead of one run-together line of placeholder text.
// No currency or exchange-rate picker: a charge always uses the transaction's own currency
// (the caller forces chargesCurrencyId to match and chargesExchangeRate to 1 at submit time).
export default function ChargesEditFields({
 t,
 charges,
 onChargesChange,
 chargesPayer,
 onChargesPayerChange,
 chargesDescription,
 onChargesDescriptionChange,
 fromLabel,
 toLabel,
 meLabel,
}: ChargesEditFieldsProps) {
 return (
  <div className="flex flex-wrap items-start gap-3">
   <div className="flex flex-col gap-1">
    <label className={compactFieldLabelClassName}>{t('amount')}</label>
    <input
     type="text"
     inputMode="decimal"
     dir="ltr"
     value={formatAmountInput(charges)}
     onChange={(event) => onChargesChange(normalizeDecimalInput(event.target.value))}
     className={`${compactFieldInputClassName} w-20`}
     placeholder="0"
    />
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
