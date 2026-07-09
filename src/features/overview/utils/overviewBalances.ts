import { computeAccountBalances, SMALL_BALANCE_THRESHOLD } from '@/shared/utils/accountBalances';
import type {
 Client,
 ClientAccount,
 ClientAdjustment,
 Currency,
 OverviewBalanceGroup,
 Transaction,
} from '@/shared/types';

type ComputeArgs = {
 transactions: Transaction[];
 adjustments: ClientAdjustment[];
 clientAccounts: ClientAccount[];
 clients: Client[];
 currencies: Currency[];
 language: string;
};

export type OverviewBalances = {
 groups: OverviewBalanceGroup[];
 byOrg: Map<string, OverviewBalanceGroup[]>;
 hasAccounts: boolean;
};

// Net balance of every client account, grouped into (organization, currency) cards
// for the overview. Ported verbatim from the page's overviewOrgBalances memo;
// clientAccountMap/currencyMap are built here from the passed collections.
export function computeOverviewBalances({ transactions, adjustments, clientAccounts, clients, currencies, language }: ComputeArgs): OverviewBalances {
 const currencyMap = new Map(currencies.map((currency) => [currency.id, currency]));
  const balanceByAccount = computeAccountBalances({ clientAccounts, transactions, adjustments });

  const clientById = new Map(clients.map((client) => [client.id, client]));
  const groupMap = new Map<string, OverviewBalanceGroup & { clientMap: Map<number, { clientId: number; clientName: string; balance: number }> }>();

  for (const account of clientAccounts) {
   const client = clientById.get(account.clientId);
   // Clients marked "exclude from balance" (e.g. a "me" client used to track personal
   // transfers) still get their own accounts/ledger; they just never feed these pooled totals.
   if (client?.excludeFromBalance) continue;
   const organizationId = client?.organizationId ?? null;
   const organizationName = client?.organizationName ?? null;
   const currency = currencyMap.get(account.currencyId);
   const key = `${organizationId ?? 'none'}:${account.currencyId}`;
   const balance = balanceByAccount.get(account.id) ?? 0;

   let group = groupMap.get(key);
   if (!group) {
    group = {
     key,
     organizationId,
     organizationName,
     currencyId: account.currencyId,
     currencyCode: account.currencyCode,
     currencySymbol: account.currencySymbol,
     isMain: currency?.isMain === 1,
     clients: [],
     total: 0,
     clientMap: new Map(),
    };
    groupMap.set(key, group);
   }

   const existingClient = group.clientMap.get(account.clientId);
   if (existingClient) {
    existingClient.balance += balance;
   } else {
    group.clientMap.set(account.clientId, { clientId: account.clientId, clientName: account.clientName, balance });
   }
   group.total += balance;
  }

  const groups: OverviewBalanceGroup[] = Array.from(groupMap.values()).map((group) => ({
   key: group.key,
   organizationId: group.organizationId,
   organizationName: group.organizationName,
   currencyId: group.currencyId,
   currencyCode: group.currencyCode,
   currencySymbol: group.currencySymbol,
   isMain: group.isMain,
   clients: Array.from(group.clientMap.values())
    // Negligible/settled balances are hidden from the overview list.
    .filter((c) => Math.abs(c.balance) > SMALL_BALANCE_THRESHOLD)
    .sort((a, b) => a.clientName.localeCompare(b.clientName, language, { sensitivity: 'base' })),
   total: group.total,
  }));

  // Main-currency cards first, then by organization name, then by currency code.
  groups.sort((a, b) => {
   if (a.isMain !== b.isMain) return a.isMain ? -1 : 1;
   const orgCompare = (a.organizationName ?? '').localeCompare(b.organizationName ?? '', language, { sensitivity: 'base' });
   if (orgCompare !== 0) return orgCompare;
   return a.currencyCode.localeCompare(b.currencyCode);
  });

  const byOrg = new Map<string, OverviewBalanceGroup[]>();
  for (const group of groups) {
   const orgKey = String(group.organizationId ?? 'none');
   const list = byOrg.get(orgKey);
   if (list) list.push(group);
   else byOrg.set(orgKey, [group]);
  }
  // Drop organizations (including "no organization") whose every currency group has
  // settled to zero — nothing would render for them, so their section header shouldn't either.
  for (const [orgKey, orgGroups] of byOrg) {
   if (orgGroups.every((g) => g.total === 0)) byOrg.delete(orgKey);
  }

  return { groups, byOrg, hasAccounts: clientAccounts.length > 0 };
}
