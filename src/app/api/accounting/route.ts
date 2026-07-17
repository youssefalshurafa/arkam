import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const db = require('@/server/db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const readOnlyActions = new Set([
 'getDbInfo',
 'listOrganizations',
 'listClients',
 'listAllClientAccounts',
 'listClientAccounts',
 'listCurrencies',
 'listTransactions',
 'listClientAdjustments',
 'listReconciliations',
 'listHarvestRates',
 'exportWorkspaceData',
 // Backup marker: reads + the post-download stamp. Allowed for anyone who can
 // export (viewers included), so it stays out of the viewer-blocked writeActions.
 'getBackupInfo',
 'recordBackup',
 // Shared workspace UI settings: readable by anyone in the workspace.
 'getWorkspaceSettings',
 // Personal table-layout settings: each user reads/writes only their own row (scoped
 // by their own user id server-side), so both directions are safe for any role,
 // including viewers — it's a UI preference, not workspace financial data.
 'getUserTableSettings',
 'saveUserTableSettings',
]);

const writeActions = new Set([
 'setDbDirectory',
 'createOrganization',
 'updateOrganization',
 'deleteOrganization',
 'createClient',
 'updateClient',
 'deleteClient',
 'deleteAllClients',
 'createClientAccount',
 'updateClientAccountStartingBalance',
 'updateClientAccountNote',
 'updateClientAccount',
 'deleteClientAccount',
 'moveAccountTransactions',
 'createCurrency',
 'updateCurrency',
 'deleteCurrency',
 'deleteAllCurrencies',
 'reseedCurrencies',
 'enableCurrency',
 'disableCurrency',
 'setMainCurrency',
 'createTransaction',
 'updateTransaction',
 'deleteTransaction',
 'deleteTransactionsBulk',
 'deleteAllTransactions',
 'createClientAdjustment',
 'updateClientAdjustment',
 'deleteClientAdjustment',
 'createReconciliation',
 'deleteReconciliation',
 'saveHarvestRate',
 'importWorkspaceData',
 'bulkImportTransactions',
 // Shared workspace UI settings: owner-only (gated further below).
 'saveWorkspaceSettings',
]);

type Body = {
 action?: string;
 payload?: unknown;
};

type AuthContext = {
 userId: string;
 defaultWorkspaceId: string | null;
};

async function resolveAuthContext(request: NextRequest): Promise<AuthContext | null> {
 const cookieHeader = request.cookies
  .getAll()
  .map((cookie) => `${cookie.name}=${cookie.value}`)
  .join('; ');

 if (!cookieHeader) {
  return null;
 }

 try {
  const sessionResponse = await fetch(new URL('/api/auth/session', request.nextUrl.origin), {
   method: 'GET',
   headers: {
    cookie: cookieHeader,
   },
   cache: 'no-store',
  });

  if (!sessionResponse.ok) {
   return null;
  }

  const sessionPayload = (await sessionResponse.json()) as {
   user?: {
    id?: string;
    defaultWorkspaceId?: string | null;
   };
  };

  const userId = sessionPayload?.user?.id;
  if (!userId) {
   return null;
  }

  return {
   userId,
   defaultWorkspaceId: sessionPayload.user?.defaultWorkspaceId || null,
  };
 } catch {
  return null;
 }
}

function getWorkspaceId(sessionWorkspaceId: string | null | undefined, headerWorkspaceId: string | null): string | null {
 if (headerWorkspaceId?.trim()) {
  return headerWorkspaceId.trim();
 }

 if (sessionWorkspaceId?.trim()) {
  return sessionWorkspaceId.trim();
 }

 return null;
}

function createAppLike(workspaceId: string) {
 return {
  workspaceId,
  getPath(name: string) {
   const root = process.cwd();

   if (name === 'userData') {
    return path.join(root, 'database');
   }

   if (name === 'documents' || name === 'temp') {
    return root;
   }

   return root;
  },
 };
}

