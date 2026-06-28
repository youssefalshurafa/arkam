import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth-options';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isSuperAdmin(email: string | null | undefined): boolean {
 const superAdminEmail = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
 if (!superAdminEmail || !email) {
  return false;
 }
 return email.trim().toLowerCase() === superAdminEmail;
}

// Serves the raw payment screenshot bytes for one request. Super-admin only —
// these images can contain sensitive financial data.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
 const session = await getServerSession(authOptions);

 if (!isSuperAdmin(session?.user?.email)) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 }

 const { id } = await params;
 const proof = await authDb.getAccessRequestProof(id);

 if (!proof?.proofData) {
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
 }

 const body = Buffer.isBuffer(proof.proofData) ? proof.proofData : Buffer.from(proof.proofData);

 return new NextResponse(new Uint8Array(body), {
  status: 200,
  headers: {
   'Content-Type': proof.proofMime || 'application/octet-stream',
   'Cache-Control': 'private, no-store',
  },
 });
}
