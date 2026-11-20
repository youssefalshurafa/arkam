import { NextRequest, NextResponse } from 'next/server';
import { getAppBaseUrl } from '@/server/app-url';
import { errorResponse, parseBody, tooManyRequests } from '@/server/http';
import { signupStartSchema } from '@/server/auth-schemas';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const verification = require('@/server/email-verification');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mailer = require('@/server/mailer');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const security = require('@/server/security');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Step 1 of signup: validate, park the details in a pending row, and email a 6-digit code.
// No account exists until /api/auth/signup/verify confirms the code — so an address can only
// ever be registered by whoever controls its inbox.
//
// The response is the same for a new or an already-registered address (no enumeration); in
// the latter case the inbox owner gets a "you already have an account" mail instead of a code.
export async function POST(request: NextRequest) {
 const parsed = await parseBody(request, signupStartSchema);
 if (parsed.response) return parsed.response;
 const { name, email, password, phone } = parsed.data;

 const ip = security.getClientIp(request.headers);
 const byIp = await security.hit('signupIp', ip);
 if (!byIp.allowed) return tooManyRequests(byIp.retryAfterSeconds);
 const byEmail = await security.hit('signupEmail', email);
 if (!byEmail.allowed) return tooManyRequests(byEmail.retryAfterSeconds);

 try {
  const pending = await verification.startSignup({ name, email, password, phone });
  const base = getAppBaseUrl();
  if (pending.alreadyRegistered) {
   await mailer.sendAlreadyRegisteredEmail({ to: pending.email, loginUrl: `${base}/login`, forgotUrl: `${base}/forgot-password` });
  } else {
   await mailer.sendVerificationCodeEmail({ to: pending.email, name: pending.name, code: pending.code, purpose: 'signup' });
  }
  await security.logSecurityEvent({ identifier: email, event: 'signup_started', headers: request.headers });
  return NextResponse.json({ ok: true, pendingId: pending.pendingId, email: pending.email });
 } catch (error) {
  return errorResponse(error, 'Failed to sign up.', 400, 'auth/signup');
 }
}
