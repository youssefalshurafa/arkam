import { NextRequest, NextResponse } from 'next/server';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
 const token = request.nextUrl.searchParams.get('token');

 if (!token) {
  return NextResponse.json({ error: 'Token is required.' }, { status: 400 });
 }

 const record = await authDb.getEmailVerificationToken(token);

 if (!record) {
  return NextResponse.json({ error: 'Verification link is invalid or has expired.' }, { status: 400 });
 }

 return NextResponse.json({ ok: true, email: record.email, name: record.name });
}
