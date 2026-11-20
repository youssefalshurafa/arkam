import { NextRequest, NextResponse } from 'next/server';
import { getPaymentConfig, getPlanTier, getTierAmountLabel } from '@/config/plan';
import { getAppBaseUrl } from '@/server/app-url';
import { sniffImageMime, tooManyRequests } from '@/server/http';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sendAccessRequestNotification } = require('@/server/mailer');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const security = require('@/server/security');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PROOF_BYTES = 5 * 1024 * 1024; // 5MB

// Public counterpart of /api/account/renew for a user who has been signed out and
// blocked because their subscription/trial lapsed — they have no session to
// authenticate with, so the request is identified by email/username instead.
//
// Answers the same "received" whether or not the account exists (the old 404 "No account
// found" turned it into an account-existence oracle), is rate-limited per IP and per
// identifier, and checks the screenshot's real bytes rather than the declared type.
export async function POST(request: NextRequest) {
 const ip = security.getClientIp(request.headers);
 const byIp = await security.hit('recoveryIp', ip);
 if (!byIp.allowed) return tooManyRequests(byIp.retryAfterSeconds);

 let formData: FormData;
 try {
  formData = await request.formData();
 } catch {
  return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
 }

 const identifier = String(formData.get('email') || '').trim().toLowerCase().slice(0, 254);
 const planId = String(formData.get('plan') || '').trim().slice(0, 40);
 const txReference = String(formData.get('txReference') || '').trim().slice(0, 200);
 const screenshot = formData.get('screenshot');

 if (!identifier) {
  return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
 }
 if (!(screenshot instanceof File) || screenshot.size === 0) {
  return NextResponse.json({ error: 'A payment screenshot is required.' }, { status: 400 });
 }
 if (screenshot.size > MAX_PROOF_BYTES) {
  return NextResponse.json({ error: 'Screenshot must be 5MB or smaller.' }, { status: 400 });
 }
 const proofBuffer = Buffer.from(await screenshot.arrayBuffer());
 const proofMime = sniffImageMime(proofBuffer);
 if (!proofMime) {
  return NextResponse.json({ error: 'Screenshot must be a PNG, JPG, or WEBP image.' }, { status: 400 });
 }

 const byIdentifier = await security.hit('recoveryIdentifier', `renew:${identifier}`);
 if (!byIdentifier.allowed) {
  return NextResponse.json({ ok: true });
 }

 try {
  const user = await authDb.getUserByEmail(identifier);
  if (!user) {
   await security.logSecurityEvent({ identifier, event: 'renew_unknown_identifier', headers: request.headers });
   return NextResponse.json({ ok: true });
  }

  const { network } = getPaymentConfig();
  const tier = getPlanTier(planId);
  const amount = getTierAmountLabel(tier);

  await authDb.createRenewalRequest({
   userId: user.id,
   plan: tier.name,
   amount,
   network,
   durationDays: tier.durationDays,
   txReference,
   proofMime,
   proofBuffer,
  });

  const adminEmail = process.env.ADMIN_NOTIFY_EMAIL?.trim() || process.env.SUPER_ADMIN_EMAIL?.trim();
  if (adminEmail) {
   await sendAccessRequestNotification({
    to: adminEmail,
    requesterName: user.name || '',
    requesterEmail: user.email || '',
    plan: `${tier.name} (renewal)`,
    amount,
    reviewUrl: `${getAppBaseUrl()}/admin/requests`,
   }).catch((mailError: unknown) => console.error('[auth/renew-request] Admin notification failed:', mailError));
  }
 } catch (error) {
  console.error('[auth/renew-request] failed:', error instanceof Error ? error.message : error);
 }

 return NextResponse.json({ ok: true });
}
