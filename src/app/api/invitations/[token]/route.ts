import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth-options';
import { errorResponse, tooManyRequests } from '@/server/http';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const security = require('@/server/security');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = {
 params: Promise<{ token: string }>;
};

// Public: what the /invite/[token] page shows before the invitee decides.
export async function GET(request: NextRequest, context: Context) {
 const budget = await security.hit('tokenIp', security.getClientIp(request.headers));
 if (!budget.allowed) return tooManyRequests(budget.retryAfterSeconds);
 const { token } = await context.params;
 if (!token || token.length > 256) return NextResponse.json({ status: 'invalid' });
 const invitation = await authDb.getInvitationByToken(token);
 // Never expose the workspace id to an unauthenticated caller.
 return NextResponse.json({ ...invitation, workspaceId: undefined });
}

// Signed-in user accepts the invitation and joins the workspace.
export async function POST(request: NextRequest, context: Context) {
 const session = await getServerSession(authOptions);
 const userId = session?.user?.id;
 if (!userId) return NextResponse.json({ error: 'Please sign in to accept this invitation.' }, { status: 401 });
 const { token } = await context.params;

 try {
  const result = await authDb.acceptWorkspaceInvitation({ rawToken: token, userId });
  await security.logSecurityEvent({ userId, event: 'invite_accepted', headers: request.headers, meta: { workspaceId: result.workspaceId } });
  return NextResponse.json({ ok: true, workspaceId: result.workspaceId });
 } catch (error) {
  return errorResponse(error, 'Failed to accept the invitation.', 400, 'invitations');
 }
}
