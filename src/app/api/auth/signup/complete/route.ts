import { NextRequest, NextResponse } from 'next/server';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CompleteBody = {
 token?: string;
 password?: string;
};

export async function POST(request: NextRequest) {
 try {
  const body = (await request.json()) as CompleteBody;
  const token = String(body.token || '').trim();
  const password = String(body.password || '');

  if (!token) {
   return NextResponse.json({ error: 'Verification token is required.' }, { status: 400 });
  }

  const user = await authDb.consumeEmailVerificationAndCreateUser({ rawToken: token, password });

  const defaultWorkspaceId = await authDb.getDefaultWorkspaceIdByUserId(user.id);

  return NextResponse.json({
   ok: true,
   user: { id: user.id, email: user.email, name: user.name },
   defaultWorkspaceId,
  });
 } catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to create account.';
  return NextResponse.json({ error: message }, { status: 400 });
 }
}
