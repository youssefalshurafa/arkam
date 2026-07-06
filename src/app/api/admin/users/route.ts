import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth-options';
import { isSuperAdmin } from '@/server/permissions';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { dropWorkspaceSchema } = require('@/server/postgres');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sendAccountCreatedEmail } = require('@/server/mailer');

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

type CreateUserBody = {
 name?: string;
 email?: string;
 durationDays?: number;
};

// Super admin creates a user directly: account is active immediately with the
// given subscription window, and the user is emailed a link to set their
// password on first login.
export async function POST(request: NextRequest) {
 const session = await getServerSession(authOptions);

 if (!isSuperAdmin(session?.user?.email)) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 }

 const { name, email, durationDays } = (await request.json()) as CreateUserBody;

 if (!email || typeof email !== 'string') {
  return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
 }

 try {
  const result = await authDb.createUserBySuperAdmin({ name, email, durationDays });

  try {
   await sendAccountCreatedEmail({
    to: result.email,
    name: result.name,
    setPasswordUrl: `${request.nextUrl.origin}/reset-password/${result.rawToken}`,
    subscriptionEndsAt: result.subscriptionEndsAt,
   });
  } catch (mailError) {
   console.error('[admin/users] Account created email failed:', mailError);
  }

  return NextResponse.json({
   ok: true,
   user: { id: result.id, email: result.email, name: result.name, subscriptionEndsAt: result.subscriptionEndsAt },
  });
 } catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to create user.';
  return NextResponse.json({ error: message }, { status: 400 });
 }
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
