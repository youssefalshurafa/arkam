import { NextRequest, NextResponse } from 'next/server';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sendPasswordResetRequestNotification } = require('@/server/mailer');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ResetRequestBody = {
 username?: string;
 note?: string;
};

// Public entry point for a locked-out user (typically a username-only account the email-based
// /forgot-password flow can't reach) to ask support for a password reset. Anti-enumeration:
// always returns { ok: true } regardless of whether the account exists, so an attacker can't
// probe which usernames are registered. A pending request changes nothing about the account —
// only a super-admin approval (after out-of-band identity verification) mints a reset link.
export async function POST(request: NextRequest) {
 try {
  const body = (await request.json()) as ResetRequestBody;
  const username = String(body.username || '').trim();
  const note = String(body.note || '').trim();

  const result = await authDb.createPasswordResetRequest({ email: username, note });

  // Best-effort: alert the admin only when a request was actually filed for a real account.
  if (result.created) {
   try {
    const adminEmail = process.env.ADMIN_NOTIFY_EMAIL?.trim() || process.env.SUPER_ADMIN_EMAIL?.trim();
    if (adminEmail) {
     await sendPasswordResetRequestNotification({
      to: adminEmail,
      requesterName: result.name || '',
      requesterUsername: username,
      reviewUrl: `${request.nextUrl.origin}/admin`,
     });
    }
   } catch (mailError) {
    console.error('[auth/reset-request] Admin notification failed:', mailError);
   }
  }

  return NextResponse.json({ ok: true });
 } catch (error) {
  // Even on an unexpected failure, don't leak details — keep the response uniform.
  console.error('[auth/reset-request] Failed:', error);
  return NextResponse.json({ ok: true });
 }
}
