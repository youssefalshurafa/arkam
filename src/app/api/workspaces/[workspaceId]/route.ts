import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth-options';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const db = require('@/server/db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { dropWorkspaceSchema } = require('@/server/postgres');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = {
 params: Promise<{ workspaceId: string }>;
};

// Transaction count for the workspace, so the client can warn the user how much
// data they're about to lose before they confirm deletion.
export async function GET(_request: NextRequest, context: Context) {
 const session = await getServerSession(authOptions);
 const userId = session?.user?.id;

 if (!userId) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 }

 const { workspaceId } = await context.params;

 const role = await authDb.getWorkspaceRole(userId, workspaceId);
 if (!role) {
  return NextResponse.json({ error: 'You do not have access to this workspace.' }, { status: 403 });
 }

 const transactionCount = await db.countWorkspaceTransactions({ workspaceId });
 return NextResponse.json({ transactionCount });
}

type RenameWorkspaceBody = {
 name?: string;
};

export async function PATCH(request: NextRequest, context: Context) {
 const session = await getServerSession(authOptions);
 const userId = session?.user?.id;

 if (!userId) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 }

 const { workspaceId } = await context.params;

 try {
  const body = (await request.json()) as RenameWorkspaceBody;
  const workspace = await authDb.renameWorkspace({ workspaceId, name: body.name, actorUserId: userId });
  return NextResponse.json({ ok: true, workspace });
 } catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to rename workspace.';
  return NextResponse.json({ error: message }, { status: 400 });
 }
}

export async function DELETE(_request: NextRequest, context: Context) {
 const session = await getServerSession(authOptions);
 const userId = session?.user?.id;

 if (!userId) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 }

 const { workspaceId } = await context.params;

 try {
  await authDb.deleteWorkspace({ workspaceId, actorUserId: userId });
  // Drop the accounting schema (organizations/clients/transactions/...) after the
  // workspace + membership rows are gone.
  await dropWorkspaceSchema(workspaceId);
  return NextResponse.json({ ok: true });
 } catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to delete workspace.';
  return NextResponse.json({ error: message }, { status: 400 });
 }
}
