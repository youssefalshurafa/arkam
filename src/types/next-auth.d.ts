import NextAuth from 'next-auth';

declare module 'next-auth' {
 interface Session {
  user: {
   id: string;
   name?: string | null;
   email?: string | null;
   image?: string | null;
   defaultWorkspaceId?: string | null;
  };
 }

 interface User {
  id: string;
  defaultWorkspaceId?: string | null;
 }
}

declare module 'next-auth/jwt' {
 interface JWT {
  defaultWorkspaceId?: string | null;
 }
}
