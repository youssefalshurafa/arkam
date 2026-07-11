import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth-options';
import { isSuperAdmin, isAdminPanelUnlocked } from '@/server/permissions';
import { isMarketingSlot } from '@/config/marketing';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

async function requireSuperAdmin(request: NextRequest) {
 const session = await getServerSession(authOptions);
 if (!isSuperAdmin(session?.user?.email) || !isAdminPanelUnlocked(request)) {
  return false;
 }
 return true;
}

// Uploads / replaces the screenshot for one homepage mockup slot. Super-admin only.
export async function POST(request: NextRequest) {
 if (!(await requireSuperAdmin(request))) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 }

 try {
  const formData = await request.formData();
  const slot = String(formData.get('slot') || '').trim();
  const file = formData.get('file');

  if (!isMarketingSlot(slot)) {
   return NextResponse.json({ error: 'Unknown image slot.' }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
   return NextResponse.json({ error: 'An image file is required.' }, { status: 400 });
  }
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
   return NextResponse.json({ error: 'Image must be a PNG, JPG, or WEBP.' }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_BYTES) {
   return NextResponse.json({ error: 'Image must be 5MB or smaller.' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  await authDb.saveMarketingAsset({ slot, mime: file.type, buffer });

  return NextResponse.json({ ok: true, slot, updatedAt: Date.now() });
 } catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to save image.';
  return NextResponse.json({ error: message }, { status: 400 });
 }
}

// Clears the screenshot for one slot, reverting the homepage to its CSS mockup.
export async function DELETE(request: NextRequest) {
 if (!(await requireSuperAdmin(request))) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 }

 try {
  const slot = String(request.nextUrl.searchParams.get('slot') || '').trim();
  if (!isMarketingSlot(slot)) {
   return NextResponse.json({ error: 'Unknown image slot.' }, { status: 400 });
  }
  await authDb.deleteMarketingAsset(slot);
  return NextResponse.json({ ok: true, slot });
 } catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to remove image.';
  return NextResponse.json({ error: message }, { status: 400 });
 }
}
