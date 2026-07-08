import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth-options';
import { isSuperAdmin, isAdminPanelUnlocked } from '@/server/permissions';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sendAccessApprovedEmail, sendAccessRejectedEmail } = require('@/server/mailer');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
 const session = await getServerSession(authOptions);

 if (!isSuperAdmin(session?.user?.email) || !isAdminPanelUnlocked(request)) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 }

 const status = request.nextUrl.searchParams.get('status') || undefined;
 const requests = await authDb.listAccessRequests({ status });
 return NextResponse.json({ requests });
}

export async function POST(request: NextRequest) {
 const session = await getServerSession(authOptions);

 if (!isSuperAdmin(session?.user?.email) || !isAdminPanelUnlocked(request)) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 }

 const { id, userId, action, note, days, durationDays } = (await request.json()) as {
  id?: string;
  userId?: string;
  action?: 'approve' | 'reject' | 'renew' | 'setDays';
  note?: string;
  days?: number;
  durationDays?: number;
 };

 try {
  // Renew/extend an existing user's subscription by one period — an explicit
  // durationDays (e.g. the user-detail page's 30/183/365-day quick buttons) overrides
  // the default of "whatever the user's most recent paid request was for".
  if (action === 'renew') {
   if (!userId) {
    return NextResponse.json({ error: 'userId is required to renew.' }, { status: 400 });
   }
   const result = await authDb.renewSubscription({ userId, durationDays });
   try {
    if (result.email) {
     await sendAccessApprovedEmail({
      to: result.email,
      name: result.name,
      loginUrl: `${request.nextUrl.origin}/login`,
     });
    }
   } catch (mailError) {
    console.error('[admin/access-requests] Renew notification failed:', mailError);
   }
   return NextResponse.json({ ok: true, status: 'approved', subscriptionEndsAt: result.endsAt });
  }

  // Manual override: set the subscription to expire in exactly `days` days from now.
  if (action === 'setDays') {
   if (!userId || typeof days !== 'number') {
    return NextResponse.json({ error: 'userId and days are required.' }, { status: 400 });
   }
   const result = await authDb.setSubscriptionDays({ userId, days });
   return NextResponse.json({ ok: true, status: 'approved', subscriptionEndsAt: result.endsAt });
  }

  if (!id || (action !== 'approve' && action !== 'reject')) {
   return NextResponse.json({ error: 'id and a valid action are required.' }, { status: 400 });
  }

  const result = await authDb.reviewAccessRequest({
   id,
   action,
   reviewerUserId: session?.user?.id,
   note,
  });

  // Notify the requester (best-effort).
  try {
   if (result.email) {
    if (action === 'approve') {
     await sendAccessApprovedEmail({
      to: result.email,
      name: result.name,
      loginUrl: `${request.nextUrl.origin}/login`,
     });
    } else {
     await sendAccessRejectedEmail({ to: result.email, name: result.name, note });
    }
   }
  } catch (mailError) {
   console.error('[admin/access-requests] Notification failed:', mailError);
  }

  return NextResponse.json({ ok: true, status: result.status });
 } catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to review request.';
  return NextResponse.json({ error: message }, { status: 400 });
 }
}
