import { NextRequest, NextResponse } from 'next/server';
import { errorResponse, parseBody, tooManyRequests } from '@/server/http';
import { signupVerifySchema } from '@/server/auth-schemas';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const verification = require('@/server/email-verification');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const security = require('@/server/security');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Step 2 of signup: confirm the emailed code. Creates the account (verified email, 14-day
// trial, own workspace); the client then signs in with the password it still holds.
export async function POST(request: NextRequest) {
 const budget = await security.hit('codeVerifyIp', security.getClientIp(request.headers));
 if (!budget.allowed) return tooManyRequests(budget.retryAfterSeconds);

 const parsed = await parseBody(request, signupVerifySchema);
 if (parsed.response) return parsed.response;

 try {
  const result = await verification.completeSignup({
   pendingId: parsed.data.pendingId,
   code: parsed.data.code,
   createWorkspaceWithExecutor: authDb.createWorkspaceForUserWithExecutor,
  });
  await security.logSecurityEvent({ userId: result.userId, identifier: result.email, event: 'signup', headers: request.headers });
  return NextResponse.json({ ok: true, email: result.email });
 } catch (error) {
  return errorResponse(error, 'Verification failed.', 400, 'auth/signup/verify');
 }
}
