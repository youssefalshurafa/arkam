import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const db = require('@/server/db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');
import { computeClientLedgers } from '@/features/ledger/utils/ledgerBalances';
import type { ClientAccount, Transaction } from '@/shared/types';

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
 'listReconciliations',
 'listIgnoredAnomalies',
 'listHarvestRates',
 // Per-currency write-off margins: readable by every role, same as listHarvestRates —
 // it drives whether the Clients page's write-off button shows, not a permission itself.
 'listWriteOffMargins',
 'listSystemClients',
 // Treasury's balance summary, per currency — readable by every role including a `member`
 // (see getTreasuryBalance below), unlike listSystemClients/listAllClientAccounts/
 // listTransactions, which strip Treasury's own activity out of a member's view.
 'getTreasuryBalance',
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
 'ensureTreasuryAndCashboxes',
 'ensureSystemAccount',
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
 'setTransactionArchiveHidden',
 'deleteTransaction',
 'deleteTransactionsBulk',
 'deleteAllTransactions',
 'createReconciliation',
 'deleteReconciliation',
 'setReconciliationLockedRefIds',
 'createIgnoredAnomaly',
 'deleteIgnoredAnomaly',
 'saveHarvestRate',
 // Write-off margin: owner OR admin (gated further below), same tier as Treasury's toggle.
 'saveWriteOffMargin',
 'importWorkspaceData',
 'bulkImportTransactions',
 // Shared workspace UI settings: owner-only (gated further below).
 'saveWorkspaceSettings',
 // Past-edit lock toggle: owner OR admin (gated further below).
 'saveWorkspacePastEditLock',
 // Treasury & Cashbox nav visibility toggle: owner OR admin (gated further below).
 'saveTreasuryEnabled',
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

