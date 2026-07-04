export function getCommissionAmount(baseAmount: number, commissionPercent: number) {
 return baseAmount * (commissionPercent / 100);
}

// The four "paid by me" / "paid to me" payers settle the fee directly with the org
// (you) rather than between the two clients. They are still recorded, but only affect
// the one named client's ledger — the org silently absorbs the other leg.
export const ORG_SETTLED_CHARGE_PAYERS = new Set(['me_to_from', 'me_to_to', 'from_to_me', 'to_to_me']);

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
