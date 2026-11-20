import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/server/auth-options';
import { getAppBaseUrl } from '@/server/app-url';
import { errorResponse, parseBody } from '@/server/http';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const verification = require('@/server/email-verification');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mailer = require('@/server/mailer');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ pendingId: z.string().trim().min(1).max(64) });

export async function POST(request: NextRequest) {
 const session = await getServerSession(authOptions);
 const userId = session?.user?.id;
 if (!userId) {
  return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
 }

 const parsed = await parseBody(request, schema);
 if (parsed.response) return parsed.response;

 try {
  const result = await verification.resendCode({ pendingId: parsed.data.pendingId, userId });
  if (result.decoy) {
   const base = getAppBaseUrl();
   await mailer.sendAlreadyRegisteredEmail({ to: result.email, loginUrl: `${base}/login`, forgotUrl: `${base}/forgot-password` });
  } else {
   await mailer.sendVerificationCodeEmail({ to: result.email, name: result.name, code: result.code, purpose: result.purpose });
  }
  return NextResponse.json({ ok: true });
 } catch (error) {
  return errorResponse(error, 'Failed to resend the code.', 400, 'account/email/resend');
 }
}
