import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import { getServerSession } from 'next-auth';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const db = require('@/server/db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');
import { authOptions } from '@/server/auth-options';
import { computeClientLedgers } from '@/features/ledger/utils/ledgerBalances';
import { validateActionPayload } from './schemas';
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
 // Audit trail for a single transaction. Read-only and no stricter than listTransactions —
 // anyone who can already see a transaction can see who touched it.
 'listTransactionHistory',
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
 // The whole workspace in one round-trip — see the case in the switch below for why.
 'getWorkspaceSnapshot',
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
 // Second Accountant (entry-review engine) configuration: owner OR admin (gated further below).
 'saveReviewEngineSettings',
]);

/**
 * The subset of writeActions that destroys or wholesale replaces financial history, restricted
 * to owner/admin. Everything else in writeActions stays open to a `member` — that is the
 * day-to-day entry surface and members are meant to use it.
 *
 * These are different in kind from the settings gates further below. Each one either removes
 * rows that no per-row guard ever sees, or cascades far beyond the id it was handed:
 *   * deleteAllTransactions / deleteAllClients / deleteAllCurrencies — wipe the workspace.
 *   * importWorkspaceData — deletes all nine tables INCLUDING transaction_history, then
 *     restores whatever the caller uploaded; both a wipe and a history-forgery surface.
 *   * deleteCurrency — cascades currencies -> client_accounts -> transactions, so a single
 *     statement is enough to destroy the ledger.
 *   * deleteClient / deleteClientAccount — cascade into every transaction on either side,
 *     including the counterparty's entries in someone else's ledger, and leave no
 *     transaction_history trail (see recordTransactionHistory's exclusion list in db.js).
 *   * moveAccountTransactions — re-points every transaction between two accounts at once.
 *
 * db.js keeps its own per-row Treasury/Cashbox guards (assertMemberCanWrite*); this gate is
 * the coarser "a member has no business calling this at all" layer above them.
 */
const ownerAdminActions = new Set([
 'deleteAllTransactions',
 'deleteAllClients',
 'deleteAllCurrencies',
 'deleteCurrency',
 'deleteClient',
 'deleteClientAccount',
 'moveAccountTransactions',
 'importWorkspaceData',
]);

type Body = {
 action?: string;
 payload?: unknown;
};

type AuthContext = {
 userId: string;
 defaultWorkspaceId: string | null;
};

