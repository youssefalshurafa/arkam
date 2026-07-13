import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth-options';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sendPasswordResetRequestNotification } = require('@/server/mailer');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ResetRequestBody = {
 note?: string;
};

// Authenticated entry point for a logged-in user who has forgotten their current password to file
// the same support-approval reset request as the public /reset-request flow — identified by
// session, so no username or current password is needed. A pending request changes nothing about
// the account; only a super-admin approval (after out-of-band identity verification) mints a link.
export async function POST(request: NextRequest) {
 const session = await getServerSession(authOptions);
 const userId = session?.user?.id;

 if (!userId) {
  return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
 }

 try {
  const body = (await request.json().catch(() => ({}))) as ResetRequestBody;
  const note = String(body.note || '').trim();

  const result = await authDb.createPasswordResetRequestForUser({ userId, note });

  // Best-effort: alert the admin only when a new request was actually filed.
  if (result.created) {
   try {
    const adminEmail = process.env.ADMIN_NOTIFY_EMAIL?.trim() || process.env.SUPER_ADMIN_EMAIL?.trim();
    if (adminEmail) {
     await sendPasswordResetRequestNotification({
      to: adminEmail,
      requesterName: result.name || '',
      requesterUsername: result.username || '',
      reviewUrl: `${request.nextUrl.origin}/admin`,
     });
    }
   } catch (mailError) {
    console.error('[auth/reset-request/authenticated] Admin notification failed:', mailError);
   }
  }

  return NextResponse.json({ ok: true });
 } catch (error) {
  console.error('[auth/reset-request/authenticated] Failed:', error);
  return NextResponse.json({ error: 'Failed to submit request.' }, { status: 500 });
 }
}
