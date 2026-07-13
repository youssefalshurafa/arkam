import { NextRequest, NextResponse } from 'next/server';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CheckUserBody = {
 identifier?: string;
};

// Live lookup for the forgot-password screen: tells the client whether an account exists for the
// entered email/username, and whether that account has a deliverable email (username-only accounts
// don't, and must be routed to the support-approval /reset-request flow). This intentionally reveals
// account existence so the user gets immediate "no account found" feedback — a deliberate UX trade
// against username enumeration on this product.
export async function POST(request: NextRequest) {
 try {
  const body = (await request.json()) as CheckUserBody;
  const identifier = String(body.identifier || '').trim();

  if (!identifier) {
   return NextResponse.json({ exists: false, emailable: false });
  }

  const result = await authDb.lookupResetTarget(identifier);
  return NextResponse.json({ exists: Boolean(result.exists), emailable: Boolean(result.emailable) });
 } catch (error) {
  console.error('[auth/check-user] Error:', error);
  return NextResponse.json({ error: 'Failed to check account.' }, { status: 400 });
 }
}
