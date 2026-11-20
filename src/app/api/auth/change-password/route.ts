import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth-options';
import { reissueSessionCookie } from '@/server/session-cookie';
import { errorResponse, parseBody, tooManyRequests } from '@/server/http';
import { changePasswordSchema } from '@/server/auth-schemas';
import { getAppBaseUrl } from '@/server/app-url';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const security = require('@/server/security');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mailer = require('@/server/mailer');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
 const session = await getServerSession(authOptions);
 const userId = session?.user?.id;

 if (!userId) {
  return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
 }

 const parsed = await parseBody(request, changePasswordSchema);
 if (parsed.response) return parsed.response;

 // A stolen session must not be able to brute-force the current password here.
 const budget = await security.hit('reauth', userId);
 if (!budget.allowed) return tooManyRequests(budget.retryAfterSeconds);

 try {
  const result = await authDb.changePassword({ userId, ...parsed.data });
  await security.logSecurityEvent({ userId, event: 'password_changed', headers: request.headers });

  // changePassword bumped session_version, which signs out every device. Re-mint THIS
  // device's cookie with the new version so only the others drop.
  const claims = await authDb.getSessionClaims(userId);
  const response = NextResponse.json({ ok: true });
  await reissueSessionCookie(request, response, { sv: Number(claims?.sessionVersion) || 0 });

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email || '')) {
   mailer
    .sendSecurityNoticeEmail({
     to: result.email,
     name: result.name,
     heading: 'Your password was changed',
     message: 'The password for your Arkam account was just changed, and every other device was signed out.',
     actionUrl: `${getAppBaseUrl()}/forgot-password`,
     actionLabel: "This wasn't me",
    })
    .catch(() => {});
  }
  return response;
 } catch (error) {
  return errorResponse(error, 'Failed to change password.', 400, 'auth/change-password');
 }
}
