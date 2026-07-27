import type { ClientAccount, SystemClient } from '@/shared/types';

// Treasury/Cashbox accounts are ordinary client_accounts rows (see ClientAccount.isSystem) so
// they ride along in every collection sourced from listAllClientAccounts/listTransactions.
// Every ordinary "pick a client account" UI — the Transactions form's from/to pickers, the
// Import wizard's account mapping, LedgerSection's "move account transactions" destination
// picker — must apply this before building its options, or Treasury/a cashbox would appear
// as a selectable normal client account.
export function filterRealClientAccounts(accounts: ClientAccount[]): ClientAccount[] {
 return accounts.filter((account) => !account.isSystem);
}

// The name to feed into the `treasury_cashbox_of` translation ("Cashbox — {{name}}") when
// the Treasury feature's own UI lists a cashbox that isn't the current user's own — falls
// back to the raw stored name only if ownerName is unset (e.g. the owning user's login was
// since deleted; see SystemClient.ownerName).
export function cashboxOwnerName(cashbox: SystemClient): string {
 return cashbox.ownerName || cashbox.name;
}
