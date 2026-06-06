import { NextRequest, NextResponse } from 'next/server';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');

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
  const resetUrl = result.resetToken ? `${request.nextUrl.origin}/reset-password/${result.resetToken}` : null;

  return NextResponse.json({
   ok: true,
   message: 'If this email exists, a reset link has been generated.',
   resetUrl,
   expiresAt: result.expiresAt,
  });
 } catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to request password reset.';
  return NextResponse.json({ error: message }, { status: 400 });
 }
}
