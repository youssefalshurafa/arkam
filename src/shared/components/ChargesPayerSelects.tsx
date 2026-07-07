'use client';

import type { ChargesPayerParty } from '@/shared/utils/commission';
import { combineChargesPayer, parseChargesPayer } from '@/shared/utils/commission';

const PARTIES: ChargesPayerParty[] = ['from', 'to', 'me'];

type ChargesPayerSelectsProps = {
 value: string;
 onChange: (value: string) => void;
 fromLabel: string;
 toLabel: string;
 meLabel: string;
 paidByPlaceholder: string;
 paidToPlaceholder: string;
 className: string;
};

// The "paid by" / "to" pair of pickers for a transaction's extra-expense payer,
// replacing what used to be a single 6-option select mixing both ends of the payment
// into one list (e.g. "Paid by me to Acme" and bare "Acme" as separate, ambiguous
// options). Each side offers the FROM client, the TO client, and "me" (the org),
// excluding whichever party is already selected on the other side. See
// shared/utils/commission.ts for how the pair maps to the stored enum value.
export default function ChargesPayerSelects({ value, onChange, fromLabel, toLabel, meLabel, paidByPlaceholder, paidToPlaceholder, className }: ChargesPayerSelectsProps) {
 const { payer, payee } = parseChargesPayer(value);
 const labelFor = (party: ChargesPayerParty) => (party === 'from' ? fromLabel : party === 'to' ? toLabel : meLabel);

 return (
  <>
   <select
    value={payer}
    onChange={(event) => onChange(combineChargesPayer(event.target.value as ChargesPayerParty, payee))}
    className={className}
   >
    <option value="">{paidByPlaceholder}</option>
    {PARTIES.filter((party) => party !== payee).map((party) => (
     <option
      key={party}
      value={party}
     >
      {labelFor(party)}
     </option>
    ))}
   </select>
   <select
    value={payee}
    onChange={(event) => onChange(combineChargesPayer(payer, event.target.value as ChargesPayerParty))}
    className={className}
   >
    <option value="">{paidToPlaceholder}</option>
    {PARTIES.filter((party) => party !== payer).map((party) => (
     <option
      key={party}
      value={party}
     >
      {labelFor(party)}
     </option>
    ))}
   </select>
  </>
 );
}
