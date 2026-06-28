import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');

const providers: NextAuthOptions['providers'] = [
 CredentialsProvider({
  name: 'Credentials',
  credentials: {
   email: { label: 'Email', type: 'email' },
   password: { label: 'Password', type: 'password' },
  },
  async authorize(credentials) {
   const user = await authDb.verifyCredentials({
    email: credentials?.email,
    password: credentials?.password,
   });

   if (!user) {
    return null;
   }

   // Gate login on approval status. Throwing surfaces the code to the client
   // (LoginPage maps it to a localized message).
   if (user.status === 'pending') {
    throw new Error('PENDING_APPROVAL');
   }
   if (user.status === 'rejected') {
    throw new Error('ACCESS_REJECTED');
   }

   return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image || undefined,
   };
  },
 }),
];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
 providers.push(
  GoogleProvider({
   clientId: process.env.GOOGLE_CLIENT_ID,
   clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  }),
 );
}

export const authOptions: NextAuthOptions = {
 providers,
 session: {
  strategy: 'jwt',
 },
 pages: {
  signIn: '/login',
 },
 callbacks: {
  async jwt({ token, account, user }) {
   if (user?.id) {
    token.sub = user.id;
   }

   if (account?.provider === 'google' && token.email) {
    const dbUser = await authDb.upsertOAuthUser({
     email: token.email,
     name: token.name,
     image: token.picture,
    });
    token.sub = dbUser.id;
   }

   if (token.sub) {
    token.defaultWorkspaceId = await authDb.getDefaultWorkspaceIdByUserId(token.sub);
   }

   return token;
  },
  async session({ session, token }) {
   if (session.user && token.sub) {
    session.user.id = token.sub;
    session.user.defaultWorkspaceId = (token.defaultWorkspaceId as string | null) || null;
   }

   return session;
  },
 },
};
