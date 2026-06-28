import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { APP_PLAN, getPaymentConfig } from '@/config/plan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public endpoint that returns the USDT payment instructions plus a server-rendered
// QR code (data URL) for the wallet address. The address lives in server env, so it
// never ships in the client bundle.
export async function GET() {
 const { address, network, amount, plan } = getPaymentConfig();

 let qrDataUrl = '';
 if (address) {
  try {
   qrDataUrl = await QRCode.toDataURL(address, { margin: 1, width: 256 });
  } catch {
   qrDataUrl = '';
  }
 }

 return NextResponse.json({
  address,
  network,
  amount,
  plan,
  planName: APP_PLAN.name,
  configured: Boolean(address),
  qrDataUrl,
 });
}
