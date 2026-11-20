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
  const members = await authDb.listWorkspaceMembers({ workspaceId, userId });
  return NextResponse.json({ members });
 } catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to list workspace members.';
  return NextResponse.json({ error: message }, { status: 403 });
 }
}

// Adding people now goes through single-use invitation links:
// POST /api/workspaces/[workspaceId]/invitations (see that route).

type UpdateRoleBody = {
 targetUserId?: string;
 role?: 'admin' | 'member' | 'viewer';
};

export async function PATCH(request: NextRequest, context: Context) {
 const session = await getServerSession(authOptions);
 const userId = session?.user?.id;

 if (!userId) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 }

 const { workspaceId } = await context.params;

 try {
  const body = (await request.json()) as UpdateRoleBody;
  await authDb.updateWorkspaceMemberRole({
   workspaceId,
   targetUserId: body.targetUserId,
   role: body.role,
   actorUserId: userId,
  });
  return NextResponse.json({ ok: true });
 } catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to update role.';
  return NextResponse.json({ error: message }, { status: 400 });
 }
}

type RemoveMemberBody = {
 targetUserId?: string;
};

export async function DELETE(request: NextRequest, context: Context) {
 const session = await getServerSession(authOptions);
 const userId = session?.user?.id;

 if (!userId) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 }

 const { workspaceId } = await context.params;

 try {
  const body = (await request.json()) as RemoveMemberBody;
  await authDb.removeWorkspaceMember({
   workspaceId,
   targetUserId: body.targetUserId,
   actorUserId: userId,
  });
  return NextResponse.json({ ok: true });
 } catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to remove member.';
  return NextResponse.json({ error: message }, { status: 400 });
 }
}
