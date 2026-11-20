import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/server/auth-options';
import { getAppBaseUrl } from '@/server/app-url';
import { errorResponse, parseBody, tooManyRequests } from '@/server/http';
import { inviteCreateSchema } from '@/server/auth-schemas';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sendWorkspaceInviteEmail } = require('@/server/mailer');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const security = require('@/server/security');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = {
 params: Promise<{ workspaceId: string }>;
};

// Pending invitations of a workspace (owners/admins only).
export async function GET(_request: NextRequest, context: Context) {
 const session = await getServerSession(authOptions);
 const userId = session?.user?.id;
 if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 const { workspaceId } = await context.params;
 try {
  const invitations = await authDb.listWorkspaceInvitations({ workspaceId, userId });
  return NextResponse.json({ invitations });
 } catch (error) {
  return errorResponse(error, 'Failed to list invitations.', 403, 'workspaces/invitations');
 }
}

// Creates a single-use invitation link. The response is the same whether or not the
// identifier belongs to an existing account; the inviter always gets the link to share, and
// an email address also receives it by mail.
export async function POST(request: NextRequest, context: Context) {
 const session = await getServerSession(authOptions);
 const userId = session?.user?.id;
 if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 const { workspaceId } = await context.params;

 const parsed = await parseBody(request, inviteCreateSchema);
 if (parsed.response) return parsed.response;

 const budget = await security.hit('invitesWorkspace', workspaceId);
 if (!budget.allowed) return tooManyRequests(budget.retryAfterSeconds, 'Too many invitations today. Please try again tomorrow.');

 try {
  const invitation = await authDb.createWorkspaceInvitation({
   workspaceId,
   invitedByUserId: userId,
   identifier: parsed.data.identifier || parsed.data.email,
   name: parsed.data.name,
   role: parsed.data.role,
  });
  const inviteUrl = `${getAppBaseUrl()}/invite/${invitation.rawToken}`;

  let emailSent = false;
  if (invitation.emailable) {
   try {
    await sendWorkspaceInviteEmail({
     to: invitation.identifier,
     inviterName: invitation.inviterName,
     workspaceName: invitation.workspaceName,
     inviteUrl,
    });
    emailSent = true;
   } catch (mailError) {
    console.error('[workspaces/invitations] invite email failed:', mailError instanceof Error ? mailError.message : mailError);
   }
  }

  await security.logSecurityEvent({
   userId,
   event: 'invite_created',
   headers: request.headers,
   meta: { workspaceId, role: invitation.role, identifier: invitation.identifier },
  });
  return NextResponse.json({ ok: true, invitationId: invitation.id, inviteUrl, emailSent, expiresAt: invitation.expiresAt });
 } catch (error) {
  return errorResponse(error, 'Failed to create the invitation.', 400, 'workspaces/invitations');
 }
}

const revokeSchema = z.object({ invitationId: z.string().trim().min(1).max(64) });

export async function DELETE(request: NextRequest, context: Context) {
 const session = await getServerSession(authOptions);
 const userId = session?.user?.id;
 if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 const { workspaceId } = await context.params;

 const parsed = await parseBody(request, revokeSchema);
 if (parsed.response) return parsed.response;

 try {
  await authDb.revokeWorkspaceInvitation({ workspaceId, invitationId: parsed.data.invitationId, actorUserId: userId });
  return NextResponse.json({ ok: true });
 } catch (error) {
  return errorResponse(error, 'Failed to revoke the invitation.', 400, 'workspaces/invitations');
 }
}