// Reads the session in-process. This used to fetch('/api/auth/session') back through the
// Next server on every call — a full extra HTTP round-trip per request, and this is the
// route every load and mutation in the app funnels through, so a single workspace load paid
// for ten of them. getServerSession decodes the same JWT directly and returns the same
// user.id / user.defaultWorkspaceId the session callback populates (see auth-options.ts),
// which is what every other route in this app already does.
async function resolveAuthContext(): Promise<AuthContext | null> {
 try {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  if (!userId) {
   return null;
  }

  return {
   userId,
   defaultWorkspaceId: session.user?.defaultWorkspaceId || null,
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

/**
 * True for errors raised by the Postgres driver rather than thrown deliberately by db.js.
 * node-postgres sets both `code` (SQLSTATE) and `severity` on every error it raises; a
 * hand-thrown `new Error('…')` has neither. See the catch block in POST for why this
 * distinction matters.
 */
function isDatabaseError(error: unknown): boolean {
 if (typeof error !== 'object' || error === null) return false;
 const candidate = error as { code?: unknown; severity?: unknown };
 return typeof candidate.code === 'string' && typeof candidate.severity === 'string';
}

export async function POST(request: NextRequest) {
 // Hoisted out of the try purely so the catch block can name the failing action when it
 // logs a database error.
 let currentAction: string | undefined;

 try {
  const authContext = await resolveAuthContext();
  const userId = authContext?.userId;

  if (!userId) {
   return NextResponse.json({ error: 'Unauthorized. Please sign in.' }, { status: 401 });
  }

  const body = (await request.json()) as Body;
  const action = body.action;
  const payload = body.payload as never;
  currentAction = action;

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

  // The Second Accountant configuration decides what every member is warned about, so it is
  // owner/admin business like the other workspace-wide toggles above.
  if (action === 'saveReviewEngineSettings' && role !== 'owner' && role !== 'admin') {
   return NextResponse.json({ error: 'Only the workspace owner or an admin can change this setting.' }, { status: 403 });
  }

  // Write-off margins are workspace-wide financial config, same tier as the Treasury toggle.
  if (action === 'saveWriteOffMargin' && role !== 'owner' && role !== 'admin') {
   return NextResponse.json({ error: 'Only the workspace owner or an admin can change this setting.' }, { status: 403 });
  }

  // Destroying or wholesale-replacing financial history is owner/admin business — see
  // ownerAdminActions for what qualifies and why. Before this gate the only role check on any
  // of them was the binary viewer block above, so a plain `member` could wipe the ledger,
  // cascade-delete a currency, or restore an uploaded backup over the whole workspace.
  if (ownerAdminActions.has(action) && role !== 'owner' && role !== 'admin') {
   return NextResponse.json({ error: 'Only the workspace owner or an admin can perform this action.' }, { status: 403 });
  }

  // Shape-check the payload for the actions that move money or mutate in bulk. Runs AFTER
  // the auth/role gates so a malformed payload can never reveal which actions exist to
  // someone who isn't allowed to call them. See schemas.ts — this is a gate only: the
  // ORIGINAL payload is what gets forwarded to db.js below, never zod's parsed output,
  // because zod strips unknown keys and would silently drop fields the client relies on.
  const validationError = validateActionPayload(action, payload);
  if (validationError) {
   return NextResponse.json({ error: `Invalid payload for ${action}. ${validationError}` }, { status: 400 });
  }

  const clientDateHeader = request.headers.get('x-client-date');
  const todayKey = clientDateHeader && /^\d{4}-\d{2}-\d{2}$/.test(clientDateHeader) ? clientDateHeader : null;
  const appLike = createAppLike(workspaceId, todayKey, userId, role);

  switch (action) {
   case 'getDbInfo':
    return NextResponse.json(await db.getDbInfo(appLike));
   case 'setDbDirectory':
    return NextResponse.json(await db.setDbDirectory(appLike, payload));
   // The entire workspace snapshot in a single round-trip.
   //
   // The client fetched these ten collections as ten separate POSTs to this very endpoint (see
   // useWorkspaceData), so one page load paid for ten session decodes, ten getWorkspaceRole
   // lookups, ten schema-ensure checks and ten pool checkouts — all of the per-request work,
   // multiplied by ten, for data that is always needed together and always invalidated together.
   // On a cold Neon compute it was worse than that: the ten arrived at once and serialised behind
   // the advisory lock that ensureWorkspaceSchema holds while it runs its DDL.
   //
   // The queries still run in parallel here; only the request overhead collapses. They are
   // independent reads, which is exactly what the client's own Promise.all already assumed.
   case 'getWorkspaceSnapshot': {
    const [organizations, clients, currencies, transactions, clientAccounts, reconciliations, ignoredAnomalies, harvestRates, writeOffMargins, backup] = await Promise.all([
     db.listOrganizations(appLike),
     db.listClients(appLike),
     db.listCurrencies(appLike),
     db.listTransactions(appLike),
     db.listAllClientAccounts(appLike),
     db.listReconciliations(appLike),
     db.listIgnoredAnomalies(appLike),
     db.listHarvestRates(appLike),
     db.listWriteOffMargins(appLike),
     authDb.getWorkspaceBackupInfo(workspaceId),
    ]);
    return NextResponse.json({ organizations, clients, currencies, transactions, clientAccounts, reconciliations, ignoredAnomalies, harvestRates, writeOffMargins, backup });
   }
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
   case 'listTransactionHistory': {
    const trail = (await db.listTransactionHistory(appLike, payload)) as {
     current: { createdBy: string | null; updatedBy: string | null } | null;
     history: { changedBy: string | null }[];
    };
    // Attribute the ids to people in one batched lookup. Users live in the shared `public`
    // schema, so db.js can't join to them from inside the workspace schema.
    const userIds = [trail.current?.createdBy, trail.current?.updatedBy, ...trail.history.map((entry) => entry.changedBy)].filter(
     (value): value is string => typeof value === 'string' && value.length > 0,
    );
    const users = await authDb.getUserDisplayNamesByIds(userIds);
    return NextResponse.json({ ...trail, users });
   }
   case 'listReconciliations':
    return NextResponse.json(await db.listReconciliations(appLike));
   case 'createReconciliation':
    return NextResponse.json(await db.createReconciliation(appLike, payload));
   case 'deleteReconciliation':
    await db.deleteReconciliation(appLike, payload);
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
   case 'saveReviewEngineSettings':
    return NextResponse.json(await db.saveReviewEngineSettings(appLike, payload));
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
  // db.js throws plain Errors carrying deliberate, user-facing text that the UI displays
  // verbatim ("At least one party (sender or receiver) is required.", the reconciliation-lock
  // and past-edit-lock messages, …), so those must pass through unchanged.
  //
  // A driver error is a different animal: node-postgres attaches `code` AND `severity` to
  // everything it raises, which a hand-thrown Error never has. Those messages name schemas,
  // columns, and constraints, so they get logged server-side and replaced with a generic
  // line. Discriminating on the error object rather than the message keeps every intentional
  // message intact while leaking nothing.
  if (isDatabaseError(error)) {
   console.error(`[api/accounting] database error on action "${currentAction ?? 'unknown'}"`, error);
   return NextResponse.json({ error: 'A database error occurred. Please try again, or contact support if it persists.' }, { status: 500 });
  }

  const message = error instanceof Error ? error.message : 'Unexpected server error.';
  return NextResponse.json({ error: message }, { status: 500 });
 }
}
