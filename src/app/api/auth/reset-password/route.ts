import { NextRequest, NextResponse } from 'next/server';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ResetPasswordBody = {
 token?: string;
 password?: string;
};

export async function GET(request: NextRequest) {
 const token = String(request.nextUrl.searchParams.get('token') || '').trim();

 if (!token) {
  return NextResponse.json({ valid: false, error: 'Token is required.' }, { status: 400 });
 }

 const valid = authDb.validatePasswordResetToken(token);
 return NextResponse.json({ valid });
}

export async function POST(request: NextRequest) {
 try {
  const body = (await request.json()) as ResetPasswordBody;
  const token = String(body.token || '').trim();
  const password = String(body.password || '');

  if (!token) {
   return NextResponse.json({ error: 'Token is required.' }, { status: 400 });
  }

  authDb.resetPasswordWithToken({ token, password });

  return NextResponse.json({ ok: true });
 } catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to reset password.';
  return NextResponse.json({ error: message }, { status: 400 });
 }
}
