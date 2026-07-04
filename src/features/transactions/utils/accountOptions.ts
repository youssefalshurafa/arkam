import type { ClientAccount } from '@/shared/types';

// One navigable row in the new-transaction account picker. The picker groups accounts by
// client: a client with a single account renders as one selectable row ('single'); a client
// with several renders as an expandable header ('group') followed, when expanded, by its
// accounts ('child').
export type AccountOption =
 | { kind: 'single'; account: ClientAccount }
 | { kind: 'group'; clientId: number; clientName: string; count: number; expanded: boolean }
 | { kind: 'child'; account: ClientAccount };

// Flattens the grouped picker into the exact ordered list of rows the dropdown renders, so
// keyboard navigation (arrow keys / Enter) and the rendered <li>s stay in lockstep. A group is
// expanded either when the user opened it (expandedClientId) or whenever a search query is
// active (every match is shown expanded).
export function buildAccountOptions(clientAccounts: ClientAccount[], query: string, expandedClientId: number | null): AccountOption[] {
 const q = query.trim().toLowerCase();
 const byClient = new Map<number, ClientAccount[]>();
 for (const account of clientAccounts) {
  if (q && !`${account.clientName} ${account.currencyCode}`.toLowerCase().includes(q)) continue;
  const arr = byClient.get(account.clientId) ?? [];
  arr.push(account);
  byClient.set(account.clientId, arr);
 }

 const options: AccountOption[] = [];
 for (const accts of byClient.values()) {
  if (accts.length === 1) {
   options.push({ kind: 'single', account: accts[0] });
   continue;
  }
  const clientId = accts[0].clientId;
  const expanded = !!q || expandedClientId === clientId;
  options.push({ kind: 'group', clientId, clientName: accts[0].clientName, count: accts.length, expanded });
  if (expanded) {
   for (const account of accts) options.push({ kind: 'child', account });
  }
 }
 return options;
}
