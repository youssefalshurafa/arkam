import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth-options';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Client-side activity beacon: records app-open and section-visit telemetry for the
// super-admin usage view. Best-effort and non-blocking — the client fires this
// fire-and-forget, so failures are swallowed and never surfaced to the user.
const CLIENT_EVENT_TYPES = new Set(['app_open', 'section_visit']);

export async function POST(request: NextRequest) {
 const session = await getServerSession(authOptions);
 const userId = session?.user?.id;
 if (!userId) {
  // No session — silently ignore (nothing to attribute the event to).
  return new NextResponse(null, { status: 204 });
 }

 let body: { eventType?: string; section?: string } = {};
 try {
  body = (await request.json()) as { eventType?: string; section?: string };
 } catch {
  return NextResponse.json({ ok: true });
 }

 const { eventType, section } = body;
 if (!eventType || !CLIENT_EVENT_TYPES.has(eventType)) {
  return NextResponse.json({ ok: true });
 }

 const workspaceId = request.headers.get('x-workspace-id') || null;

 try {
  await authDb.recordActivityEvent({
   userId,
   workspaceId,
   eventType,
   section: eventType === 'section_visit' ? section || null : null,
  });
 } catch {
  // Telemetry is best-effort; never surface a failure.
 }

 return NextResponse.json({ ok: true });
}
