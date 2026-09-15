import { isTempTransactionId, resolveTransactionId, resolveTransactionIds } from '@/lib/pendingTransactionWrites';
import { localDateKey } from '@/shared/utils/date';
import type { SystemClient, TreasuryBalanceEntry, WriteOffMargin } from '@/shared/types';
import type { ReviewEngineSettings } from '@/features/ledger/utils/reviewSettings';

const activeWorkspaceStorageKey = 'arkam.activeWorkspaceId';

type ApiOptions = {
 action: string;
 payload?: unknown;
 // A write the user is not waiting on (an optimistic save, or the reconciling refetch behind
 // it). It still counts as in-flight for the unload guard — it just doesn't drive the loading
 // indicator, because there is nothing on screen for the user to wait for. Opt-in: anything
 // that doesn't say otherwise is treated as foreground work.
 silent?: boolean;
};

// Every payload field that can carry a transaction id. The resolving wrappers below translate
// these before sending; this is the backstop that makes a slip impossible rather than unlikely —
// a temporary id reaching the server would UPDATE zero rows and still answer `ok`, which is
// exactly how a placeholder id once lost an edit silently.
const TRANSACTION_ID_FIELDS = ['id', 'transactionId', 'anchorTransactionId'] as const;
const TRANSACTION_ID_LIST_FIELDS = ['transactionIds', 'lockedTransactionIds'] as const;

function assertNoTempTransactionIds(action: string, payload: unknown) {
 if (!payload || typeof payload !== 'object') return;
 const record = payload as Record<string, unknown>;
 const isTemp = (value: unknown) => typeof value === 'number' && isTempTransactionId(value);
 for (const field of TRANSACTION_ID_FIELDS) {
  if (isTemp(record[field])) throw new Error(`${action}: unsaved transaction id in "${field}"`);
 }
 for (const field of TRANSACTION_ID_LIST_FIELDS) {
  const list = record[field];
  if (Array.isArray(list) && list.some(isTemp)) throw new Error(`${action}: unsaved transaction id in "${field}"`);
 }
}

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
// Only FOREGROUND calls are reported: a save the user has already moved on from
// shouldn't flash a loading bar at them (see ApiOptions.silent).
let activeRequests = 0;
let activeForegroundRequests = 0;
const activityListeners = new Set<(active: boolean) => void>();

function notifyActivity() {
 const isActive = activeForegroundRequests > 0;
 for (const listener of activityListeners) {
  listener(isActive);
 }
}

export function subscribeToApiActivity(listener: (active: boolean) => void): () => void {
 activityListeners.add(listener);
 listener(activeForegroundRequests > 0);
 return () => {
  activityListeners.delete(listener);
 };
}

/** Total in-flight calls, silent ones included — diagnostics and tests only. */
export function activeRequestCount(): number {
 return activeRequests;
}

