import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import { isSuperAdmin } from '@/server/permissions';
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
   // A null subscriptionEndsAt means no expiry gate applies (e.g. an admin-created
   // account with indefinite access) — only block once a real window has lapsed.
   if (user.subscriptionEndsAt && new Date(user.subscriptionEndsAt).getTime() < Date.now()) {
    throw new Error('SUBSCRIPTION_EXPIRED');
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
  // Runs before the jwt callback, on every OAuth sign-in — this is the only place
  // that can actually reject an OAuth login (jwt/session run after the session
  // already exists). Credentials logins are gated in authorize() above instead.
  async signIn({ account, profile }) {
   if (account?.provider === 'google') {
    const email = (profile as { email?: string } | undefined)?.email;
    if (!email) {
     return false;
    }
    const dbUser = await authDb.upsertOAuthUser({
     email,
     name: profile?.name,
     image: (profile as { picture?: string } | undefined)?.picture,
    });
    if (dbUser.status === 'pending') {
     return '/login?authError=PENDING_APPROVAL';
    }
    if (dbUser.status === 'rejected') {
     return '/login?authError=ACCESS_REJECTED';
    }
    if (dbUser.subscriptionEndsAt && new Date(dbUser.subscriptionEndsAt).getTime() < Date.now()) {
     return '/login?authError=SUBSCRIPTION_EXPIRED';
    }
   }
   return true;
  },
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
    session.user.isSuperAdmin = isSuperAdmin(session.user.email);
   }

   return session;
  },
 },
 events: {
  // Records a login event for the super-admin activity view. Fires after a successful
  // sign-in for both Credentials and Google. Best-effort — a telemetry failure must never
  // block or break the login itself.
  async signIn({ user }) {
   if (user?.id) {
    try {
     await authDb.recordActivityEvent({ userId: user.id, eventType: 'login' });
    } catch {}
   }
  },
 },
};
