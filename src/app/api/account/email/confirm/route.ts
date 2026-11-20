import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/server/auth-options';
import { getAppBaseUrl } from '@/server/app-url';
import { reissueSessionCookie } from '@/server/session-cookie';
import { errorResponse, parseBody, tooManyRequests } from '@/server/http';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const verification = require('@/server/email-verification');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mailer = require('@/server/mailer');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const security = require('@/server/security');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
 pendingId: z.string().trim().min(1).max(64),
 code: z.string().trim().min(1, 'Enter the code.').max(32),
});

export async function POST(request: NextRequest) {
 const session = await getServerSession(authOptions);
 const userId = session?.user?.id;
 if (!userId) {
  return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
 }

 const budget = await security.hit('codeVerifyIp', security.getClientIp(request.headers));
 if (!budget.allowed) return tooManyRequests(budget.retryAfterSeconds);

 const parsed = await parseBody(request, schema);
 if (parsed.response) return parsed.response;

 try {
  const result = await verification.confirmAccountCode({ userId, ...parsed.data });
  const response = NextResponse.json({ ok: true, purpose: result.purpose, email: result.email });

  if (result.purpose === 'email_change') {
   await security.logSecurityEvent({ userId, event: 'email_changed', headers: request.headers, meta: { from: result.previousEmail, to: result.email } });
   // The JWT still carries the old address; refresh it right away on this device.
   await reissueSessionCookie(request, response, { email: result.email });
   if (result.previousEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.previousEmail)) {
    mailer
     .sendSecurityNoticeEmail({
      to: result.previousEmail,
      name: session?.user?.name,
      heading: 'Your sign-in email was changed',
      message: `The email for your Arkam account was changed to ${result.email}. You no longer receive account emails at this address.`,
      actionUrl: `${getAppBaseUrl()}/forgot-password`,
      actionLabel: 'This was not me',
     })
     .catch(() => {});
   }
  } else {
   await security.logSecurityEvent({ userId, event: 'email_verified', headers: request.headers });
  }
  return response;
 } catch (error) {
  return errorResponse(error, 'Verification failed.', 400, 'account/email/confirm');
 }
}