// The requesting client's own local "today" (yyyy-mm-dd), sent via the x-client-date header
// (see accountingApi.ts's request()). Used by db.js's past-edit-lock check instead of the
// server's own clock — createdAt is treated as the user's naive local wall-clock time
// everywhere else in this app (see shared/utils/date.ts), so the lock boundary must mean the
// same "today" or it would be off by hours for a user outside the server's timezone.
function createAppLike(workspaceId: string, todayKey: string | null, userId: string, role: string) {
 return {
  workspaceId,
  todayKey,
  userId,
  role,
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

  // The past-edit lock toggle is settable by the owner or an admin, but not a plain member/viewer.
  if (action === 'saveWorkspacePastEditLock' && role !== 'owner' && role !== 'admin') {
   return NextResponse.json({ error: 'Only the workspace owner or an admin can change this setting.' }, { status: 403 });
  }

  // The Treasury & Cashbox nav toggle is settable by the owner or an admin, same as the
  // past-edit lock. Opening-balance edits are a stricter, owner-only guard enforced inside
  // db.js's updateClientAccountStartingBalance itself (it needs to look up whether the target
  // account is a Treasury/Cashbox account, which this route can't cheaply check up front).
  if (action === 'saveTreasuryEnabled' && role !== 'owner' && role !== 'admin') {
   return NextResponse.json({ error: 'Only the workspace owner or an admin can change this setting.' }, { status: 403 });
  }

  // Write-off margins are workspace-wide financial config, same tier as the Treasury toggle.
  if (action === 'saveWriteOffMargin' && role !== 'owner' && role !== 'admin') {
   return NextResponse.json({ error: 'Only the workspace owner or an admin can change this setting.' }, { status: 403 });
  }

  const clientDateHeader = request.headers.get('x-client-date');
  const todayKey = clientDateHeader && /^\d{4}-\d{2}-\d{2}$/.test(clientDateHeader) ? clientDateHeader : null;
  const appLike = createAppLike(workspaceId, todayKey, userId, role);

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
   case 'listSystemClients':
    return NextResponse.json(await db.listSystemClients(appLike));
   case 'getTreasuryBalance': {
    // Deliberately summary-only: computes via the same computeClientLedgers math the
    // Treasury UI itself uses (avoids re-deriving the charge/commission/exchange-rate
    // formula, which has twice been a source of sign bugs in this feature), but returns
    // only a per-currency balance number — never the underlying ledger entries — so a
    // `member` (who can't otherwise see Treasury's activity) can safely call this.
    const { clientAccounts, transactions } = (await db.getTreasuryLedgerData(appLike)) as {
     clientAccounts: ClientAccount[];
     transactions: Transaction[];
    };
    const treasuryClientId = clientAccounts[0]?.clientId ?? null;
    const ledgers =
     treasuryClientId == null
      ? []
      : computeClientLedgers({
         selectedClientForLedger: { id: treasuryClientId },
         section: 'treasury',
         pdfExportModal: null,
         enabled: true,
         clientAccounts,
         transactions,
         reconciliations: [],
         clientAccountMap: new Map(),
         currencyMap: new Map(),
        });
    return NextResponse.json(
     ledgers.map((ledger) => ({
      currencyId: clientAccounts.find((a) => a.id === ledger.accountId)?.currencyId ?? null,
      currencyCode: ledger.currencyCode,
      currencyName: ledger.currencyName,
      currencySymbol: ledger.currencySymbol,
      // Same render-time negation as SystemAccountLedgerTable.tsx: computeClientLedgers'
      // Sender-increases/Receiver-decreases math is backwards for a cash/asset account.
      balance: -ledger.currentBalance,
     })),
    );
   }
   case 'ensureTreasuryAndCashboxes': {
    const members = await authDb.listWorkspaceMembers({ workspaceId, userId });
    return NextResponse.json(await db.ensureTreasuryAndCashboxes(appLike, { members }));
   }
   case 'ensureSystemAccount':
    return NextResponse.json(await db.ensureSystemAccount(appLike, payload));
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
   case 'createTransaction': {
    // The real DB id, returned immediately so the client's optimistic row can carry it
    // instead of a placeholder — see useTransactionActions.ts's onTransactionSubmit.
    const created = await db.createTransaction(appLike, payload);
    return NextResponse.json({ ok: true, id: created.id });
   }
   case 'updateTransaction':
    await db.updateTransaction(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'setTransactionArchiveHidden':
    await db.setTransactionArchiveHidden(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'deleteTransaction':
    await db.deleteTransaction(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'deleteTransactionsBulk':
    return NextResponse.json(await db.deleteTransactionsBulk(appLike, payload));
   case 'deleteAllTransactions':
    await db.deleteAllTransactions(appLike);
    return NextResponse.json({ ok: true });
   case 'listReconciliations':
    return NextResponse.json(await db.listReconciliations(appLike));
   case 'createReconciliation':
    return NextResponse.json(await db.createReconciliation(appLike, payload));
   case 'deleteReconciliation':
    await db.deleteReconciliation(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'setReconciliationLockedRefIds':
    await db.setReconciliationLockedRefIds(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'listIgnoredAnomalies':
    return NextResponse.json(await db.listIgnoredAnomalies(appLike));
   case 'createIgnoredAnomaly':
    return NextResponse.json(await db.createIgnoredAnomaly(appLike, payload));
   case 'deleteIgnoredAnomaly':
    await db.deleteIgnoredAnomaly(appLike, payload);
    return NextResponse.json({ ok: true });
   case 'listHarvestRates':
    return NextResponse.json(await db.listHarvestRates(appLike));
   case 'saveHarvestRate':
    return NextResponse.json(await db.saveHarvestRate(appLike, payload));
   case 'listWriteOffMargins':
    return NextResponse.json(await db.listWriteOffMargins(appLike));
   case 'saveWriteOffMargin':
    return NextResponse.json(await db.saveWriteOffMargin(appLike, payload));
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
   case 'saveWorkspacePastEditLock':
    return NextResponse.json(await db.saveWorkspacePastEditLock(appLike, payload));
   case 'saveTreasuryEnabled':
    return NextResponse.json(await db.saveTreasuryEnabled(appLike, payload));
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
