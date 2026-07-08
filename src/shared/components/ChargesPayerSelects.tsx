'use client';

import { useEffect, useState } from 'react';
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
 // combineChargesPayer only yields a non-empty stored value once BOTH sides are
 // picked, so deriving the selects' displayed value straight from `value` made the
 // very first pick (either side, on a blank pair) snap back to the placeholder —
 // there was no valid combined value yet to reflect. Pending local state lets each
 // select keep showing whatever was just picked while waiting on the other side;
 // it's resynced from `value` whenever the caller changes it externally (loading a
 // different row, resetting the form after save, etc).
 const [pending, setPending] = useState(() => parseChargesPayer(value));
 useEffect(() => {
  setPending(parseChargesPayer(value));
 }, [value]);

 const labelFor = (party: ChargesPayerParty) => (party === 'from' ? fromLabel : party === 'to' ? toLabel : meLabel);

 const setPayer = (payer: ChargesPayerParty) => {
  const next = { ...pending, payer };
  setPending(next);
  onChange(combineChargesPayer(next.payer, next.payee));
 };
 const setPayee = (payee: ChargesPayerParty) => {
  const next = { ...pending, payee };
  setPending(next);
  onChange(combineChargesPayer(next.payer, next.payee));
 };

 return (
  <>
   <select
    value={pending.payer}
    onChange={(event) => setPayer(event.target.value as ChargesPayerParty)}
    className={className}
   >
    <option value="">{paidByPlaceholder}</option>
    {PARTIES.filter((party) => party !== pending.payee).map((party) => (
     <option
      key={party}
      value={party}
     >
      {labelFor(party)}
     </option>
    ))}
   </select>
   <select
    value={pending.payee}
    onChange={(event) => setPayee(event.target.value as ChargesPayerParty)}
    className={className}
   >
    <option value="">{paidToPlaceholder}</option>
    {PARTIES.filter((party) => party !== pending.payer).map((party) => (
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
