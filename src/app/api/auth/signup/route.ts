import { NextRequest, NextResponse } from 'next/server';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SignupBody = {
 name?: string;
 email?: string;
 password?: string;
 workspaceName?: string;
};

export async function POST(request: NextRequest) {
 try {
  const body = (await request.json()) as SignupBody;

  const user = await authDb.createCredentialsUser({
   name: body.name,
   email: body.email,
   password: body.password,
   workspaceName: body.workspaceName,
  });

  const defaultWorkspaceId = await authDb.getDefaultWorkspaceIdByUserId(user.id);

  return NextResponse.json({
   ok: true,
   user: {
    id: user.id,
    email: user.email,
    name: user.name,
   },
   defaultWorkspaceId,
  });
 } catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to sign up.';
  return NextResponse.json({ error: message }, { status: 400 });
 }
}
