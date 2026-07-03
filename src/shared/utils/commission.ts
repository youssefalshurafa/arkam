export function getCommissionAmount(baseAmount: number, commissionPercent: number) {
 return baseAmount * (commissionPercent / 100);
}

// A charge whose payer settles it directly with the org ("paid by me" / "paid to me")
// never appears in — or affects the balance of — a counterparty's ledger. Every other
// payer, including the counterparty itself ('from'/'to') and an unset/legacy value (''),
// does. So only these four explicit variants are excluded.
export const ORG_SETTLED_CHARGE_PAYERS = new Set(['me_to_from', 'me_to_to', 'from_to_me', 'to_to_me']);
export function chargeShowsInLedger(chargesPayer: string) {
 return !ORG_SETTLED_CHARGE_PAYERS.has(chargesPayer);
}
