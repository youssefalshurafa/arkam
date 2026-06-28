import { NextRequest, NextResponse } from 'next/server';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sendVerificationEmail } = require('@/server/mailer');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RequestBody = {
 name?: string;
 email?: string;
 phone?: string;
 company?: string;
 country?: string;
};

export async function POST(request: NextRequest) {
 try {
  const body = (await request.json()) as RequestBody;
  const name = String(body.name || '').trim();
  const email = String(body.email || '')
   .trim()
   .toLowerCase();
  const phone = String(body.phone || '').trim();
  const company = String(body.company || '').trim();
  const country = String(body.country || '').trim();

  if (!name) {
   return NextResponse.json({ error: 'Full name is required.' }, { status: 400 });
  }

  if (!email) {
   return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
  }

  // Phone, company, and country are optional.

  // Always respond the same way whether the email exists or not (anti-enumeration)
  const { rawToken } = await authDb.createEmailVerificationToken({ email, name, phone, company, country });

  const verificationUrl = `${request.nextUrl.origin}/verify-email/${rawToken}`;
  await sendVerificationEmail({ to: email, name, verificationUrl });

  return NextResponse.json({ ok: true });
 } catch (error) {
  console.error('[signup/request] Error:', error);
  const message = error instanceof Error ? error.message : 'Failed to send verification email.';
  return NextResponse.json({ error: message }, { status: 400 });
 }
}
