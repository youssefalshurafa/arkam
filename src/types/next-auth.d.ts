import NextAuth from 'next-auth';

declare module 'next-auth' {
 interface Session {
  user: {
   id: string;
   name?: string | null;
   email?: string | null;
   image?: string | null;
   defaultWorkspaceId?: string | null;
   isSuperAdmin?: boolean;
   aiEnabled?: boolean;
   mfaEnabled?: boolean;
  };
 }

 interface User {
  id: string;
  defaultWorkspaceId?: string | null;
  sessionVersion?: number;
  remember?: boolean;
  mfaEnabled?: boolean;
 }
}

declare module 'next-auth/jwt' {
 interface JWT {
  defaultWorkspaceId?: string | null;
  aiEnabled?: boolean;
  // users.session_version this token was minted with; a mismatch on refresh revokes it.
  sv?: number;
  // Sign-in time (ms) and the "Keep me signed in" choice — see SHORT_SESSION_MS.
  loginAt?: number;
  remember?: boolean;
  mfaEnabled?: boolean;
  claimsRefreshedAt?: number;
 }
}
