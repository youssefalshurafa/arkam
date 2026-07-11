import { NextResponse } from 'next/server';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public endpoint: lists which homepage mockup slots have an uploaded screenshot,
// with each slot's updatedAt used to cache-bust the image URL. The image bytes
// themselves are served from /api/marketing-image/[slot]. Never returns the bytes.
export async function GET() {
 try {
  const rows: Array<{ slot: string; updatedAt: Date | string }> = await authDb.listMarketingAssets();
  const slots: Record<string, number> = {};
  for (const row of rows) {
   slots[row.slot] = new Date(row.updatedAt).getTime();
  }
  return NextResponse.json({ slots });
 } catch {
  // Marketing images are non-critical: on any error just report none, so the
  // homepage renders its CSS mockups instead of failing.
  return NextResponse.json({ slots: {} });
 }
}
