'use client';

// A commission's direction is carried by its sign: positive = the commission is FOR the
// client (it raises their balance), negative = it is taken FROM them (it lowers it). See
// computeTransactionSideNetChange in features/ledger/utils/ledgerBalances.ts, where both
// the "from" and "to" sides add the signed commission the same way.
//
// This is the reverse button that sits next to every commission (%) input so the direction
// is visible and switchable wherever a commission is entered. It flips the sign on the raw
// input string rather than on a parsed number, so it also works before a number is typed
// ("" -> "-") and never reformats what the user wrote ("2.50" -> "-2.50").

export function isCommissionFromClient(value: string) {
 return value.trim().startsWith('-');
}

export function toggleCommissionSign(value: string) {
 const trimmed = value.trim();
 return trimmed.startsWith('-') ? trimmed.slice(1) : `-${trimmed}`;
}

type CommissionDirectionToggleProps = {
 // The raw commission input value, e.g. '2.5' or '-2.5'.
 value: string;
 onChange: (next: string) => void;
 t: (key: string) => string;
 // Off for tight cells (the ledger's inline editor), where the input's own red/green
 // colouring already carries the direction.
 showLabel?: boolean;
 className?: string;
};

export function CommissionDirectionToggle({ value, onChange, t, showLabel = true, className }: CommissionDirectionToggleProps) {
 const fromClient = isCommissionFromClient(value);
 return (
  <button
   type="button"
   title={fromClient ? t('commission_from_him') : t('commission_for_him')}
   onClick={() => onChange(toggleCommissionSign(value))}
   className={
    className ??
    `inline-flex shrink-0 items-center gap-0.5 rounded p-0.5 transition hover:bg-surface-hover ${fromClient ? 'text-bad-text' : 'text-good-text'}`
   }
  >
   <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M7 4 3 8l4 4M3 8h13.5" />
    <path d="M17 20l4-4-4-4m4 4H7.5" />
   </svg>
   {showLabel ? <span className="text-[10px] font-semibold uppercase">{fromClient ? t('commission_dir_from') : t('commission_dir_for')}</span> : null}
  </button>
 );
}
