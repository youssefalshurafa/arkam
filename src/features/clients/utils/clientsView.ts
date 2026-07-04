import type { Client } from '@/shared/types';

export type ClientSort = { key: 'name' | 'organization'; dir: 'asc' | 'desc' };
export type ClientOrgGroup = { id: number | null; name: string; clients: Client[] };

// Sorts clients by the active column/direction, then applies the search filter.
// Ported verbatim from the page's sortedClients memo.
export function sortAndFilterClients({ clients, clientSort, clientSearch, language }: {
 clients: Client[];
 clientSort: ClientSort;
 clientSearch: string;
 language: string;
}): Client[] {
  const factor = clientSort.dir === 'asc' ? 1 : -1;
  const sorted = [...clients].sort((a, b) => {
   const aVal = clientSort.key === 'organization' ? a.organizationName || '' : a.name;
   const bVal = clientSort.key === 'organization' ? b.organizationName || '' : b.name;
   return aVal.localeCompare(bVal, language, { sensitivity: 'base' }) * factor;
  });
  const q = clientSearch.trim().toLowerCase();
  if (!q) return sorted;
  return sorted.filter((c) => c.name.toLowerCase().includes(q) || (c.organizationName ?? '').toLowerCase().includes(q));
}

// Groups (already sorted/filtered) clients per organization for the card view,
// honouring the user's drag order. Ported verbatim from clientsByOrganization.
export function groupClientsByOrganization({ sortedClients, clientsOrgOrder, language, t }: {
 sortedClients: Client[];
 clientsOrgOrder: string[];
 language: string;
 t: (key: string, params?: Record<string, string | number>) => string;
}): ClientOrgGroup[] {
  const groups = new Map<string, { id: number | null; name: string; clients: Client[] }>();
  for (const client of sortedClients) {
   const key = client.organizationId == null ? '__unassigned__' : String(client.organizationId);
   let group = groups.get(key);
   if (!group) {
    group = { id: client.organizationId, name: client.organizationName || t('unassigned'), clients: [] };
    groups.set(key, group);
   }
   group.clients.push(client);
  }
  const keyOf = (g: { id: number | null }) => (g.id == null ? '__unassigned__' : String(g.id));
  return Array.from(groups.values()).sort((a, b) => {
   // Honour the user's drag-arranged order first; groups without a saved
   // position fall back to alphabetical with "unassigned" last.
   const ia = clientsOrgOrder.indexOf(keyOf(a));
   const ib = clientsOrgOrder.indexOf(keyOf(b));
   if (ia !== -1 && ib !== -1) return ia - ib;
   if (ia !== -1) return -1;
   if (ib !== -1) return 1;
   if (a.id == null) return 1;
   if (b.id == null) return -1;
   return a.name.localeCompare(b.name, language, { sensitivity: 'base' });
  });
}
