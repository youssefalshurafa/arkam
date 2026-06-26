import { NextRequest, NextResponse } from 'next/server';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sendPasswordResetEmail } = require('@/server/mailer');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ForgotPasswordBody = {
 email?: string;
};

export async function POST(request: NextRequest) {
 try {
  const body = (await request.json()) as ForgotPasswordBody;
  const email = String(body.email || '').trim();

  if (!email) {
   return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
  }

  const result = await authDb.requestPasswordReset(email);

  if (result.resetToken) {
   const resetUrl = `${request.nextUrl.origin}/reset-password/${result.resetToken}`;
   // Fetch user name for the email
   const user = await authDb.getUserByEmail(email);
   await sendPasswordResetEmail({
    to: email,
    name: user?.name || email,
    resetUrl,
   });
  }

  // Always return the same response (anti-enumeration)
  return NextResponse.json({ ok: true });
 } catch (error) {
  console.error('[forgot-password] Error:', error);
  const message = error instanceof Error ? error.message : 'Failed to request password reset.';
  return NextResponse.json({ error: message }, { status: 400 });
 }
}
