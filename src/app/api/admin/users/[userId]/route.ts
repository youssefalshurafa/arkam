import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth-options';
import { isSuperAdmin } from '@/server/permissions';
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
export async function GET(_request: Request, context: Context) {
 const session = await getServerSession(authOptions);

 if (!isSuperAdmin(session?.user?.email)) {
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

 return NextResponse.json({
  user: { ...user, workspaces: undefined },
  workspaces: workspacesWithStats,
  totals,
 });
}
