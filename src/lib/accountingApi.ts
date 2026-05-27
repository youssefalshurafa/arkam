const activeWorkspaceStorageKey = 'arkam.activeWorkspaceId';

type ApiOptions = {
 action: string;
 payload?: unknown;
};

function getActiveWorkspaceId() {
 if (typeof window === 'undefined') {
  return null;
 }

 const stored = window.localStorage.getItem(activeWorkspaceStorageKey);
 return stored?.trim() || null;
}

async function request<T>({ action, payload }: ApiOptions): Promise<T> {
 const workspaceId = getActiveWorkspaceId();
 const response = await fetch('/api/accounting', {
  method: 'POST',
  headers: {
   'Content-Type': 'application/json',
   ...(workspaceId ? { 'x-workspace-id': workspaceId } : {}),
  },
  body: JSON.stringify({ action, payload }),
 });

 const data = await response.json();

 if (!response.ok) {
  throw new Error(data?.error || 'Request failed.');
 }

 return data as T;
}

function exportHtmlAsPdfFallback(html: string, title: string): Promise<{ ok: boolean; filePath?: string }> {
 const popup = window.open('', '_blank');

 if (!popup) {
  return Promise.resolve({ ok: false });
 }

 popup.document.open();
 popup.document.write(html);
 popup.document.title = title;
 popup.document.close();

 popup.focus();
 popup.print();

 return Promise.resolve({ ok: true });
}

export const accountingApi = {
 setActiveWorkspaceId: (workspaceId: string | null) => {
  if (typeof window === 'undefined') {
   return;
  }

  if (workspaceId?.trim()) {
   window.localStorage.setItem(activeWorkspaceStorageKey, workspaceId.trim());
   return;
  }

  window.localStorage.removeItem(activeWorkspaceStorageKey);
 },
 getActiveWorkspaceId,
 getDbInfo: () => request<{ dbPath: string; dbDirectory: string }>({ action: 'getDbInfo' }),
 chooseDbDirectory: async () => null,
 setDbDirectory: (nextDirectory: string) => request<{ dbPath: string; dbDirectory: string }>({ action: 'setDbDirectory', payload: nextDirectory }),
 listOrganizations: () => request<unknown[]>({ action: 'listOrganizations' }),
 createOrganization: (organization: unknown) => request<{ ok: true }>({ action: 'createOrganization', payload: organization }),
 updateOrganization: (organization: unknown) => request<{ ok: true }>({ action: 'updateOrganization', payload: organization }),
 deleteOrganization: (organizationId: number) => request<{ ok: true }>({ action: 'deleteOrganization', payload: organizationId }),
 listClients: () => request<unknown[]>({ action: 'listClients' }),
 createClient: (client: unknown) => request<{ ok: true }>({ action: 'createClient', payload: client }),
 updateClient: (client: unknown) => request<{ ok: true }>({ action: 'updateClient', payload: client }),
 deleteClient: (clientId: number) => request<{ ok: true }>({ action: 'deleteClient', payload: clientId }),
 deleteAllClients: () => request<{ ok: true }>({ action: 'deleteAllClients' }),
 listAllClientAccounts: () => request<unknown[]>({ action: 'listAllClientAccounts' }),
 listClientAccounts: (clientId: number) => request<unknown[]>({ action: 'listClientAccounts', payload: clientId }),
 createClientAccount: (account: unknown) => request<{ ok: true }>({ action: 'createClientAccount', payload: account }),
 updateClientAccountStartingBalance: (payload: unknown) => request<{ ok: true }>({ action: 'updateClientAccountStartingBalance', payload }),
 deleteClientAccount: (accountId: number) => request<{ ok: true }>({ action: 'deleteClientAccount', payload: accountId }),
 listCurrencies: () => request<unknown[]>({ action: 'listCurrencies' }),
 createCurrency: (currency: unknown) => request<{ ok: true }>({ action: 'createCurrency', payload: currency }),
 updateCurrency: (currency: unknown) => request<{ ok: true }>({ action: 'updateCurrency', payload: currency }),
 deleteCurrency: (currencyId: number) => request<{ ok: true }>({ action: 'deleteCurrency', payload: currencyId }),
 deleteAllCurrencies: () => request<{ ok: true }>({ action: 'deleteAllCurrencies' }),
 reseedCurrencies: () => request<{ ok: true }>({ action: 'reseedCurrencies' }),
 enableCurrency: (currencyId: number) => request<{ ok: true }>({ action: 'enableCurrency', payload: currencyId }),
 disableCurrency: (currencyId: number) => request<{ ok: true }>({ action: 'disableCurrency', payload: currencyId }),
 setMainCurrency: (currencyId: number) => request<{ ok: true }>({ action: 'setMainCurrency', payload: currencyId }),
 listTransactions: () => request<unknown[]>({ action: 'listTransactions' }),
 createTransaction: (transaction: unknown) => request<{ ok: true }>({ action: 'createTransaction', payload: transaction }),
 updateTransaction: (transaction: unknown) => request<{ ok: true }>({ action: 'updateTransaction', payload: transaction }),
 deleteTransaction: (transactionId: number) => request<{ ok: true }>({ action: 'deleteTransaction', payload: transactionId }),
 deleteAllTransactions: () => request<{ ok: true }>({ action: 'deleteAllTransactions' }),
 listWorkspaces: () =>
  fetch('/api/workspaces', { method: 'GET' }).then(async (response) => {
   const data = await response.json();
   if (!response.ok) {
    throw new Error(data?.error || 'Failed to list workspaces.');
   }
   return data as { workspaces: Array<{ id: string; name: string; slug: string; role: 'owner' | 'admin' | 'member' | 'viewer' }>; defaultWorkspaceId: string | null };
  }),
 addWorkspaceMember: ({ workspaceId, email, role }: { workspaceId: string; email: string; role: 'admin' | 'member' | 'viewer' }) =>
  fetch(`/api/workspaces/${workspaceId}/members`, {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ email, role }),
  }).then(async (response) => {
   const data = await response.json();
   if (!response.ok) {
    throw new Error(data?.error || 'Failed to add workspace member.');
   }
   return data as { ok: true; member: { userId: string; email: string; role: 'admin' | 'member' | 'viewer' } };
  }),
 exportLedgerPdf: ({ html, defaultFileName }: { html: string; defaultFileName: string }) => exportHtmlAsPdfFallback(html, defaultFileName),
};
