import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth-options';
import { ADMIN_UNLOCK_COOKIE, checkAdminPanelPassword, isSuperAdmin, signAdminUnlockToken } from '@/server/permissions';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const security = require('@/server/security');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60; // 12 hours, matches the token's own TTL

// Second, independent gate in front of the super-admin panel: requires an existing
// super-admin session with two-factor on, plus a separate panel password unrelated to the
// account's sign-in password. Attempts are rate-limited per account and every outcome is
// written to the audit trail.
export async function POST(request: NextRequest) {
 const session = await getServerSession(authOptions);
 const userId = session?.user?.id;

 if (!isSuperAdmin(userId)) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 }
 if (!session?.user?.mfaEnabled) {
  return NextResponse.json({ error: 'MFA_REQUIRED' }, { status: 403 });
 }

 const budget = await security.hit('adminUnlock', userId);
 if (!budget.allowed) {
  await security.logSecurityEvent({ userId, event: 'admin_unlock_locked', headers: request.headers });
  return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429, headers: { 'Retry-After': String(budget.retryAfterSeconds) } });
 }

 const body = (await request.json().catch(() => ({}))) as { password?: unknown };
 const password = typeof body.password === 'string' ? body.password : '';

 if (!password || !checkAdminPanelPassword(password)) {
  await security.logSecurityEvent({ userId, event: 'admin_unlock_failed', headers: request.headers });
  await authDb.logAdminAction({ actorEmail: session?.user?.email, action: 'unlock_failed' });
  return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 });
 }

 const token = signAdminUnlockToken(userId!);
 if (!token) {
  return NextResponse.json({ error: 'Admin panel password is not configured.' }, { status: 500 });
 }

 await security.resetRateLimit(`adminUnlock:${userId}`);
 await security.logSecurityEvent({ userId, event: 'admin_unlock', headers: request.headers });
 await authDb.logAdminAction({ actorEmail: session?.user?.email, action: 'unlock' });

 const response = NextResponse.json({ ok: true });
 response.cookies.set(ADMIN_UNLOCK_COOKIE, token, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  // Lax (not strict) so following an admin-notification email link into /admin keeps the
  // unlock; cross-site writes are blocked by the Origin check in src/proxy.ts.
  sameSite: 'lax',
  path: '/',
  maxAge: COOKIE_MAX_AGE_SECONDS,
 });
 return response;
}

// Manual "Lock" action — clears the unlock cookie.
export async function DELETE() {
 const session = await getServerSession(authOptions);

 if (!isSuperAdmin(session?.user?.id)) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 }

 const response = NextResponse.json({ ok: true });
 response.cookies.delete(ADMIN_UNLOCK_COOKIE);
 return response;
}
