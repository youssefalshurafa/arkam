import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth-options';
import { ADMIN_UNLOCK_COOKIE, checkAdminPanelPassword, isSuperAdmin, signAdminUnlockToken } from '@/server/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60; // 12 hours, matches the token's own TTL

// Second, independent gate in front of the super-admin panel: requires an existing
// super-admin session (so this endpoint itself isn't a public brute-force target) plus
// a separate panel password, unrelated to the account's sign-in password.
export async function POST(request: NextRequest) {
 const session = await getServerSession(authOptions);

 if (!isSuperAdmin(session?.user?.email)) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 }

 const { password } = (await request.json()) as { password?: string };

 if (!password || !checkAdminPanelPassword(password)) {
  return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 });
 }

 const token = signAdminUnlockToken();
 if (!token) {
  return NextResponse.json({ error: 'Admin panel password is not configured.' }, { status: 500 });
 }

 const response = NextResponse.json({ ok: true });
 response.cookies.set(ADMIN_UNLOCK_COOKIE, token, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: COOKIE_MAX_AGE_SECONDS,
 });
 return response;
}

// Manual "Lock" action — clears the unlock cookie.
export async function DELETE() {
 const session = await getServerSession(authOptions);

 if (!isSuperAdmin(session?.user?.email)) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 }

 const response = NextResponse.json({ ok: true });
 response.cookies.delete(ADMIN_UNLOCK_COOKIE);
 return response;
}
