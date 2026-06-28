import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth-options';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sendWorkspaceInviteEmail } = require('@/server/mailer');

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

type AddMemberBody = {
 name?: string;
 email?: string;
 role?: 'admin' | 'member' | 'viewer';
};

// Invite a teammate (or add an existing user) to the workspace.
export async function POST(request: NextRequest, context: Context) {
 const session = await getServerSession(authOptions);
 const userId = session?.user?.id;

 if (!userId) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 }

 const { workspaceId } = await context.params;

 try {
  const body = (await request.json()) as AddMemberBody;
  const result = await authDb.inviteWorkspaceMember({
   workspaceId,
   name: body.name,
   email: body.email,
   role: body.role,
   invitedByUserId: userId,
  });

  // New teammate → email them a set-password link (best-effort).
  if (result.status === 'invited' && result.rawToken) {
   try {
    const workspaces = await authDb.listUserWorkspaces(userId);
    const workspaceName = workspaces.find((w: { id: string; name: string }) => w.id === workspaceId)?.name || '';
    await sendWorkspaceInviteEmail({
     to: result.email,
     name: body.name || '',
     inviterName: session.user?.name || '',
     workspaceName,
     inviteUrl: `${request.nextUrl.origin}/reset-password/${result.rawToken}`,
    });
   } catch (mailError) {
    console.error('[workspaces/members] Invite email failed:', mailError);
   }
  }

  return NextResponse.json({ ok: true, status: result.status });
 } catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to add member.';
  return NextResponse.json({ error: message }, { status: 400 });
 }
}

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
