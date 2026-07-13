import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth-options';
import { isSuperAdmin, isAdminPanelUnlocked } from '@/server/permissions';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
 const session = await getServerSession(authOptions);

 if (!isSuperAdmin(session?.user?.email) || !isAdminPanelUnlocked(request)) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 }

 const status = request.nextUrl.searchParams.get('status') || undefined;
 const requests = await authDb.listPasswordResetRequests({ status });
 return NextResponse.json({ requests });
}

// Approve or reject a password reset request. On approval the server mints a one-time, 1-hour,
// single-use reset token and returns the /reset-password/{token} link — the admin verifies the
// requester's identity out-of-band first (calling the trusted contact on file), then sends this
// link to the user through that trusted channel.
export async function POST(request: NextRequest) {
 const session = await getServerSession(authOptions);

 if (!isSuperAdmin(session?.user?.email) || !isAdminPanelUnlocked(request)) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 }

 const { id, action } = (await request.json()) as { id?: string; action?: 'approve' | 'reject' };

 if (!id || (action !== 'approve' && action !== 'reject')) {
  return NextResponse.json({ error: 'id and a valid action are required.' }, { status: 400 });
 }

 try {
  const result = await authDb.reviewPasswordResetRequest({
   id,
   action,
   reviewerUserId: session?.user?.id,
  });

  await authDb.logAdminAction({
   actorEmail: session?.user?.email,
   action: action === 'approve' ? 'approve_reset' : 'reject_reset',
   targetEmail: result.email,
   targetName: result.name,
  });

  const resetLink = result.resetToken ? `${request.nextUrl.origin}/reset-password/${result.resetToken}` : null;
  return NextResponse.json({ ok: true, resetLink });
 } catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to review request.';
  return NextResponse.json({ error: message }, { status: 400 });
 }
}
