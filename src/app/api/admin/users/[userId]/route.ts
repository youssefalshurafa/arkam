import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth-options';
import { isSuperAdmin, isAdminPanelUnlocked } from '@/server/permissions';
import { getAppBaseUrl } from '@/server/app-url';
import { errorResponse, parseBody } from '@/server/http';
import { adminUserActionSchema, adminUserPatchSchema } from '@/server/auth-schemas';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const db = require('@/server/db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mfa = require('@/server/mfa');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const security = require('@/server/security');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = {
 params: Promise<{ userId: string }>;
};

// Per-user detail page for the super admin: profile/subscription info plus usage stats
// (organizations/clients/transactions) pulled from each of the user's workspace schemas,
// so growth (how much the app is actually being used) is visible per account.
export async function GET(request: NextRequest, context: Context) {
 const session = await getServerSession(authOptions);

 if (!isSuperAdmin(session?.user?.id) || !isAdminPanelUnlocked(request, session?.user?.id) || !session?.user?.mfaEnabled) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 }

 const { userId } = await context.params;

 const user = await authDb.getUserDetailForAdmin(userId);
 if (!user) {
  return NextResponse.json({ error: 'User not found.' }, { status: 404 });
 }

 type Workspace = { id: string; name: string; slug: string; role: string; isOwner: boolean; createdAt: string };

 const workspacesWithStats = await Promise.all(
  (user.workspaces as Workspace[]).map(async (workspace) => {
   const stats = await db.getWorkspaceStats({ workspaceId: workspace.id });
   return { ...workspace, stats };
  }),
 );

 const totals = workspacesWithStats.reduce(
  (acc, ws) => ({
   organizationCount: acc.organizationCount + ws.stats.organizationCount,
   clientCount: acc.clientCount + ws.stats.clientCount,
   accountCount: acc.accountCount + ws.stats.accountCount,
   transactionCount: acc.transactionCount + ws.stats.transactionCount,
   lastTransactionAt:
    !acc.lastTransactionAt || (ws.stats.lastTransactionAt && ws.stats.lastTransactionAt > acc.lastTransactionAt) ? ws.stats.lastTransactionAt : acc.lastTransactionAt,
  }),
  { organizationCount: 0, clientCount: 0, accountCount: 0, transactionCount: 0, lastTransactionAt: null as string | null },
 );

 // Surface a pending renewal/signup request right on this page, so the admin doesn't
 // have to cross-reference the separate Access Requests tab to know one exists.
 const accessRequests = await authDb.listAccessRequests({ userId, status: 'pending' });
 const pendingAccessRequest = accessRequests[0] || null;

 // Behavioral usage: logins, app opens, and per-section visit counts.
 const activity = await authDb.getUserActivitySummary(userId);

 return NextResponse.json({
  user: { ...user, workspaces: undefined },
  workspaces: workspacesWithStats,
  totals,
  pendingAccessRequest,
  activity,
 });
}

// Two actions, both returning a one-time /setup/[token] link for the admin to hand over:
//   action 'reset_password' (default) — clears the password and signs the user out everywhere.
//     The recovery path for username-only accounts the /forgot-password email can't reach.
//   action 'setup_link' — mints a fresh link for an account that has no password yet (its
//     first link expired or was lost); the account itself is untouched.
//   action 'reset_mfa' — turns off two-factor for a user who lost their authenticator and
//     their backup codes (after the admin verified them out-of-band). Signs them out too.
export async function POST(request: NextRequest, context: Context) {
 const session = await getServerSession(authOptions);

 if (!isSuperAdmin(session?.user?.id) || !isAdminPanelUnlocked(request, session?.user?.id) || !session?.user?.mfaEnabled) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 }

 const { userId } = await context.params;

 const parsed = await parseBody(request, adminUserActionSchema);
 if (parsed.response) return parsed.response;
 const { action } = parsed.data;

 // Prevent the admin from clearing their own password / 2FA and locking themselves out.
 if (session?.user?.id === userId && action !== 'setup_link') {
  return NextResponse.json({ error: 'You cannot reset your own password here.' }, { status: 400 });
 }

 try {
  if (action === 'reset_mfa') {
   await mfa.disableMfa({ userId });
   await authDb.bumpSessionVersion(userId);
   await authDb.logAdminAction({ actorEmail: session?.user?.email, action: 'reset_mfa', targetUserId: userId });
   await security.logSecurityEvent({ userId, event: 'mfa_disabled', headers: request.headers, meta: { by: 'admin' } });
   return NextResponse.json({ ok: true });
  }
  if (action === 'setup_link') {
   const { setupToken } = await authDb.createSetupToken(userId);
   await authDb.logAdminAction({ actorEmail: session?.user?.email, action: 'setup_link', targetUserId: userId });
   return NextResponse.json({ ok: true, setupUrl: `${getAppBaseUrl()}/setup/${setupToken}` });
  }

  const { email, setupToken } = await authDb.clearUserPassword({ userId });
  await authDb.logAdminAction({ actorEmail: session?.user?.email, action: 'reset_password', targetUserId: userId, targetEmail: email });
  return NextResponse.json({ ok: true, email, setupUrl: `${getAppBaseUrl()}/setup/${setupToken}` });
 } catch (error) {
  return errorResponse(error, 'Failed to reset password.', 400, 'admin/users/[userId]');
 }
}

// Updates fields on the user row that don't need their own dedicated flow (unlike subscription
// days / password reset above, which have side effects worth keeping separate). Each field is
// optional in the request body — the client sends only the one it's changing.
export async function PATCH(request: NextRequest, context: Context) {
 const session = await getServerSession(authOptions);

 if (!isSuperAdmin(session?.user?.id) || !isAdminPanelUnlocked(request, session?.user?.id) || !session?.user?.mfaEnabled) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 }

 const { userId } = await context.params;
 const parsedPatch = await parseBody(request, adminUserPatchSchema);
 if (parsedPatch.response) return parsedPatch.response;
 const { phone, aiEnabled } = parsedPatch.data;

 try {
  if (typeof phone === 'string') {
   await authDb.updateUserContact({ userId, phone });
  }
  if (typeof aiEnabled === 'boolean') {
   await authDb.updateUserAiEnabled({ userId, aiEnabled });
  }
  if (typeof phone !== 'string' && typeof aiEnabled !== 'boolean') {
   return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  }
  await authDb.logAdminAction({
   actorEmail: session?.user?.email,
   action: typeof aiEnabled === 'boolean' ? 'set_ai_access' : 'update_contact',
   targetUserId: userId,
   meta: typeof aiEnabled === 'boolean' ? { aiEnabled } : undefined,
  });
  return NextResponse.json({
   ok: true,
   ...(typeof phone === 'string' ? { phone: phone.trim() } : {}),
   ...(typeof aiEnabled === 'boolean' ? { aiEnabled } : {}),
  });
 } catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to update user.';
  return NextResponse.json({ error: message }, { status: 400 });
 }
}
