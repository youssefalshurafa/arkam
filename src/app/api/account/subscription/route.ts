import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth-options';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
 const session = await getServerSession(authOptions);
 const userId = session?.user?.id;

 if (!userId) {
  return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
 }

 try {
  const info = await authDb.getUserAccountInfo(userId);
  return NextResponse.json(info);
 } catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to load account info.';
  return NextResponse.json({ error: message }, { status: 400 });
 }
}
