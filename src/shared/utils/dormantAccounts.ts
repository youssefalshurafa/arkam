import type { ClientAccount } from '@/shared/types';

// A dormant account ("حساب راكد", ClientAccount.isDormant) is a normal account in every
// respect — ledger, balances, history and PDF exports are untouched — that the user has put
// out of circulation, so it must not be offered when picking the parties of a transaction.
// Every "pick a client account" UI on the transaction side (the new-transaction form's
// from/to pickers, the transactions table's row editor, the details modal's account fields)
// runs its list through this. Because those pickers group accounts by client, a client whose
// accounts are ALL dormant is left with no rows and so disappears from the picker entirely,
// which is the intended behaviour.
//
// keepAccountIds are the ids already selected in the form being rendered: an existing
// transaction may well point at an account that has since gone dormant, and dropping it from
// the list would blank out the picker's label and silently offer to lose the reference. Those
// ids stay visible; everything else dormant is filtered out.
export function filterActiveClientAccounts(
 accounts: ClientAccount[],
 keepAccountIds: Array<number | null | undefined> = [],
): ClientAccount[] {
 const kept = new Set(keepAccountIds.filter((id): id is number => typeof id === 'number'));
 return accounts.filter((account) => !account.isDormant || kept.has(account.id));
}
