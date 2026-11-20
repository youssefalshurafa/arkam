import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth-options';
import { ADMIN_UNLOCK_COOKIE, isSuperAdmin, verifyAdminUnlockToken } from '@/server/permissions';
import AdminUnlockGate from './AdminUnlockGate';
import AdminMfaRequired from './AdminMfaRequired';
import AdminShell from './_ui/AdminShell';

// Second, independent gate in front of both admin pages (/admin, /admin/users/[id]) —
// on top of the isSuperAdmin user-id check, the super-admin also needs a separate panel
// password. Runs server-side so the admin page's data/components never mount until the
// password is verified, not just hidden behind a client-side overlay. Non-super-admins
// pass straight through unchanged — they still hit the existing per-page "Access Denied"
// screen driven by the API routes' 403s; this gate only adds friction for the real admin.
export default async function AdminLayout({ children }: { children: ReactNode }) {
 const session = await getServerSession(authOptions);

 if (!isSuperAdmin(session?.user?.id)) {
  return <>{children}</>;
 }

 // Two-factor is mandatory for the super-admin account: the panel stays shut (and every
 // /api/admin/* route 403s) until it is turned on in Settings → Account → Security.
 if (!session?.user?.mfaEnabled) {
  return <AdminMfaRequired />;
 }

 const cookieStore = await cookies();
 const unlocked = verifyAdminUnlockToken(cookieStore.get(ADMIN_UNLOCK_COOKIE)?.value, session?.user?.id);

 if (!unlocked) {
  return <AdminUnlockGate />;
 }

 // Unlocked super-admin: render the full panel chrome (sidebar, topbar, theme,
 // language) around every /admin/* route.
 return <AdminShell>{children}</AdminShell>;
}
