import { NextRequest, NextResponse } from 'next/server';
import { getAppBaseUrl } from '@/server/app-url';
import { parseBody, tooManyRequests } from '@/server/http';
import { forgotPasswordSchema } from '@/server/auth-schemas';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sendPasswordResetEmail, sendPasswordResetRequestNotification } = require('@/server/mailer');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const security = require('@/server/security');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The one "I can't sign in" entry point (it absorbed the separate /reset-request flow).
//
// The response is IDENTICAL whatever the identifier is — unknown, email account, username
// account — so it can't be used to probe which accounts exist (the old route answered 404
// "no_account" and an `emailable` flag, and /api/auth/check-user leaked the same live).
// Behind that uniform answer:
//   * email account    -> a 1-hour reset link is emailed to the address on file;
//   * username account -> a support reset request is filed and the admin is notified; they
//                         verify the person via the trusted contact and send a setup link;
//   * no account       -> nothing.
export async function POST(request: NextRequest) {
 const parsed = await parseBody(request, forgotPasswordSchema);
 if (parsed.response) return parsed.response;

 const identifier = String(parsed.data.identifier || parsed.data.email || '').trim().toLowerCase();
 if (!identifier) {
  return NextResponse.json({ error: 'Email or username is required.' }, { status: 400 });
 }

 const ip = security.getClientIp(request.headers);
 const [byIp, byIdentifier] = await Promise.all([security.hit('recoveryIp', ip), security.hit('recoveryIdentifier', identifier)]);
 if (!byIp.allowed) {
  return tooManyRequests(byIp.retryAfterSeconds);
 }

 // Over the per-identifier budget we still answer "ok" (uniform) but do nothing, so the
 // endpoint can't be used to flood someone's inbox or the admin's.
 if (byIdentifier.allowed) {
  try {
   await handleRecovery(identifier, parsed.data.note || '', request);
  } catch (error) {
   console.error('[forgot-password] recovery failed:', error instanceof Error ? error.message : error);
  }
 }

 return NextResponse.json({ ok: true });
}

async function handleRecovery(identifier: string, note: string, request: NextRequest) {
 const target = await authDb.lookupResetTarget(identifier);
 if (!target.exists) {
  await security.logSecurityEvent({ identifier, event: 'recovery_unknown_identifier', headers: request.headers });
  return;
 }

 const user = await authDb.getUserByEmail(identifier);

 if (target.emailable) {
  const result = await authDb.requestPasswordReset(identifier);
  if (result.resetToken) {
   await sendPasswordResetEmail({
    to: identifier,
    name: user?.name || identifier,
    resetUrl: `${getAppBaseUrl()}/reset-password/${result.resetToken}`,
   });
  }
  await security.logSecurityEvent({ userId: user?.id, identifier, event: 'password_reset_requested', headers: request.headers });
  return;
 }

 const filed = await authDb.createPasswordResetRequest({ email: identifier, note });
 await security.logSecurityEvent({ userId: user?.id, identifier, event: 'support_reset_requested', headers: request.headers });
 if (filed.created) {
  const adminEmail = process.env.ADMIN_NOTIFY_EMAIL?.trim() || process.env.SUPER_ADMIN_EMAIL?.trim();
  if (adminEmail) {
   await sendPasswordResetRequestNotification({
    to: adminEmail,
    requesterName: filed.name || '',
    requesterUsername: identifier,
    reviewUrl: `${getAppBaseUrl()}/admin/resets`,
   }).catch((mailError: unknown) => console.error('[forgot-password] admin notification failed:', mailError));
  }
 }
}
