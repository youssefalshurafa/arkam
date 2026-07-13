import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth-options';
import { isSuperAdmin, isAdminPanelUnlocked } from '@/server/permissions';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const db = require('@/server/db');

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

 if (!isSuperAdmin(session?.user?.email) || !isAdminPanelUnlocked(request)) {
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
   adjustmentCount: acc.adjustmentCount + ws.stats.adjustmentCount,
   lastTransactionAt:
    !acc.lastTransactionAt || (ws.stats.lastTransactionAt && ws.stats.lastTransactionAt > acc.lastTransactionAt) ? ws.stats.lastTransactionAt : acc.lastTransactionAt,
  }),
  { organizationCount: 0, clientCount: 0, accountCount: 0, transactionCount: 0, adjustmentCount: 0, lastTransactionAt: null as string | null },
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

// Super-admin resets a user's password by clearing it, so the user can set a new one from the
// sign-in page's "Set your password" link. This is the recovery path for username-only accounts
// that the /forgot-password email flow can't reach.
export async function POST(request: NextRequest, context: Context) {
 const session = await getServerSession(authOptions);

 if (!isSuperAdmin(session?.user?.email) || !isAdminPanelUnlocked(request)) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 }

 const { userId } = await context.params;

 // Prevent the admin from clearing their own password and locking themselves out mid-session.
 if (session?.user?.id === userId) {
  return NextResponse.json({ error: 'You cannot reset your own password here.' }, { status: 400 });
 }

 try {
  const { email } = await authDb.clearUserPassword({ userId });
  return NextResponse.json({ ok: true, email });
 } catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to reset password.';
  return NextResponse.json({ error: message }, { status: 400 });
 }
}

// Updates the user's trusted contact (phone/WhatsApp) — the number the super admin calls to
// verify identity out-of-band before approving a password reset request.
export async function PATCH(request: NextRequest, context: Context) {
 const session = await getServerSession(authOptions);

 if (!isSuperAdmin(session?.user?.email) || !isAdminPanelUnlocked(request)) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 }

 const { userId } = await context.params;
 const { phone } = (await request.json()) as { phone?: string };

 if (typeof phone !== 'string') {
  return NextResponse.json({ error: 'phone is required.' }, { status: 400 });
 }

 try {
  await authDb.updateUserContact({ userId, phone });
  return NextResponse.json({ ok: true, phone: phone.trim() });
 } catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to update contact.';
  return NextResponse.json({ error: message }, { status: 400 });
 }
}
