export function getCommissionAmount(baseAmount: number, commissionPercent: number) {
 return baseAmount * (commissionPercent / 100);
}

// The destination-side ("to") converted base amount for a transaction, in the destination
// account's currency. For an exchange (صرف) where the user recorded the real settled amount
// (الفعلي), that actual amount is used instead of the computed amount × exchangeRateTo, so the
// destination ledger reflects what actually changed hands. Commission still applies on top.
export function exchangeToBase(tx: { type: string; amount: number; exchangeRateTo: number; exchangeActualAmount?: number | null }) {
 return tx.type === 'exchange' && tx.exchangeActualAmount != null ? tx.exchangeActualAmount : tx.amount * tx.exchangeRateTo;
}

// The four "paid by me" / "paid to me" payers settle the fee directly with the org
// (you) rather than between the two clients. They are still recorded, but only affect
// the one named client's ledger — the org silently absorbs the other leg.
export const ORG_SETTLED_CHARGE_PAYERS = new Set(['me_to_from', 'me_to_to', 'from_to_me', 'to_to_me']);

// One end of a charges-payer pair: the FROM client, the TO client, or the org ("me").
// '' means not chosen yet.
export type ChargesPayerParty = 'from' | 'to' | 'me' | '';

const CHARGES_PAYER_PARTS: Record<string, { payer: ChargesPayerParty; payee: ChargesPayerParty }> = {
 from: { payer: 'from', payee: 'to' },
 to: { payer: 'to', payee: 'from' },
 from_to_me: { payer: 'from', payee: 'me' },
 me_to_from: { payer: 'me', payee: 'from' },
 to_to_me: { payer: 'to', payee: 'me' },
 me_to_to: { payer: 'me', payee: 'to' },
};

const CHARGES_PAYER_VALUES: Record<string, string> = {
 'from:to': 'from',
 'to:from': 'to',
 'from:me': 'from_to_me',
 'me:from': 'me_to_from',
 'to:me': 'to_to_me',
 'me:to': 'me_to_to',
};

// Splits a stored chargesPayer value (e.g. 'from_to_me') into who paid and who was
// paid, so the UI can offer them as two independent 3-option pickers (FROM client /
// TO client / me) instead of one flat 6-option list mixing both ends together.
export function parseChargesPayer(value: string): { payer: ChargesPayerParty; payee: ChargesPayerParty } {
 return CHARGES_PAYER_PARTS[value] ?? { payer: '', payee: '' };
}

// Inverse of parseChargesPayer — recombines the two picker values back into the
// stored enum value. '' (unset) if either side is still empty, or if they match
// (paying yourself isn't a valid combination).
export function combineChargesPayer(payer: ChargesPayerParty, payee: ChargesPayerParty): string {
 if (!payer || !payee || payer === payee) return '';
 return CHARGES_PAYER_VALUES[`${payer}:${payee}`] ?? '';
}

// How a transaction's charge affects the running balance of the account sitting on the
// given side of that transaction ('from' = this account is the sender/accountFrom side,
// 'to' = the receiver/accountTo side). The returned value multiplies (charges * rate):
//   -1 => subtracted from this account's balance (this account bore the fee, shown red)
//    0 => the charge does not touch this account's ledger
//   +1 => added to this account's balance (shown green)
//
// Client-to-client fees ('from'/'to') are double-entry: the payer's side is debited and
// the other side credited, so they net to zero across the two client ledgers. The
// org-settled variants are single-sided: only the named client is affected. A legacy/
// unset payer keeps its historical single-sided credit behavior.
export function chargeLedgerEffect(chargesPayer: string, side: 'from' | 'to'): -1 | 0 | 1 {
 switch (chargesPayer) {
  case 'from':
   return side === 'from' ? -1 : 1;
  case 'to':
   return side === 'to' ? -1 : 1;
  case 'from_to_me': // the FROM client paid the fee to the org
   return side === 'from' ? -1 : 0;
  case 'me_to_from': // the org paid the fee to the FROM client
   return side === 'from' ? 1 : 0;
  case 'to_to_me': // the TO client paid the fee to the org
   return side === 'to' ? -1 : 0;
  case 'me_to_to': // the org paid the fee to the TO client
   return side === 'to' ? 1 : 0;
  default: // unset / legacy value
   return 1;
 }
}

// Kept for callers that only need to know whether a charge is org-settled (settled with
// you directly) rather than a client-to-client fee.
export function chargeShowsInLedger(chargesPayer: string) {
 return !ORG_SETTLED_CHARGE_PAYERS.has(chargesPayer);
}
