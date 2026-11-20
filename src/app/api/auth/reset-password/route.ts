import { NextRequest, NextResponse } from 'next/server';
import { errorResponse, parseBody, tooManyRequests } from '@/server/http';
import { resetPasswordSchema } from '@/server/auth-schemas';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const security = require('@/server/security');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Serves both single-use password links:
//   purpose 'reset' — /reset-password/[token], emailed to the account's own address.
//   purpose 'setup' — /setup/[token], minted for a super admin / owner to hand over (new
//                     account, admin reset, approved reset request, username invitee).
//                     Replaces the old tokenless /set-password claim.
type Purpose = 'reset' | 'setup';

function parsePurpose(value: unknown): Purpose {
 return value === 'setup' ? 'setup' : 'reset';
}

export async function GET(request: NextRequest) {
 const token = String(request.nextUrl.searchParams.get('token') || '').trim();
 const purpose = parsePurpose(request.nextUrl.searchParams.get('purpose'));

 if (!token) {
  return NextResponse.json({ valid: false, error: 'Token is required.' }, { status: 400 });
 }

 const budget = await security.hit('tokenIp', security.getClientIp(request.headers));
 if (!budget.allowed) return tooManyRequests(budget.retryAfterSeconds);

 const { valid, identifier } = await authDb.validatePasswordResetToken(token, purpose);
 // The holder of a valid setup link is the intended user; showing which account they are
 // setting up (their username) is what lets them sign in afterwards.
 return NextResponse.json({ valid, identifier: valid && purpose === 'setup' ? identifier : undefined });
}

export async function POST(request: NextRequest) {
 const budget = await security.hit('tokenIp', security.getClientIp(request.headers));
 if (!budget.allowed) return tooManyRequests(budget.retryAfterSeconds);

 const parsed = await parseBody(request, resetPasswordSchema);
 if (parsed.response) return parsed.response;
 const purpose = parsePurpose(parsed.data.purpose);

 try {
  const result = await authDb.resetPasswordWithToken({ token: parsed.data.token, password: parsed.data.password, purpose });
  await security.logSecurityEvent({
   userId: result.userId,
   event: purpose === 'setup' ? 'password_setup' : 'password_reset',
   headers: request.headers,
  });
  // `identifier` lets the page sign the user straight in with the password they just chose.
  return NextResponse.json({ ok: true, identifier: result.email });
 } catch (error) {
  return errorResponse(error, 'Failed to reset password.', 400, 'auth/reset-password');
 }
}
