import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth-options';
import { isSuperAdmin, isAdminPanelUnlocked } from '@/server/permissions';
import { getAppBaseUrl } from '@/server/app-url';
import { errorResponse, parseBody } from '@/server/http';
import { adminCreateUserSchema, adminDeleteUserSchema } from '@/server/auth-schemas';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { dropWorkspaceSchema } = require('@/server/postgres');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
 const session = await getServerSession(authOptions);

 if (!isSuperAdmin(session?.user?.id) || !isAdminPanelUnlocked(request, session?.user?.id) || !session?.user?.mfaEnabled) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 }

 const users = await authDb.listAllUsers();
 return NextResponse.json({ users });
}

// Super admin creates a user directly: account is active immediately with the given
// subscription window, no password set, and no email sent — `email` may be a plain
// username instead of a real address. The response carries a one-time 72h setup link
// (/setup/[token]) for the admin to hand over; it is the only way to claim the account.
export async function POST(request: NextRequest) {
 const session = await getServerSession(authOptions);

 if (!isSuperAdmin(session?.user?.id) || !isAdminPanelUnlocked(request, session?.user?.id) || !session?.user?.mfaEnabled) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 }

 const parsed = await parseBody(request, adminCreateUserSchema);
 if (parsed.response) return parsed.response;
 const { name, email, durationDays, phone } = parsed.data;

 try {
  const result = await authDb.createUserBySuperAdmin({ name, email, durationDays, phone });
  await authDb.logAdminAction({
   actorEmail: session?.user?.email,
   action: 'create_user',
   targetUserId: result.id,
   targetEmail: result.email,
   targetName: result.name,
   meta: { durationDays: durationDays ?? null },
  });
  return NextResponse.json({
   ok: true,
   user: { id: result.id, email: result.email, name: result.name, subscriptionEndsAt: result.subscriptionEndsAt },
   setupUrl: `${getAppBaseUrl()}/setup/${result.setupToken}`,
  });
 } catch (error) {
  return errorResponse(error, 'Failed to create user.', 400, 'admin/users');
 }
}

export async function DELETE(request: NextRequest) {
 const session = await getServerSession(authOptions);

 if (!isSuperAdmin(session?.user?.id) || !isAdminPanelUnlocked(request, session?.user?.id) || !session?.user?.mfaEnabled) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 }

 const parsed = await parseBody(request, adminDeleteUserSchema);
 if (parsed.response) return parsed.response;
 const { userId } = parsed.data;

 // Prevent super admin from deleting themselves
 if (session?.user?.id === userId) {
  return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 });
 }

 try {
  // Snapshot the user's identity into the audit trail BEFORE the row is gone, so the
  // "deleted user" entry still shows who was removed.
  await authDb.logAdminAction({ actorEmail: session?.user?.email, action: 'delete_user', targetUserId: userId });

  const { deletedWorkspaceIds } = await authDb.deleteUser(userId);

  // Drop the workspace schemas (accounting data) for each owned workspace
  await Promise.allSettled((deletedWorkspaceIds as string[]).map((wsId: string) => dropWorkspaceSchema(wsId)));

  return NextResponse.json({ ok: true, deletedWorkspaceIds });
 } catch (error) {
  return errorResponse(error, 'Failed to delete user.', 400, 'admin/users');
 }
}
