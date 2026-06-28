import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth-options';
import { getPaymentConfig, getPlanTier, getTierAmountLabel } from '@/config/plan';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sendAccessRequestNotification } = require('@/server/mailer');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PROOF_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_PROOF_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

// Self-service renewal: a logged-in user submits another payment screenshot for a
// chosen tier. Creates a pending request; the super admin's approval extends the
// subscription. The user's current access is untouched until then.
export async function POST(request: NextRequest) {
 const session = await getServerSession(authOptions);
 const userId = session?.user?.id;

 if (!userId) {
  return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
 }

 try {
  const formData = await request.formData();
  const planId = String(formData.get('plan') || '').trim();
  const txReference = String(formData.get('txReference') || '').trim();
  const screenshot = formData.get('screenshot');

  if (!(screenshot instanceof File) || screenshot.size === 0) {
   return NextResponse.json({ error: 'A payment screenshot is required.' }, { status: 400 });
  }
  if (!ALLOWED_PROOF_TYPES.has(screenshot.type)) {
   return NextResponse.json({ error: 'Screenshot must be a PNG, JPG, or WEBP image.' }, { status: 400 });
  }
  if (screenshot.size > MAX_PROOF_BYTES) {
   return NextResponse.json({ error: 'Screenshot must be 5MB or smaller.' }, { status: 400 });
  }

  const proofBuffer = Buffer.from(await screenshot.arrayBuffer());
  const { network } = getPaymentConfig();
  const tier = getPlanTier(planId);
  const amount = getTierAmountLabel(tier);

  await authDb.createRenewalRequest({
   userId,
   plan: tier.name,
   amount,
   network,
   durationDays: tier.durationDays,
   txReference,
   proofMime: screenshot.type,
   proofBuffer,
  });

  // Notify the admin (best-effort).
  try {
   const adminEmail = process.env.ADMIN_NOTIFY_EMAIL?.trim() || process.env.SUPER_ADMIN_EMAIL?.trim();
   if (adminEmail) {
    await sendAccessRequestNotification({
     to: adminEmail,
     requesterName: session.user?.name || '',
     requesterEmail: session.user?.email || '',
     plan: `${tier.name} (renewal)`,
     amount,
     reviewUrl: `${request.nextUrl.origin}/admin`,
    });
   }
  } catch (mailError) {
   console.error('[account/renew] Admin notification failed:', mailError);
  }

  return NextResponse.json({ ok: true });
 } catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to submit renewal.';
  return NextResponse.json({ error: message }, { status: 400 });
 }
}
