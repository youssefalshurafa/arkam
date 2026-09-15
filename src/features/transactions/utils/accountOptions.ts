import type { ClientAccount, Transaction } from '@/shared/types';

// One navigable row in the new-transaction account picker. The picker groups accounts by
// client: a client with a single account renders as one selectable row ('single'); a client
// with several renders as an expandable header ('group') followed, when expanded, by its
// accounts ('child').
// `recent` marks a row belonging to the recently-used block pinned at the top of the list; the
// same client also appears a second time, in its alphabetical place, so the flag is what keeps
// the two copies apart (React keys, the divider between the blocks). 'header' is a label row —
// not selectable, skipped by keyboard navigation.
export type AccountOption =
 | { kind: 'single'; account: ClientAccount; recent?: boolean }
 | { kind: 'group'; clientId: number; clientName: string; count: number; expanded: boolean; recent?: boolean }
 | { kind: 'child'; account: ClientAccount; recent?: boolean }
 | { kind: 'header'; key: 'recent' | 'all' };

// How many recently-used clients the picker pins above the alphabetical list.
export const RECENT_CLIENT_LIMIT = 5;

/**
 * Client ids ordered most-recently-used first, from the transactions touching their accounts.
 *
 * Recency is the transaction's own id (auto-increment = creation order), not its date: "recently
 * used" means the client you last entered a transaction for, which a backdated row would
 * otherwise misreport. Only clients among `clientAccounts` can rank, so accounts the picker
 * already filters out (system, hidden, dormant) never surface here either.
 */
export function buildRecentClientIds(
 transactions: Array<Pick<Transaction, 'id' | 'accountFromId' | 'accountToId'>>,
 clientAccounts: ClientAccount[],
 limit = RECENT_CLIENT_LIMIT,
): number[] {
 const clientIdByAccount = new Map(clientAccounts.map((account) => [account.id, account.clientId]));
 const lastUsed = new Map<number, number>();
 for (const transaction of transactions) {
  for (const accountId of [transaction.accountFromId, transaction.accountToId]) {
   if (accountId == null) continue;
   const clientId = clientIdByAccount.get(accountId);
   if (clientId == null) continue;
   const previous = lastUsed.get(clientId);
   if (previous == null || transaction.id > previous) lastUsed.set(clientId, transaction.id);
  }
 }
 return [...lastUsed.entries()]
  .sort((left, right) => right[1] - left[1])
  .slice(0, limit)
  .map(([clientId]) => clientId);
}

// Flattens the grouped picker into the exact ordered list of rows the dropdown renders, so
// keyboard navigation (arrow keys / Enter) and the rendered <li>s stay in lockstep. A group is
// expanded either when the user opened it (expandedClientId) or whenever a search query is
// active (every match is shown expanded).
export function buildAccountOptions(
 clientAccounts: ClientAccount[],
 query: string,
 expandedClientId: number | null,
 recentClientIds: number[] = [],
): AccountOption[] {
 const q = query.trim().toLowerCase();
 const byClient = new Map<number, ClientAccount[]>();
 for (const account of clientAccounts) {
  if (q && !`${account.clientName} ${account.currencyCode}`.toLowerCase().includes(q)) continue;
  const arr = byClient.get(account.clientId) ?? [];
  arr.push(account);
  byClient.set(account.clientId, arr);
 }

 // One client's rows, in whichever block they're being emitted into. A recent row is byte-for-byte
 // the row the alphabetical list renders (same expand/select behaviour, same shared expanded
 // state) apart from the flag, so nothing downstream has to special-case the pinned copy.
 const rowsForClient = (accts: ClientAccount[], recent: boolean): AccountOption[] => {
  // The flag is only ever set, never set to false, so an ordinary row keeps exactly the shape it
  // has always had.
  const mark = recent ? { recent: true as const } : {};
  if (accts.length === 1) return [{ kind: 'single', account: accts[0], ...mark }];
  const clientId = accts[0].clientId;
  const expanded = !!q || expandedClientId === clientId;
  const rows: AccountOption[] = [{ kind: 'group', clientId, clientName: accts[0].clientName, count: accts.length, expanded, ...mark }];
  if (expanded) for (const account of accts) rows.push({ kind: 'child', account, ...mark });
  return rows;
 };

 // The recently-used block is only pinned on the unfiltered list: once the user is searching,
 // they've named who they want, and a duplicated match at the top would just be noise.
 const recentClients = q ? [] : recentClientIds.map((clientId) => byClient.get(clientId)).filter((accts): accts is ClientAccount[] => !!accts);

 const options: AccountOption[] = [];
 if (recentClients.length > 0) {
  options.push({ kind: 'header', key: 'recent' });
  for (const accts of recentClients) options.push(...rowsForClient(accts, true));
  options.push({ kind: 'header', key: 'all' });
 }
 for (const accts of byClient.values()) options.push(...rowsForClient(accts, false));
 return options;
}
