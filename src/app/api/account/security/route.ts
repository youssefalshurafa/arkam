import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import QRCode from 'qrcode';
import { authOptions } from '@/server/auth-options';
import { reissueSessionCookie } from '@/server/session-cookie';
import { errorResponse, parseBody, tooManyRequests } from '@/server/http';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mfa = require('@/server/mfa');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const security = require('@/server/security');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mailer = require('@/server/mailer');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { verifyPassword } = require('@/server/passwords');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Settings -> Account -> Security: two-factor enrollment/removal, backup codes, sign-out-
// everywhere, and the user's recent security activity.

export async function GET() {
 const session = await getServerSession(authOptions);
 const userId = session?.user?.id;
 if (!userId) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

 const [mfaState, events] = await Promise.all([mfa.getMfaState(userId), security.listSecurityEventsForUser(userId, { limit: 15 })]);
 return NextResponse.json({
  mfa: { enabled: mfaState.enabled, enabledAt: mfaState.enabledAt, backupCodesLeft: mfaState.backupCodesLeft },
  events,
 });
}

const password = z.string().max(256).optional();
const code = z.string().trim().max(32);

const schema = z.discriminatedUnion('action', [
 z.object({ action: z.literal('mfa_start'), password }),
 z.object({ action: z.literal('mfa_confirm'), code }),
 z.object({ action: z.literal('mfa_disable'), password, code }),
 z.object({ action: z.literal('backup_codes'), code }),
 z.object({ action: z.literal('revoke_sessions'), password }),
]);

// Re-authentication for sensitive changes: the current password when the account has one.
// Passwordless (Google-only) accounts have nothing to re-enter, so the session itself is
// the proof (their identity is Google's to protect).
async function reauthenticate(userId: string, supplied: string | undefined): Promise<string | null> {
 const hash = await authDb.getPasswordHash(userId);
 if (!hash) return null;
 if (!supplied) return 'Enter your current password.';
 if (!(await verifyPassword(supplied, hash))) return 'Current password is incorrect.';
 return null;
}

function notify(email: string | null | undefined, name: string | null | undefined, heading: string, message: string) {
 if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
 mailer.sendSecurityNoticeEmail({ to: email, name, heading, message }).catch(() => {});
}

export async function POST(request: NextRequest) {
 const session = await getServerSession(authOptions);
 const userId = session?.user?.id;
 if (!userId) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

 const parsed = await parseBody(request, schema);
 if (parsed.response) return parsed.response;
 const body = parsed.data;

 const budget = await security.hit('reauth', `security:${userId}`);
 if (!budget.allowed) return tooManyRequests(budget.retryAfterSeconds);

 const headers = request.headers;
 const email = session.user.email;
 const name = session.user.name;

 try {
  switch (body.action) {
   case 'mfa_start': {
    const problem = await reauthenticate(userId, body.password);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    const { secret, uri } = await mfa.startEnrollment({ userId, accountLabel: email || name || 'account' });
    const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
    return NextResponse.json({ ok: true, secret, uri, qrDataUrl });
   }

   case 'mfa_confirm': {
    const { backupCodes } = await mfa.confirmEnrollment({ userId, code: body.code });
    await security.logSecurityEvent({ userId, event: 'mfa_enabled', headers });
    notify(email, name, 'Two-factor authentication is on', 'Two-factor authentication was turned on for your Arkam account. Signing in now also needs a code from your authenticator app.');
    // The mfaEnabled claim gates the admin panel; refresh it on this device straight away.
    const response = NextResponse.json({ ok: true, backupCodes });
    await reissueSessionCookie(request, response, { mfaEnabled: true });
    return response;
   }

   case 'mfa_disable': {
    const problem = await reauthenticate(userId, body.password);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    const check = await mfa.verifyCode({ userId, code: body.code });
    if (!check.ok) {
     await security.logSecurityEvent({ userId, event: 'mfa_failed', headers, meta: { for: 'disable' } });
     return NextResponse.json({ error: 'That code is not correct.' }, { status: 400 });
    }
    await mfa.disableMfa({ userId });
    await security.logSecurityEvent({ userId, event: 'mfa_disabled', headers });
    notify(email, name, 'Two-factor authentication was turned off', 'Two-factor authentication was turned off for your Arkam account.');
    const response = NextResponse.json({ ok: true });
    await reissueSessionCookie(request, response, { mfaEnabled: false });
    return response;
   }

   case 'backup_codes': {
    const check = await mfa.verifyCode({ userId, code: body.code });
    if (!check.ok) {
     return NextResponse.json({ error: 'That code is not correct.' }, { status: 400 });
    }
    const backupCodes = await mfa.regenerateBackupCodes({ userId });
    await security.logSecurityEvent({ userId, event: 'mfa_backup_codes_regenerated', headers });
    return NextResponse.json({ ok: true, backupCodes });
   }

   case 'revoke_sessions': {
    const problem = await reauthenticate(userId, body.password);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    const sv = await authDb.bumpSessionVersion(userId);
    await security.logSecurityEvent({ userId, event: 'sessions_revoked', headers });
    // Every other device drops on its next claims refresh; this one is re-minted.
    const response = NextResponse.json({ ok: true });
    await reissueSessionCookie(request, response, { sv });
    return response;
   }
  }
 } catch (error) {
  return errorResponse(error, 'Request failed.', 400, 'account/security');
 }
}
