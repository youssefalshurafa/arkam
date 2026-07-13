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

// --- Global request-activity tracking -------------------------------------
// Every data load/mutation in the app funnels through request(), so counting
// in-flight calls here lets a single global indicator show a spinner anywhere
// work is happening, without wiring loading state into every button.
let activeRequests = 0;
const activityListeners = new Set<(active: boolean) => void>();

function notifyActivity() {
 const isActive = activeRequests > 0;
 for (const listener of activityListeners) {
  listener(isActive);
 }
}

export function subscribeToApiActivity(listener: (active: boolean) => void): () => void {
 activityListeners.add(listener);
 listener(activeRequests > 0);
 return () => {
  activityListeners.delete(listener);
 };
}

async function request<T>({ action, payload }: ApiOptions, hasRetried = false): Promise<T> {
 activeRequests += 1;
 notifyActivity();
 try {
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
     return await request<T>({ action, payload }, true);
    }
   } catch {
    // Fall through to the default error handling below.
   }
  }

  if (!response.ok) {
   throw new Error(data?.error || 'Request failed.');
  }

  return data as T;
 } finally {
  activeRequests -= 1;
  notifyActivity();
 }
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

 // Wait for the brand logo (and any other images) to finish loading so they render in the PDF.
 const waitForImages = () => {
  const images = Array.from(popup.document.images || []);
  return Promise.all(
   images.map((img) =>
    img.complete
     ? Promise.resolve()
     : new Promise<void>((resolve) => {
        img.addEventListener('load', () => resolve(), { once: true });
        img.addEventListener('error', () => resolve(), { once: true });
       }),
   ),
  );
 };

 // Wait for web fonts (e.g. Cairo) to load before printing so they don't fall back to a system font.
 const popupFonts = (popup.document as Document & { fonts?: FontFaceSet }).fonts;
 const fontsReady = popupFonts?.ready ?? Promise.resolve();
 Promise.all([fontsReady, waitForImages()])
  .then(() => setTimeout(triggerPrint, 150))
  .catch(() => setTimeout(triggerPrint, 400));

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
 // Fire-and-forget usage telemetry (app opens + section visits) for the super-admin
 // activity view. Deliberately bypasses request(): it must be silent (no global loading
 // spinner) and must never throw into the caller — a dropped beacon is fine. keepalive
 // lets it survive an unload if the tab is closing.
 recordActivity: (eventType: 'app_open' | 'section_visit', section?: string) => {
  if (typeof window === 'undefined') {
   return;
  }
  const workspaceId = getActiveWorkspaceId();
  void fetch('/api/activity', {
   method: 'POST',
   credentials: 'include',
   keepalive: true,
   headers: {
    'Content-Type': 'application/json',
    ...(workspaceId ? { 'x-workspace-id': workspaceId } : {}),
   },
   body: JSON.stringify({ eventType, section }),
  }).catch(() => {});
 },
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
 moveAccountTransactions: (payload: { fromAccountId: number; toAccountId: number }) =>
  request<{ ok: true; moved: number }>({ action: 'moveAccountTransactions', payload }),
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
 deleteTransactionsBulk: (payload: { transactionIds: number[]; adjustmentIds: number[] }) =>
  request<{ ok: true; deleted: number }>({ action: 'deleteTransactionsBulk', payload }),
 deleteAllTransactions: () => request<{ ok: true }>({ action: 'deleteAllTransactions' }),
 listClientAdjustments: () => request<unknown[]>({ action: 'listClientAdjustments' }),
 createClientAdjustment: (payload: unknown) => request<{ id: number }>({ action: 'createClientAdjustment', payload }),
 updateClientAdjustment: (payload: unknown) => request<{ ok: true }>({ action: 'updateClientAdjustment', payload }),
 deleteClientAdjustment: (id: number) => request<{ ok: true }>({ action: 'deleteClientAdjustment', payload: id }),
 listReconciliations: () => request<unknown[]>({ action: 'listReconciliations' }),
 createReconciliation: (payload: unknown) => request<{ id: number }>({ action: 'createReconciliation', payload }),
 deleteReconciliation: (id: number) => request<{ ok: true }>({ action: 'deleteReconciliation', payload: id }),
 listWorkspaces: () =>
  fetch('/api/workspaces', { method: 'GET', credentials: 'include' }).then(async (response) => {
   const data = await response.json();
   if (!response.ok) {
    throw new Error(data?.error || 'Failed to list workspaces.');
   }
   return data as { workspaces: Array<{ id: string; name: string; slug: string; role: 'owner' | 'admin' | 'member' | 'viewer' }>; defaultWorkspaceId: string | null };
  }),
 createWorkspace: (name: string) =>
  fetch('/api/workspaces', {
   method: 'POST',
   credentials: 'include',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ name }),
  }).then(async (response) => {
   const data = await response.json();
   if (!response.ok) {
    throw new Error(data?.error || 'Failed to create workspace.');
   }
   return data as { ok: true; workspace: { id: string; name: string; slug: string } };
  }),
 getWorkspaceTransactionCount: (workspaceId: string) =>
  fetch(`/api/workspaces/${workspaceId}`, { method: 'GET', credentials: 'include' }).then(async (response) => {
   const data = await response.json();
   if (!response.ok) {
    throw new Error(data?.error || 'Failed to load workspace info.');
   }
   return data as { transactionCount: number };
  }),
 renameWorkspace: (workspaceId: string, name: string) =>
  fetch(`/api/workspaces/${workspaceId}`, {
   method: 'PATCH',
   credentials: 'include',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ name }),
  }).then(async (response) => {
   const data = await response.json();
   if (!response.ok) {
    throw new Error(data?.error || 'Failed to rename workspace.');
   }
   return data as { ok: true; workspace: { id: string; name: string } };
  }),
 deleteWorkspace: (workspaceId: string) =>
  fetch(`/api/workspaces/${workspaceId}`, { method: 'DELETE', credentials: 'include' }).then(async (response) => {
   const data = await response.json();
   if (!response.ok) {
    throw new Error(data?.error || 'Failed to delete workspace.');
   }
   return data as { ok: true };
  }),
 listWorkspaceMembers: (workspaceId: string) =>
  fetch(`/api/workspaces/${workspaceId}/members`, { method: 'GET', credentials: 'include' }).then(async (response) => {
   const data = await response.json();
   if (!response.ok) {
    throw new Error(data?.error || 'Failed to list members.');
   }
   return data as { members: WorkspaceMember[] };
  }),
 inviteWorkspaceMember: ({ workspaceId, name, email, role }: { workspaceId: string; name: string; email: string; role: WorkspaceRole }) =>
  fetch(`/api/workspaces/${workspaceId}/members`, {
   method: 'POST',
   credentials: 'include',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ name, email, role }),
  }).then(async (response) => {
   const data = await response.json();
   if (!response.ok) {
    throw new Error(data?.error || 'Failed to invite member.');
   }
   return data as { ok: true; status: 'invited' | 'added'; emailSent: boolean };
  }),
 updateWorkspaceMemberRole: ({ workspaceId, targetUserId, role }: { workspaceId: string; targetUserId: string; role: WorkspaceRole }) =>
  fetch(`/api/workspaces/${workspaceId}/members`, {
   method: 'PATCH',
   credentials: 'include',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ targetUserId, role }),
  }).then(async (response) => {
   const data = await response.json();
   if (!response.ok) {
    throw new Error(data?.error || 'Failed to update role.');
   }
   return data as { ok: true };
  }),
 removeWorkspaceMember: ({ workspaceId, targetUserId }: { workspaceId: string; targetUserId: string }) =>
  fetch(`/api/workspaces/${workspaceId}/members`, {
   method: 'DELETE',
   credentials: 'include',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ targetUserId }),
  }).then(async (response) => {
   const data = await response.json();
   if (!response.ok) {
    throw new Error(data?.error || 'Failed to remove member.');
   }
   return data as { ok: true };
  }),
 exportLedgerPdf: ({ html, defaultFileName }: { html: string; defaultFileName: string }) => exportHtmlAsPdfFallback(html, defaultFileName),
 exportWorkspaceData: () => request<WorkspaceBackup>({ action: 'exportWorkspaceData' }),
 importWorkspaceData: (backup: WorkspaceBackup) => request<{ ok: true }>({ action: 'importWorkspaceData', payload: backup }),
 bulkImportTransactions: (payload: { transactions: unknown[]; adjustments: unknown[] }) =>
  request<{ createdTransactions: number; createdAdjustments: number }>({ action: 'bulkImportTransactions', payload }),
 getBackupInfo: () => request<BackupInfo>({ action: 'getBackupInfo' }),
 recordBackup: (device: string) => request<BackupInfo>({ action: 'recordBackup', payload: { device } }),
 getWorkspaceSettings: () => request<WorkspaceSharedSettings>({ action: 'getWorkspaceSettings' }),
 saveWorkspaceSettings: (payload: { sharedEnabled?: boolean; settings?: Record<string, string> }) =>
  request<WorkspaceSharedSettings>({ action: 'saveWorkspaceSettings', payload }),
 getUserTableSettings: () => request<Record<string, string>>({ action: 'getUserTableSettings' }),
 saveUserTableSettings: (settings: Record<string, string>) => request<{ ok: true }>({ action: 'saveUserTableSettings', payload: settings }),
};

// Workspace-wide shared UI settings. `settings` mirrors the relevant localStorage
// keys (ledger/transaction table preferences) so the snapshot is layout-agnostic.
export type WorkspaceSharedSettings = {
 sharedEnabled: boolean;
 settings: Record<string, string>;
 version: number;
};

export type BackupInfo = {
 lastBackupAt: string | null;
 lastBackupDevice: string | null;
};

export type WorkspaceRole = 'admin' | 'member' | 'viewer';

export type WorkspaceMember = {
 id: string;
 email: string;
 name: string;
 image: string | null;
 role: 'owner' | 'admin' | 'member' | 'viewer';
 addedAt: string;
};

export type WorkspaceBackup = {
 format: string;
 version: number;
 exportedAt: string;
 database: string;
 schema: string;
 tables: Record<string, Array<Record<string, unknown>>>;
};
