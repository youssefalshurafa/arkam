import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/server/auth-options';
import { getAppBaseUrl } from '@/server/app-url';
import { errorResponse, parseBody, tooManyRequests } from '@/server/http';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const verification = require('@/server/email-verification');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mailer = require('@/server/mailer');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const security = require('@/server/security');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { verifyPassword } = require('@/server/passwords');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.discriminatedUnion('mode', [
 // Prove the address already on the account (legacy, never-verified accounts).
 z.object({ mode: z.literal('verify') }),
 // Move the login to a new address: re-authenticate, then confirm a code sent to the NEW inbox.
 z.object({
  mode: z.literal('change'),
  currentPassword: z.string().min(1, 'Current password is required.').max(256),
  newEmail: z.string().trim().toLowerCase().max(254).email('Please enter a valid email address.'),
 }),
]);

// Starts an email verification for the signed-in user; confirm with /api/account/email/confirm.
export async function POST(request: NextRequest) {
 const session = await getServerSession(authOptions);
 const userId = session?.user?.id;
 if (!userId) {
  return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
 }

 const parsed = await parseBody(request, schema);
 if (parsed.response) return parsed.response;

 const budget = await security.hit('reauth', `email:${userId}`);
 if (!budget.allowed) return tooManyRequests(budget.retryAfterSeconds);

 try {
  if (parsed.data.mode === 'verify') {
   const pending = await verification.startAccountVerification({ userId });
   await mailer.sendVerificationCodeEmail({ to: pending.email, name: pending.name, code: pending.code, purpose: 'verify' });
   return NextResponse.json({ ok: true, pendingId: pending.pendingId, email: pending.email });
  }

  const hash = await authDb.getPasswordHash(userId);
  if (!hash) {
   return NextResponse.json(
    { error: 'Set a password first (use "Forgot password" on the sign-in page), then change your email.' },
    { status: 400 },
   );
  }
  if (!(await verifyPassword(parsed.data.currentPassword, hash))) {
   await security.logSecurityEvent({ userId, event: 'reauth_failed', headers: request.headers, meta: { for: 'email_change' } });
   return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 400 });
  }

  const pending = await verification.startEmailChange({ userId, newEmail: parsed.data.newEmail });
  if (pending.alreadyRegistered) {
   // Same response as a free address (no probing which emails are registered); the
   // address owner learns someone tried, and the code that could confirm is never sent.
   const base = getAppBaseUrl();
   await mailer.sendAlreadyRegisteredEmail({ to: pending.email, loginUrl: `${base}/login`, forgotUrl: `${base}/forgot-password` });
  } else {
   await mailer.sendVerificationCodeEmail({ to: pending.email, name: pending.name, code: pending.code, purpose: 'email_change' });
  }
  return NextResponse.json({ ok: true, pendingId: pending.pendingId, email: pending.email });
 } catch (error) {
  return errorResponse(error, 'Failed to send the verification code.', 400, 'account/email');
 }
}
