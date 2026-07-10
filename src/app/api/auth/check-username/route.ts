import { NextRequest, NextResponse } from 'next/server';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public: reports whether a username/email is still free, so the signup form can
// warn about a collision before submit. Returns { available } (true when unused);
// an empty value is reported as unavailable so the caller shows nothing useful yet.
export async function GET(request: NextRequest) {
 const value = request.nextUrl.searchParams.get('value')?.trim() || '';
 if (!value) {
  return NextResponse.json({ available: false });
 }

 try {
  const existing = await authDb.getUserByEmail(value);
  return NextResponse.json({ available: !existing });
 } catch {
  // On a lookup failure, don't block signup — let the server-side uniqueness
  // check at submit time be the source of truth.
  return NextResponse.json({ available: true });
 }
}
