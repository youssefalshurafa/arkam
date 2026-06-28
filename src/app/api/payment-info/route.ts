import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { PLAN_TIERS, getPaymentConfig, getTierAmountLabel } from '@/config/plan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public endpoint: USDT payment instructions, a server-rendered QR for the wallet
// address, and the list of selectable pricing tiers. The address lives in server
// env so it never ships in the client bundle.
export async function GET() {
 const { address, network } = getPaymentConfig();

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
  configured: Boolean(address),
  qrDataUrl,
  tiers: PLAN_TIERS.map((tier) => ({
   id: tier.id,
   name: tier.name,
   priceUsdt: tier.priceUsdt,
   originalUsdt: tier.originalUsdt ?? null,
   period: tier.period,
   amount: getTierAmountLabel(tier),
  })),
 });
}
