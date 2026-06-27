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

async function request<T>({ action, payload }: ApiOptions, hasRetried = false): Promise<T> {
 const workspaceId = getActiveWorkspaceId();
 const response = await fetch('/api/accounting', {
  method: 'POST',
  credentials: 'include',
  headers: {
   'Content-Type': 'application/json',
   ...(workspaceId ? { 'x-workspace-id': workspaceId } : {}),
  },
  body: JSON.stringify({ action, payload }),
 });

 const data = await response.json();

 if (response.status === 401 && !hasRetried) {
  try {
   const sessionResponse = await fetch('/api/auth/session', {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
   });
   const sessionPayload = (await sessionResponse.json()) as { user?: { id?: string } };

   if (sessionPayload?.user?.id) {
    return request<T>({ action, payload }, true);
   }
  } catch {
   // Fall through to the default error handling below.
  }
 }

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

 const triggerPrint = () => {
  popup.focus();
  popup.print();
 };

 // Wait for web fonts (e.g. Cairo) to load before printing so they don't fall back to a system font.
 const popupFonts = (popup.document as Document & { fonts?: FontFaceSet }).fonts;
 if (popupFonts?.ready) {
  popupFonts.ready.then(() => setTimeout(triggerPrint, 150)).catch(() => triggerPrint());
 } else {
  setTimeout(triggerPrint, 400);
 }

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
 getDbInfo: () =>
  request<{ provider: string; host: string; port: string; database: string; schema: string; dbPath: string; dbDirectory: string; supportsDirectoryChange: boolean }>({
   action: 'getDbInfo',
  }),
 chooseDbDirectory: async () => null,
 setDbDirectory: (nextDirectory: string) =>
  request<{ provider: string; host: string; port: string; database: string; schema: string; dbPath: string; dbDirectory: string; supportsDirectoryChange: boolean }>({
   action: 'setDbDirectory',
   payload: nextDirectory,
  }),
 listOrganizations: () => request<unknown[]>({ action: 'listOrganizations' }),
 createOrganization: (organization: unknown) => request<{ ok: true }>({ action: 'createOrganization', payload: organization }),
 updateOrganization: (organization: unknown) => request<{ ok: true }>({ action: 'updateOrganization', payload: organization }),
 deleteOrganization: (organizationId: number) => request<{ ok: true }>({ action: 'deleteOrganization', payload: organizationId }),
 listClients: () => request<unknown[]>({ action: 'listClients' }),
 createClient: (client: unknown) => request<{ ok: true; clientId: number }>({ action: 'createClient', payload: client }),
 updateClient: (client: unknown) => request<{ ok: true }>({ action: 'updateClient', payload: client }),
 deleteClient: (clientId: number) => request<{ ok: true }>({ action: 'deleteClient', payload: clientId }),
 deleteAllClients: () => request<{ ok: true }>({ action: 'deleteAllClients' }),
 listAllClientAccounts: () => request<unknown[]>({ action: 'listAllClientAccounts' }),
 listClientAccounts: (clientId: number) => request<unknown[]>({ action: 'listClientAccounts', payload: clientId }),
 createClientAccount: (account: unknown) => request<{ ok: true }>({ action: 'createClientAccount', payload: account }),
 updateClientAccountStartingBalance: (payload: unknown) => request<{ ok: true }>({ action: 'updateClientAccountStartingBalance', payload }),
 updateClientAccount: (payload: unknown) => request<{ ok: true }>({ action: 'updateClientAccount', payload }),
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
 listClientAdjustments: () => request<unknown[]>({ action: 'listClientAdjustments' }),
 createClientAdjustment: (payload: unknown) => request<{ id: number }>({ action: 'createClientAdjustment', payload }),
 updateClientAdjustment: (payload: unknown) => request<{ ok: true }>({ action: 'updateClientAdjustment', payload }),
 deleteClientAdjustment: (id: number) => request<{ ok: true }>({ action: 'deleteClientAdjustment', payload: id }),
 listWorkspaces: () =>
  fetch('/api/workspaces', { method: 'GET', credentials: 'include' }).then(async (response) => {
   const data = await response.json();
   if (!response.ok) {
    throw new Error(data?.error || 'Failed to list workspaces.');
   }
   return data as { workspaces: Array<{ id: string; name: string; slug: string; role: 'owner' | 'admin' | 'member' | 'viewer' }>; defaultWorkspaceId: string | null };
  }),
 addWorkspaceMember: ({ workspaceId, email, role }: { workspaceId: string; email: string; role: 'admin' | 'member' | 'viewer' }) =>
  fetch(`/api/workspaces/${workspaceId}/members`, {
   method: 'POST',
   credentials: 'include',
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
 exportWorkspaceData: () => request<WorkspaceBackup>({ action: 'exportWorkspaceData' }),
 importWorkspaceData: (backup: WorkspaceBackup) => request<{ ok: true }>({ action: 'importWorkspaceData', payload: backup }),
};

export type WorkspaceBackup = {
 format: string;
 version: number;
 exportedAt: string;
 database: string;
 schema: string;
 tables: Record<string, Array<Record<string, unknown>>>;
};
