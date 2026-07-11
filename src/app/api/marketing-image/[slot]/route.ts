import { NextRequest, NextResponse } from 'next/server';
import { isMarketingSlot } from '@/config/marketing';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public endpoint: streams the raw screenshot bytes for one homepage mockup slot.
// These are marketing images shown on the public landing page, so they are cached
// publicly. 404 when a slot has no image (the homepage then uses its CSS mockup).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ slot: string }> }) {
 const { slot } = await params;

 if (!isMarketingSlot(slot)) {
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
 }

 const asset = await authDb.getMarketingAsset(slot);
 if (!asset?.data) {
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
 }

 const body = Buffer.isBuffer(asset.data) ? asset.data : Buffer.from(asset.data);

 return new NextResponse(new Uint8Array(body), {
  status: 200,
  headers: {
   'Content-Type': asset.mime || 'application/octet-stream',
   // Public marketing asset; allow CDN/browser caching. Callers cache-bust via
   // the ?v=<updatedAt> query param from /api/marketing-images.
   'Cache-Control': 'public, max-age=300, s-maxage=3600',
  },
 });
}
