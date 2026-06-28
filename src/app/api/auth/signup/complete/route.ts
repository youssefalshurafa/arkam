import { NextRequest, NextResponse } from 'next/server';
import { getPaymentConfig, getPlanTier, getTierAmountLabel } from '@/config/plan';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sendAccessRequestNotification } = require('@/server/mailer');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PROOF_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_PROOF_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

// Finishes signup: validates the email-verification token, sets the password,
// stores the uploaded payment screenshot, creates the user as 'pending', and
// notifies the admin. The account is NOT logged in — it awaits approval.
export async function POST(request: NextRequest) {
 try {
  const formData = await request.formData();
  const token = String(formData.get('token') || '').trim();
  const password = String(formData.get('password') || '');
  const planId = String(formData.get('plan') || '').trim();
  const txReference = String(formData.get('txReference') || '').trim();
  const screenshot = formData.get('screenshot');

  if (!token) {
   return NextResponse.json({ error: 'Verification token is required.' }, { status: 400 });
  }

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

  const user = await authDb.consumeEmailVerificationAndCreatePendingUser({
   rawToken: token,
   password,
   plan: tier.name,
   amount,
   network,
   durationDays: tier.durationDays,
   txReference,
   proofMime: screenshot.type,
   proofBuffer,
  });

  // Notify the admin (best-effort: a mail failure shouldn't void the request).
  try {
   const adminEmail =
    process.env.ADMIN_NOTIFY_EMAIL?.trim() || process.env.SUPER_ADMIN_EMAIL?.trim();
   if (adminEmail) {
    await sendAccessRequestNotification({
     to: adminEmail,
     requesterName: user.name,
     requesterEmail: user.email,
     plan: tier.name,
     amount,
     reviewUrl: `${request.nextUrl.origin}/admin`,
    });
   }
  } catch (mailError) {
   console.error('[signup/complete] Admin notification failed:', mailError);
  }

  return NextResponse.json({ ok: true });
 } catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to submit your request.';
  return NextResponse.json({ error: message }, { status: 400 });
 }
}
