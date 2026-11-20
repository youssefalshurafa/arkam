import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/server/auth-options';
import { getAppBaseUrl } from '@/server/app-url';
import { errorResponse, parseBody } from '@/server/http';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const security = require('@/server/security');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = {
 params: Promise<{ workspaceId: string }>;
};

const schema = z.object({ targetUserId: z.string().trim().min(1).max(64) });

// One-time setup link for a legacy teammate who never set a password (created by the old
// invite flow). Restricted server-side to accounts that belong only to this workspace.
export async function POST(request: NextRequest, context: Context) {
 const session = await getServerSession(authOptions);
 const userId = session?.user?.id;
 if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 const { workspaceId } = await context.params;

 const parsed = await parseBody(request, schema);
 if (parsed.response) return parsed.response;

 try {
  const { setupToken } = await authDb.createMemberSetupLink({ workspaceId, targetUserId: parsed.data.targetUserId, actorUserId: userId });
  await security.logSecurityEvent({ userId, event: 'member_setup_link', headers: request.headers, meta: { workspaceId, targetUserId: parsed.data.targetUserId } });
  return NextResponse.json({ ok: true, setupUrl: `${getAppBaseUrl()}/setup/${setupToken}` });
 } catch (error) {
  return errorResponse(error, 'Failed to create the setup link.', 400, 'workspaces/members/setup-link');
 }
}
