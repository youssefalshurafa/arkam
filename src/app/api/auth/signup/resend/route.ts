import { NextRequest, NextResponse } from 'next/server';
import { getAppBaseUrl } from '@/server/app-url';
import { errorResponse, parseBody, tooManyRequests } from '@/server/http';
import { signupResendSchema } from '@/server/auth-schemas';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const verification = require('@/server/email-verification');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mailer = require('@/server/mailer');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const security = require('@/server/security');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
 const budget = await security.hit('signupIp', security.getClientIp(request.headers));
 if (!budget.allowed) return tooManyRequests(budget.retryAfterSeconds);

 const parsed = await parseBody(request, signupResendSchema);
 if (parsed.response) return parsed.response;

 try {
  const result = await verification.resendCode({ pendingId: parsed.data.pendingId });
  if (result.purpose !== 'signup') {
   return NextResponse.json({ error: 'This verification has expired. Please start again.' }, { status: 400 });
  }
  const base = getAppBaseUrl();
  if (result.decoy) {
   await mailer.sendAlreadyRegisteredEmail({ to: result.email, loginUrl: `${base}/login`, forgotUrl: `${base}/forgot-password` });
  } else {
   await mailer.sendVerificationCodeEmail({ to: result.email, name: result.name, code: result.code, purpose: 'signup' });
  }
  return NextResponse.json({ ok: true });
 } catch (error) {
  return errorResponse(error, 'Failed to resend the code.', 400, 'auth/signup/resend');
 }
}
