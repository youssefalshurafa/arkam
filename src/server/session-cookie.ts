import type { NextRequest, NextResponse } from 'next/server';
import { encode, getToken, type JWT } from 'next-auth/jwt';
import { SESSION_MAX_AGE_SECONDS } from '@/server/session-policy';

// Same rule next-auth v4 uses to pick its cookie name/flags, so we overwrite the real cookie.
function secureCookiesEnabled(): boolean {
 const url = process.env.NEXTAUTH_URL;
 return url ? url.startsWith('https://') : Boolean(process.env.VERCEL);
}

function sessionCookieName(): string {
 return secureCookiesEnabled() ? '__Secure-next-auth.session-token' : 'next-auth.session-token';
}

// Re-mints THIS device's session cookie after an action that bumped users.session_version
// (password change, sign-out-everywhere). Without it the caller's own token would carry the
// old version and be revoked on its next claims refresh along with every other device.
//
// Done server-side, never via the client's session update(): the jwt callback deliberately
// ignores update payloads for `sv`, otherwise any device could un-revoke itself.
export async function reissueSessionCookie(
 request: NextRequest,
 response: NextResponse,
 patch: Partial<JWT>,
): Promise<boolean> {
 const secret = process.env.NEXTAUTH_SECRET;
 if (!secret) return false;

 const secure = secureCookiesEnabled();
 const token = await getToken({ req: request, secret, secureCookie: secure });
 if (!token) return false;

 const next: JWT = { ...token, ...patch, claimsRefreshedAt: Date.now() };
 const value = await encode({ token: next, secret, maxAge: SESSION_MAX_AGE_SECONDS });
 response.cookies.set(sessionCookieName(), value, {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure,
  maxAge: SESSION_MAX_AGE_SECONDS,
 });
 return true;
}
