import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth-options';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
 const session = await getServerSession(authOptions);
 const userId = session?.user?.id;

 if (!userId) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 }

 const workspaces = await authDb.listUserWorkspaces(userId);
 return NextResponse.json({
  workspaces,
  defaultWorkspaceId: session?.user?.defaultWorkspaceId || (await authDb.getDefaultWorkspaceIdByUserId(userId)),
 });
}

type CreateWorkspaceBody = {
 name?: string;
};

export async function POST(request: NextRequest) {
 const session = await getServerSession(authOptions);
 const userId = session?.user?.id;

 if (!userId) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 }

 try {
  const body = (await request.json()) as CreateWorkspaceBody;
  const workspace = await authDb.createWorkspace(userId, body.name);
  return NextResponse.json({ ok: true, workspace });
 } catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to create workspace.';
  return NextResponse.json({ error: message }, { status: 400 });
 }
}
