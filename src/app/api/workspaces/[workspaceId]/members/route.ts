import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth-options';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = {
 params: Promise<{ workspaceId: string }>;
};

export async function GET(_request: NextRequest, context: Context) {
 const session = await getServerSession(authOptions);
 const userId = session?.user?.id;

 if (!userId) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 }

 const { workspaceId } = await context.params;

 try {
  const members = authDb.listWorkspaceMembers({ workspaceId, userId });
  return NextResponse.json({ members });
 } catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to list workspace members.';
  return NextResponse.json({ error: message }, { status: 403 });
 }
}

type AddMemberBody = {
 email?: string;
 role?: 'admin' | 'member' | 'viewer';
};

export async function POST(request: NextRequest, context: Context) {
 const session = await getServerSession(authOptions);
 const userId = session?.user?.id;

 if (!userId) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 }

 const { workspaceId } = await context.params;

 try {
  const body = (await request.json()) as AddMemberBody;
  const added = authDb.addWorkspaceMemberByEmail({
   workspaceId,
   email: body.email,
   role: body.role,
   addedByUserId: userId,
  });

  return NextResponse.json({ ok: true, member: added });
 } catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to add member.';
  return NextResponse.json({ error: message }, { status: 400 });
 }
}