export async function POST(request: NextRequest) {
 try {
  const authContext = await resolveAuthContext(request);
  const userId = authContext?.userId;

  if (!userId) {
   return NextResponse.json({ error: 'Unauthorized. Please sign in.' }, { status: 401 });
  }

  const body = (await request.json()) as Body;
  const action = body.action;
  const payload = body.payload as never;

  if (!action) {
   return NextResponse.json({ error: 'Missing action.' }, { status: 400 });
  }

  const workspaceId = getWorkspaceId(authContext.defaultWorkspaceId, request.headers.get('x-workspace-id'));
  if (!workspaceId) {
   return NextResponse.json({ error: 'No workspace selected.' }, { status: 400 });
  }

  const role = await authDb.getWorkspaceRole(userId, workspaceId);
  if (!role) {
   return NextResponse.json({ error: 'Access denied for this workspace.' }, { status: 403 });
  }

  if (!readOnlyActions.has(action) && !writeActions.has(action)) {
   return NextResponse.json({ error: `Unsupported action: ${action}` }, { status: 400 });
  }

  if (writeActions.has(action) && role === 'viewer') {
   return NextResponse.json({ error: 'Viewers cannot modify workspace data.' }, { status: 403 });
  }

  // Only the workspace owner may change the shared UI settings (toggle or push).
  if (action === 'saveWorkspaceSettings' && role !== 'owner') {
   return NextResponse.json({ error: 'Only the workspace owner can change shared settings.' }, { status: 403 });
  }

  const appLike = createAppLike(workspaceId);

  switch (action) {
   case 'getDbInfo':
    return NextResponse.json(await db.getDbInfo(appLike));
   case 'setDbDirectory':
    return NextResponse.json(await db.setDbDirectory(appLike, payload));
   case 'listOrganizations':
    return NextResponse.json(await db.listOrganizations(appLike));
   case 'createOrganization':
    await db.createOrganization(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'updateOrganization':
    await db.updateOrganization(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'deleteOrganization':
    await db.deleteOrganization(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'listClients':
    return NextResponse.json(await db.listClients(appLike));
   case 'createClient':
    return NextResponse.json({ ok: true, clientId: await db.createClient(appLike, payload) });
   case 'updateClient':
    await db.updateClient(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'deleteClient':
    await db.deleteClient(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'deleteAllClients':
    await db.deleteAllClients(appLike);
    return NextResponse.json({ ok: true });
   case 'listAllClientAccounts':
    return NextResponse.json(await db.listAllClientAccounts(appLike));
   case 'listClientAccounts':
    return NextResponse.json(await db.listClientAccounts(appLike, payload));
   case 'createClientAccount':
    await db.createClientAccount(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'updateClientAccountStartingBalance':
    await db.updateClientAccountStartingBalance(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'updateClientAccountNote':
    await db.updateClientAccountNote(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'updateClientAccount':
    await db.updateClientAccount(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'deleteClientAccount':
    await db.deleteClientAccount(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'moveAccountTransactions':
    return NextResponse.json(await db.moveAccountTransactions(appLike, payload));
   case 'listCurrencies':
    return NextResponse.json(await db.listCurrencies(appLike));
   case 'createCurrency':
    await db.createCurrency(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'updateCurrency':
    await db.updateCurrency(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'deleteCurrency':
    await db.deleteCurrency(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'deleteAllCurrencies':
    await db.deleteAllCurrencies(appLike);
    return NextResponse.json({ ok: true });
   case 'reseedCurrencies':
    await db.reseedCurrencies(appLike);
    return NextResponse.json({ ok: true });
   case 'enableCurrency':
    await db.enableCurrency(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'disableCurrency':
    await db.disableCurrency(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'setMainCurrency':
    await db.setMainCurrency(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'listTransactions':
    return NextResponse.json(await db.listTransactions(appLike));
   case 'createTransaction':
    await db.createTransaction(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'updateTransaction':
    await db.updateTransaction(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'deleteTransaction':
    await db.deleteTransaction(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'deleteTransactionsBulk':
    return NextResponse.json(await db.deleteTransactionsBulk(appLike, payload));
   case 'deleteAllTransactions':
    await db.deleteAllTransactions(appLike);
    return NextResponse.json({ ok: true });
   case 'listClientAdjustments':
    return NextResponse.json(await db.listClientAdjustments(appLike));
   case 'createClientAdjustment':
    return NextResponse.json(await db.createClientAdjustment(appLike, payload));
   case 'updateClientAdjustment':
    await db.updateClientAdjustment(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'deleteClientAdjustment':
    await db.deleteClientAdjustment(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'listReconciliations':
    return NextResponse.json(await db.listReconciliations(appLike));
   case 'createReconciliation':
    return NextResponse.json(await db.createReconciliation(appLike, payload));
   case 'deleteReconciliation':
    await db.deleteReconciliation(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'listHarvestRates':
    return NextResponse.json(await db.listHarvestRates(appLike));
   case 'saveHarvestRate':
    return NextResponse.json(await db.saveHarvestRate(appLike, payload));
   case 'exportWorkspaceData':
    return NextResponse.json(await db.exportWorkspaceData(appLike));
   case 'importWorkspaceData':
    return NextResponse.json(await db.importWorkspaceData(appLike, payload));
   case 'bulkImportTransactions':
    return NextResponse.json(await db.bulkImportTransactions(appLike, payload));
   case 'getWorkspaceSettings':
    return NextResponse.json(await db.getWorkspaceSettings(appLike));
   case 'saveWorkspaceSettings':
    return NextResponse.json(await db.saveWorkspaceSettings(appLike, payload));
   case 'getUserTableSettings':
    return NextResponse.json(await db.getUserTableSettings(appLike, userId));
   case 'saveUserTableSettings':
    return NextResponse.json(await db.saveUserTableSettings(appLike, userId, payload));
   case 'getBackupInfo':
    return NextResponse.json(await authDb.getWorkspaceBackupInfo(workspaceId));
   case 'recordBackup':
    return NextResponse.json(await authDb.recordWorkspaceBackup(workspaceId, (payload as { device?: string } | null)?.device));
   default:
    return NextResponse.json({ error: `Unsupported action: ${action}` }, { status: 400 });
  }
 } catch (error) {
  const message = error instanceof Error ? error.message : 'Unexpected server error.';
  return NextResponse.json({ error: message }, { status: 500 });
 }
}
