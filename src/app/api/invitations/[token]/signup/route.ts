import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse, parseBody, tooManyRequests } from '@/server/http';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const security = require('@/server/security');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = {
 params: Promise<{ token: string }>;
};

const schema = z.object({
 name: z.string().trim().max(120).optional(),
 username: z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/, 'Usernames are 3–32 characters: letters, numbers, dot, dash or underscore.'),
 password: z.string().min(1, 'Password is required.').max(256),
 phone: z.string().trim().max(40).optional(),
});

// Invite-only username account (for teammates without an email address). The single-use
// invitation link is the authorization; the account joins the inviting workspace directly.
export async function POST(request: NextRequest, context: Context) {
 const budget = await security.hit('signupIp', security.getClientIp(request.headers));
 if (!budget.allowed) return tooManyRequests(budget.retryAfterSeconds);

 const { token } = await context.params;
 const parsed = await parseBody(request, schema);
 if (parsed.response) return parsed.response;

 try {
  const result = await authDb.createAccountFromInvitation({ rawToken: token, ...parsed.data });
  await security.logSecurityEvent({
   userId: result.userId,
   identifier: result.username,
   event: 'signup',
   headers: request.headers,
   meta: { via: 'invitation', workspaceId: result.workspaceId },
  });
  return NextResponse.json({ ok: true, username: result.username });
 } catch (error) {
  return errorResponse(error, 'Failed to create the account.', 400, 'invitations/signup');
 }
}