async function request<T>({ action, payload, silent }: ApiOptions, hasRetried = false): Promise<T> {
 activeRequests += 1;
 if (!silent) activeForegroundRequests += 1;
 notifyActivity();
 try {
  assertNoTempTransactionIds(action, payload);
  const workspaceId = getActiveWorkspaceId();
  const response = await fetch('/api/accounting', {
   method: 'POST',
   credentials: 'include',
   headers: {
    'Content-Type': 'application/json',
    ...(workspaceId ? { 'x-workspace-id': workspaceId } : {}),
    // This client's own local "today" — used server-side by the past-edit lock check so
    // the boundary matches the user's wall-clock day, not the server's (see route.ts).
    'x-client-date': localDateKey(),
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
     // Forward the whole options object: dropping `silent` here would make a retried
     // background write start flashing the loading bar.
     return await request<T>({ action, payload, silent }, true);
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
  if (!silent) activeForegroundRequests -= 1;
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
 // Treasury & Cashbox: the hidden system `clients` rows themselves (id/name/kind/owner) —
 // fetched separately from listClients since they're deliberately excluded from it.
 listSystemClients: () => request<SystemClient[]>({ action: 'listSystemClients' }),
 // Treasury's cash-on-hand per currency — balance only, readable by every role including a
 // `member` (see getTreasuryBalance in route.ts).
 getTreasuryBalance: () => request<TreasuryBalanceEntry[]>({ action: 'getTreasuryBalance' }),
 // Lazily bootstraps the workspace's Treasury + one Cashbox per non-viewer member. Safe to
 // call on every Treasury-section mount (idempotent server-side).
 ensureTreasuryAndCashboxes: () => request<{ ok: true; treasuryId: number | null }>({ action: 'ensureTreasuryAndCashboxes' }),
 // Idempotently creates (if missing) and returns the id of a Treasury/Cashbox account for a
 // given currency, used right before submitting an entry whose fixed side hasn't held that
 // currency yet.
 ensureSystemAccount: (payload: { systemClientId: number; currencyId: number }) =>
  request<{ accountId: number }>({ action: 'ensureSystemAccount', payload }),
 updateClientAccountStartingBalance: (payload: unknown) => request<{ ok: true }>({ action: 'updateClientAccountStartingBalance', payload }),
 updateClientAccountNote: (payload: { accountId: number; note: string; noteShowInPdf: boolean }) =>
  request<{ ok: true }>({ action: 'updateClientAccountNote', payload }),
 // Marks one account dormant ("حساب راكد") or active again — a picker-visibility flag only,
 // it changes nothing about the account's ledger or balances.
 updateClientAccountDormant: (payload: { accountId: number; isDormant: boolean }) =>
  request<{ ok: true }>({ action: 'updateClientAccountDormant', payload }),
 // The same flag applied to every account of one client in a single write — the accounts
 // panel's "mark all dormant" toggle.
 updateClientAccountsDormant: (payload: { clientId: number; isDormant: boolean }) =>
  request<{ ok: true }>({ action: 'updateClientAccountsDormant', payload }),
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
 // A create is the one transaction call that carries no id, so nothing to resolve. Its answer is
 // what every temporary id waits on (see registerPendingCreate).
 createTransaction: (transaction: unknown, opts?: { silent?: boolean }) =>
  request<{ ok: true; id: number }>({ action: 'createTransaction', payload: transaction, silent: opts?.silent }),
 // Every call below translates a possibly-temporary id into the real one before sending. Doing it
 // HERE, at the app's single door to the server, is what makes an unsaved id reaching the
 // database structurally impossible: no call site can forget it, and a row created a moment ago
 // can be edited, deleted or reconciled immediately without the caller knowing or caring whether
 // its create has landed.
 updateTransaction: async (transaction: { id: number } & Record<string, unknown>, opts?: { silent?: boolean }) =>
  request<{ ok: true }>({
   action: 'updateTransaction',
   payload: { ...transaction, id: await resolveTransactionId(transaction.id) },
   silent: opts?.silent,
  }),
 setTransactionArchiveHidden: async (payload: { id: number; hidden: boolean }, opts?: { silent?: boolean }) =>
  request<{ ok: true }>({ action: 'setTransactionArchiveHidden', payload: { ...payload, id: await resolveTransactionId(payload.id) }, silent: opts?.silent }),
 deleteTransaction: async (transactionId: number, opts?: { acknowledgeReconciliationOverride?: boolean }) =>
  request<{ ok: true }>({
   action: 'deleteTransaction',
   payload: { id: await resolveTransactionId(transactionId), acknowledgeReconciliationOverride: opts?.acknowledgeReconciliationOverride },
  }),
 deleteTransactionsBulk: async (payload: { transactionIds: number[]; acknowledgeReconciliationOverride?: boolean }) =>
  request<{ ok: true; deleted: number }>({
   action: 'deleteTransactionsBulk',
   payload: { ...payload, transactionIds: await resolveTransactionIds(payload.transactionIds) },
  }),
 deleteAllTransactions: () => request<{ ok: true }>({ action: 'deleteAllTransactions' }),
 listTransactionHistory: async (transactionId: number) =>
  request<TransactionHistoryResponse>({ action: 'listTransactionHistory', payload: { transactionId: await resolveTransactionId(transactionId) } }),
 listReconciliations: () => request<unknown[]>({ action: 'listReconciliations' }),
 // Both the anchor and the frozen membership set name transaction rows, so both wait for any
 // row among them that is still being created — a ✓ agreed over an unsaved row would be a lie.
 createReconciliation: async (payload: { anchorTransactionId: number; lockedTransactionIds: number[] } & Record<string, unknown>) =>
  request<{ id: number }>({
   action: 'createReconciliation',
   payload: {
    ...payload,
    anchorTransactionId: await resolveTransactionId(payload.anchorTransactionId),
    lockedTransactionIds: await resolveTransactionIds(payload.lockedTransactionIds),
   },
  }),
 // Re-points an existing ✓ at the balance now standing above it, after a drag moved a row
 // across that line and the user accepted the stated old → new change.
 updateReconciliation: async (payload: { id: number; balance: number; lockedTransactionIds: number[] }) =>
  request<{ ok: true }>({ action: 'updateReconciliation', payload: { ...payload, lockedTransactionIds: await resolveTransactionIds(payload.lockedTransactionIds) } }),
 deleteReconciliation: (id: number) => request<{ ok: true }>({ action: 'deleteReconciliation', payload: id }),
 listIgnoredAnomalies: () => request<unknown[]>({ action: 'listIgnoredAnomalies' }),
 createIgnoredAnomaly: async (payload: { transactionId: number } & Record<string, unknown>) =>
  request<{ id: number | null }>({ action: 'createIgnoredAnomaly', payload: { ...payload, transactionId: await resolveTransactionId(payload.transactionId) } }),
 deleteIgnoredAnomaly: (id: number) => request<{ ok: true }>({ action: 'deleteIgnoredAnomaly', payload: id }),
 listHarvestRates: () => request<unknown[]>({ action: 'listHarvestRates' }),
 saveHarvestRate: (payload: unknown) => request<{ ok: true; deleted?: boolean; row?: unknown }>({ action: 'saveHarvestRate', payload }),
 listWriteOffMargins: () => request<WriteOffMargin[]>({ action: 'listWriteOffMargins' }),
 saveWriteOffMargin: (payload: { currencyId: number; threshold: number }) =>
  request<{ ok: true; deleted?: boolean; row?: WriteOffMargin }>({ action: 'saveWriteOffMargin', payload }),
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
 bulkImportTransactions: (payload: { transactions: unknown[] }) => request<{ createdTransactions: number }>({ action: 'bulkImportTransactions', payload }),
 getBackupInfo: () => request<BackupInfo>({ action: 'getBackupInfo' }),
 // Every collection the workspace snapshot needs, in ONE round-trip (see route.ts's
 // getWorkspaceSnapshot case). Replaces the ten parallel POSTs useWorkspaceData used to fire,
 // each of which independently re-decoded the session, re-resolved the workspace role and
 // re-checked the schema before running its query.
 // `silent` for the reconciling refetch that follows an optimistic save — the user has already
 // seen the result and is typing the next entry; a cold load passes nothing and stays loud.
 getWorkspaceSnapshot: (opts?: { silent?: boolean }) =>
  request<{
   organizations: unknown[];
   clients: unknown[];
   currencies: unknown[];
   transactions: unknown[];
   clientAccounts: unknown[];
   reconciliations: unknown[];
   ignoredAnomalies: unknown[];
   harvestRates: unknown[];
   writeOffMargins: unknown[];
   backup: BackupInfo | null;
  }>({ action: 'getWorkspaceSnapshot', silent: opts?.silent }),
 recordBackup: (device: string) => request<BackupInfo>({ action: 'recordBackup', payload: { device } }),
 getWorkspaceSettings: () => request<WorkspaceSharedSettings>({ action: 'getWorkspaceSettings' }),
 saveWorkspaceSettings: (payload: { sharedEnabled?: boolean; settings?: Record<string, string> }) =>
  request<WorkspaceSharedSettings>({ action: 'saveWorkspaceSettings', payload }),
 saveWorkspacePastEditLock: (enabled: boolean) => request<{ lockPastEditsEnabled: boolean }>({ action: 'saveWorkspacePastEditLock', payload: enabled }),
 saveTreasuryEnabled: (enabled: boolean) => request<{ treasuryEnabled: boolean }>({ action: 'saveTreasuryEnabled', payload: enabled }),
 saveReviewEngineSettings: (settings: ReviewEngineSettings) => request<{ reviewEngine: unknown }>({ action: 'saveReviewEngineSettings', payload: settings }),
 getUserTableSettings: () => request<Record<string, string>>({ action: 'getUserTableSettings' }),
 saveUserTableSettings: (settings: Record<string, string>) => request<{ ok: true }>({ action: 'saveUserTableSettings', payload: settings }),
};

// Workspace-wide shared UI settings. `settings` mirrors the relevant localStorage
// keys (ledger/transaction table preferences) so the snapshot is layout-agnostic.
export type WorkspaceSharedSettings = {
 sharedEnabled: boolean;
 settings: Record<string, string>;
 version: number;
 lockPastEditsEnabled: boolean;
 treasuryEnabled: boolean;
 // Raw Second Accountant configuration as stored. Deliberately untyped here: the server keeps
 // it opaque, and resolveReviewSettings is the single place that gives it a shape, filling in
 // and clamping whatever an older version (or a hand-edited row) left behind.
 reviewEngine: unknown;
};

export type BackupInfo = {
 lastBackupAt: string | null;
 lastBackupDevice: string | null;
};

/**
 * One recorded change to a transaction. `snapshot` is the full DB row (raw snake_case column
 * names) as it stood BEFORE this change — so an 'update' entry shows the superseded values,
 * and a 'delete' entry is the last surviving copy of the row.
 */
export type TransactionHistoryEntry = {
 id: number;
 action: 'update' | 'delete';
 changedBy: string | null;
 changedAt: string;
 snapshot: Record<string, unknown>;
};

export type TransactionHistoryResponse = {
 // null once the transaction itself has been deleted — its history outlives it.
 current: {
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string | null;
 } | null;
 history: TransactionHistoryEntry[];
 // id -> person, for whichever ids could still be resolved. An id absent from this map
 // belongs to a deleted login and must render as unknown, never as a guessed name.
 users: Record<string, { name: string; email: string }>;
};

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

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
