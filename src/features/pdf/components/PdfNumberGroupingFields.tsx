'use client';

import { useState } from 'react';
import { getStoredNumberGrouping, maxFirstGroupSize, minFirstGroupSize, saveFirstGroupSize } from '@/shared/lib/localStorage';
import { firstGroupSizeFor, groupDigits } from '@/shared/utils/numberFormat';

const groupSizes = Array.from({ length: maxFirstGroupSize - minFirstGroupSize + 1 }, (_, i) => minFirstGroupSize + i);

type Props = {
 t: (key: string) => string;
 // The currencies whose amounts appear in this export; one picker each.
 currencyCodes: string[];
};

// Export dialogs: per currency, where the thousands separators fall in the exported PDF only —
// 123,456,789 (normal) or 12,345,6789 (rightmost group of 4, then 3s), etc. The choice is remembered
// per currency for every later PDF export; the app's own screens always keep the normal grouping.
export default function PdfNumberGroupingFields({ t, currencyCodes }: Props) {
 const [grouping, setGrouping] = useState(getStoredNumberGrouping);
 // Collapsed by default so the dialog stays short; the title toggles the per-currency list.
 const [isOpen, setIsOpen] = useState(false);
 if (currencyCodes.length === 0) return null;

 return (
  <div className="flex flex-col gap-1">
   <button
    type="button"
    aria-expanded={isOpen}
    onClick={() => setIsOpen((prev) => !prev)}
    className="flex cursor-pointer items-center gap-1 self-start text-xs font-semibold uppercase tracking-wide text-fg-faint transition hover:text-fg"
   >
    <span aria-hidden>{isOpen ? '▾' : '▸'}</span>
    {t('pdf_number_grouping_label')}
   </button>
   {isOpen && currencyCodes.map((code) => (
    <div
     key={code}
     className="flex items-center gap-2"
    >
     <span className="w-12 shrink-0 text-sm font-medium text-fg-muted">{code}</span>
     <select
      dir="ltr"
      value={firstGroupSizeFor(code, grouping)}
      onChange={(event) => {
       saveFirstGroupSize(code, Number(event.target.value));
       setGrouping(getStoredNumberGrouping());
      }}
      className="flex-1 rounded border border-border-strong bg-surface px-3 py-2 text-sm text-fg outline-none ring-blue-300 focus:ring"
     >
      {groupSizes.map((size) => (
       <option
        key={size}
        value={size}
       >
        {groupDigits('123456789', size, ',')}
        {size === minFirstGroupSize ? ` (${t('pdf_number_grouping_standard')})` : ''}
       </option>
      ))}
     </select>
    </div>
   ))}
  </div>
 );
}
