import { NextRequest, NextResponse } from 'next/server';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sendPasswordResetEmail } = require('@/server/mailer');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ForgotPasswordBody = {
 // `identifier` is the email OR username the user typed. `email` is kept for backward compatibility.
 identifier?: string;
 email?: string;
};

export async function POST(request: NextRequest) {
 try {
  const body = (await request.json()) as ForgotPasswordBody;
  const identifier = String(body.identifier || body.email || '').trim();

  if (!identifier) {
   return NextResponse.json({ error: 'Email or username is required.' }, { status: 400 });
  }

  // This flow intentionally reports whether the account exists (see /api/auth/check-user) so the
  // user gets clear "no account found" feedback — a deliberate UX choice over strict anti-enumeration.
  const target = await authDb.lookupResetTarget(identifier);
  if (!target.exists) {
   return NextResponse.json({ error: 'no_account' }, { status: 404 });
  }

  // Username-only accounts have no deliverable email — we can't send them a reset link. Tell the
  // client to route them to the support-approval flow (/reset-request) instead.
  if (!target.emailable) {
   return NextResponse.json({ ok: true, emailable: false });
  }

  const result = await authDb.requestPasswordReset(identifier);

  if (result.resetToken) {
   const resetUrl = `${request.nextUrl.origin}/reset-password/${result.resetToken}`;
   // Fetch user name for the email
   const user = await authDb.getUserByEmail(identifier);
   await sendPasswordResetEmail({
    to: identifier,
    name: user?.name || identifier,
    resetUrl,
   });
  }

  return NextResponse.json({ ok: true, emailable: true });
 } catch (error) {
  console.error('[forgot-password] Error:', error);
  const message = error instanceof Error ? error.message : 'Failed to request password reset.';
  return NextResponse.json({ error: message }, { status: 400 });
 }
}
