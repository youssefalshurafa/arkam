import { NextRequest, NextResponse } from 'next/server';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SetInitialPasswordBody = {
 email?: string;
 password?: string;
};

// First-login flow for accounts the super admin created directly (no signup, no email):
// the account exists with no password_hash yet, so anyone who knows the email/username can
// set the initial password here. Safe because authDb.setInitialPassword only matches rows
// where password_hash IS NULL — an account that already has a password is untouched by this
// route (use /api/auth/forgot-password + reset-password for that case instead).
export async function POST(request: NextRequest) {
 try {
  const body = (await request.json()) as SetInitialPasswordBody;
  await authDb.setInitialPassword({ email: body.email, password: body.password });
  return NextResponse.json({ ok: true });
 } catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to set password.';
  return NextResponse.json({ error: message }, { status: 400 });
 }
}
