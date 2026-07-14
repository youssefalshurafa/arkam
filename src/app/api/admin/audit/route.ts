import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth-options';
import { isSuperAdmin, isAdminPanelUnlocked } from '@/server/permissions';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Super-admin audit feed: admin actions merged with recent login events, newest first.
export async function GET(request: NextRequest) {
 const session = await getServerSession(authOptions);

 if (!isSuperAdmin(session?.user?.email) || !isAdminPanelUnlocked(request)) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 }

 const limit = Number(request.nextUrl.searchParams.get('limit')) || 150;
 const events = await authDb.listAdminAudit({ limit });
 return NextResponse.json({ events });
}
