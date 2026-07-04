import { getCommissionAmount } from '@/shared/utils/commission';
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
 const clientAccountMap = new Map(clientAccounts.map((account) => [account.id, account]));
 const currencyMap = new Map(currencies.map((currency) => [currency.id, currency]));

  const balanceByAccount = new Map<number, number>();
  for (const account of clientAccounts) {
   balanceByAccount.set(account.id, account.startingBalance ?? 0);
  }

  for (const transaction of transactions) {
   if (transaction.isArchived) continue;
   if (transaction.accountFromId != null && balanceByAccount.has(transaction.accountFromId)) {
    const account = clientAccountMap.get(transaction.accountFromId);
    if (account) {
     const pending = transaction.currencyId !== account.currencyId && transaction.exchangeRateFrom === 0;
     const netChange = pending
      ? 0
      : transaction.amount * transaction.exchangeRateFrom + getCommissionAmount(transaction.amount * transaction.exchangeRateFrom, transaction.commissionFrom);
     balanceByAccount.set(transaction.accountFromId, (balanceByAccount.get(transaction.accountFromId) ?? 0) + netChange);
    }
   }
   if (transaction.accountToId != null && balanceByAccount.has(transaction.accountToId)) {
    const account = clientAccountMap.get(transaction.accountToId);
    if (account) {
     const pending = transaction.currencyId !== account.currencyId && transaction.exchangeRateTo === 0;
     const netChange = pending
      ? 0
      : -(transaction.amount * transaction.exchangeRateTo - getCommissionAmount(transaction.amount * transaction.exchangeRateTo, transaction.commissionTo));
     balanceByAccount.set(transaction.accountToId, (balanceByAccount.get(transaction.accountToId) ?? 0) + netChange);
    }
   }
  }

  for (const adj of adjustments) {
   if (!balanceByAccount.has(adj.accountId)) continue;
   const account = clientAccountMap.get(adj.accountId);
   if (!account) continue;
   const pending = adj.currencyId != null && adj.currencyId !== account.currencyId && (adj.exchangeRate ?? 0) === 0;
   const netChange = pending ? 0 : (adj.direction === 'credit' ? 1 : -1) * adj.amount * (adj.exchangeRate || 1);
   balanceByAccount.set(adj.accountId, (balanceByAccount.get(adj.accountId) ?? 0) + netChange);
  }

  const clientById = new Map(clients.map((client) => [client.id, client]));
  const groupMap = new Map<string, OverviewBalanceGroup & { clientMap: Map<number, { clientId: number; clientName: string; balance: number }> }>();

  for (const account of clientAccounts) {
   const client = clientById.get(account.clientId);
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
    // Balances within ±100 are treated as negligible/settled and hidden from the overview list.
    .filter((c) => Math.abs(c.balance) > 100)
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

  return { groups, byOrg, hasAccounts: clientAccounts.length > 0 };
}
