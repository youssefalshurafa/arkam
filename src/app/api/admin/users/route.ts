import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth-options';
import { isSuperAdmin } from '@/server/permissions';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { dropWorkspaceSchema } = require('@/server/postgres');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
 const session = await getServerSession(authOptions);

 if (!isSuperAdmin(session?.user?.email)) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 }

 const users = await authDb.listAllUsers();
 return NextResponse.json({ users });
}

export async function DELETE(request: NextRequest) {
 const session = await getServerSession(authOptions);

 if (!isSuperAdmin(session?.user?.email)) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 }

 const { userId } = (await request.json()) as { userId?: string };

 if (!userId || typeof userId !== 'string') {
  return NextResponse.json({ error: 'userId is required.' }, { status: 400 });
 }

 // Prevent super admin from deleting themselves
 if (session?.user?.id === userId) {
  return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 });
 }

 try {
  const { deletedWorkspaceIds } = await authDb.deleteUser(userId);

  // Drop the workspace schemas (accounting data) for each owned workspace
  await Promise.allSettled((deletedWorkspaceIds as string[]).map((wsId: string) => dropWorkspaceSchema(wsId)));

  return NextResponse.json({ ok: true, deletedWorkspaceIds });
 } catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to delete user.';
  return NextResponse.json({ error: message }, { status: 400 });
 }
}
