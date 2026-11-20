import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import { isSuperAdmin } from '@/server/permissions';
import { CLAIMS_TTL_MS, SESSION_MAX_AGE_SECONDS, SHORT_SESSION_MS, isSubscriptionExpired } from '@/server/session-policy';
import { getAppBaseUrl } from '@/server/app-url';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mailer = require('@/server/mailer');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const security = require('@/server/security');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mfa = require('@/server/mfa');

// Thrown from the jwt callback to kill a session. next-auth v4 catches errors there, clears
// the session cookie and reports no session (core/routes/session.js), so getServerSession()
// returns null on the server and useSession() flips to unauthenticated on the client.
class SessionRevokedError extends Error {
 constructor(reason: string) {
  super(`SESSION_REVOKED:${reason}`);
 }
}

type GoogleProfile = { email?: string; email_verified?: boolean; name?: string; picture?: string };
type Headers = Record<string, unknown> | undefined;
type AuthUser = {
 id: string;
 email: string;
 name: string;
 image: string | null;
 status: string;
 subscriptionEndsAt: string | null;
 sessionVersion: number;
 mfaEnabled: boolean;
};

// Status/expiry gate shared by every sign-in path. Throwing surfaces the code to the client
// (LoginPage maps it to a localized message). Only ever reached AFTER the password/Google
// identity is proven, so these codes don't help anyone guessing passwords.
function assertCanSignIn(user: AuthUser) {
 if (user.status === 'pending') throw new Error('PENDING_APPROVAL');
 if (user.status === 'rejected') throw new Error('ACCESS_REJECTED');
 // A null subscriptionEndsAt means no expiry gate applies (e.g. an admin-created account
 // with indefinite access) — only block once a real window has lapsed.
 if (isSubscriptionExpired(user.subscriptionEndsAt)) throw new Error('SUBSCRIPTION_EXPIRED');
}

// Second factor for a user who has it on. `otp` may be a 6-digit code or a backup code.
async function assertSecondFactor(user: AuthUser, otp: string | undefined, headers: Headers) {
 if (!user.mfaEnabled) return;
 if (!otp) throw new Error('MFA_REQUIRED');
 const budget = await security.hit('mfa', user.id);
 if (!budget.allowed) {
  await security.logSecurityEvent({ userId: user.id, event: 'mfa_locked', headers });
  throw new Error('MFA_LOCKED');
 }
 const result = await mfa.verifyCode({ userId: user.id, code: otp });
 if (!result.ok) {
  await security.logSecurityEvent({ userId: user.id, event: 'mfa_failed', headers });
  throw new Error('MFA_INVALID');
 }
 if (result.usedBackupCode) {
  await security.logSecurityEvent({ userId: user.id, event: 'mfa_backup_code_used', headers });
 }
}

function toSessionUser(user: AuthUser, remember: boolean) {
 return {
  id: user.id,
  email: user.email,
  name: user.name,
  image: user.image || undefined,
  sessionVersion: user.sessionVersion,
  mfaEnabled: user.mfaEnabled,
  remember,
 };
}

const providers: NextAuthOptions['providers'] = [
 CredentialsProvider({
  id: 'credentials',
  name: 'Credentials',
  credentials: {
   email: { label: 'Email or username', type: 'text' },
   password: { label: 'Password', type: 'password' },
   otp: { label: 'Authentication code', type: 'text' },
   remember: { label: 'Keep me signed in', type: 'text' },
  },
  async authorize(credentials, req) {
   const identifier = String(credentials?.email || '').trim().toLowerCase();
   const password = credentials?.password;
   const headers = req?.headers as Headers;
   if (!identifier || !password) return null;

   // Brute-force throttling. Every attempt counts against the IP; only FAILED attempts count
   // against the (identifier, IP) pair and the identifier overall.
   const ip = security.getClientIp(headers);
   const pairKey = `loginPair:${identifier}|${ip}`;
   const identifierKey = `loginIdentifier:${identifier}`;
   const [ipBudget, pair, overall] = await Promise.all([
    security.hit('loginIp', ip),
    security.peekRateLimit(pairKey, security.LIMITS.loginPair),
    security.peekRateLimit(identifierKey, security.LIMITS.loginIdentifier),
   ]);
   const pairLocked = pair.count >= security.LIMITS.loginPair.limit;
   const overallLocked = overall.count >= security.LIMITS.loginIdentifier.limit;
   if (!ipBudget.allowed || pairLocked || overallLocked) {
    const retryAfter = Math.max(
     ipBudget.allowed ? 0 : ipBudget.retryAfterSeconds,
     pairLocked ? pair.retryAfterSeconds : 0,
     overallLocked ? overall.retryAfterSeconds : 0,
    );
    await security.logSecurityEvent({ identifier, event: 'login_locked', headers });
    throw new Error(`LOGIN_LOCKED:${Math.max(1, Math.ceil(retryAfter / 60))}`);
   }

   const user: AuthUser | null = await authDb.verifyCredentials({ email: identifier, password });

   if (!user) {
    await Promise.all([
     security.consumeRateLimit(pairKey, security.LIMITS.loginPair),
     security.consumeRateLimit(identifierKey, security.LIMITS.loginIdentifier),
    ]);
    await security.logSecurityEvent({ identifier, event: 'login_failed', headers });
    return null;
   }

   assertCanSignIn(user);
   await assertSecondFactor(user, credentials?.otp, headers);

   await security.resetRateLimit(pairKey);
   await authDb.recordSuccessfulLogin(user.id);
   await security.logSecurityEvent({ userId: user.id, identifier, event: 'login_success', headers, meta: { method: 'password' } });

   return toSessionUser(user, credentials?.remember !== 'false');
  },
 }),
 // Second step of a Google sign-in for users with two-factor on: the signIn callback sends
 // them to /login/mfa with a signed 5-minute challenge, which is traded here (+ a code) for
 // the session.
 CredentialsProvider({
  id: 'mfa-challenge',
  name: 'Two-factor',
  credentials: {
   challenge: { label: 'Challenge', type: 'text' },
   otp: { label: 'Authentication code', type: 'text' },
  },
  async authorize(credentials, req) {
   const headers = req?.headers as Headers;
   const challenge = mfa.verifyChallenge(credentials?.challenge);
   if (!challenge) throw new Error('MFA_CHALLENGE_EXPIRED');
   const user: AuthUser | null = await authDb.getAuthUserById(challenge.userId);
   if (!user) throw new Error('MFA_CHALLENGE_EXPIRED');
   assertCanSignIn(user);
   await assertSecondFactor(user, credentials?.otp || '', headers);
   await authDb.recordSuccessfulLogin(user.id);
   await security.logSecurityEvent({ userId: user.id, event: 'login_success', headers, meta: { method: 'google+mfa' } });
   return toSessionUser(user, true);
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
  maxAge: SESSION_MAX_AGE_SECONDS,
 },
 pages: {
  signIn: '/login',
 },
 callbacks: {
  // Runs before the jwt callback, on every OAuth sign-in — this is the only place
  // that can actually reject an OAuth login (jwt/session run after the session
  // already exists). Credentials logins are gated in authorize() above instead.
  async signIn({ account, profile }) {
   if (account?.provider !== 'google') {
    return true;
   }
   const googleProfile = (profile || {}) as GoogleProfile;
   if (!googleProfile.email || !account.providerAccountId) {
    return false;
   }
   const result = await authDb.resolveGoogleUser({
    sub: account.providerAccountId,
    email: googleProfile.email,
    emailVerified: googleProfile.email_verified,
    name: googleProfile.name,
    image: googleProfile.picture,
   });
   if (result.error) {
    await security.logSecurityEvent({ identifier: googleProfile.email, event: 'google_login_refused', meta: { reason: result.error } });
    return `/login?authError=${result.error}`;
   }
   const dbUser: AuthUser = result.user;
   if (result.passwordEvicted) {
    await security.logSecurityEvent({ userId: dbUser.id, event: 'google_link_password_removed' });
    // Best-effort heads-up; the login itself must not fail on a mail error.
    mailer
     .sendSecurityNoticeEmail({
      to: dbUser.email,
      name: dbUser.name,
      heading: 'Your account is now linked to Google',
      message:
       'You signed in with Google, so this account is now linked to it. Because the email on the account had never been verified, its old password was removed to protect you. You can keep signing in with Google, or set a new password with "Forgot password".',
      actionUrl: `${getAppBaseUrl()}/forgot-password`,
      actionLabel: 'Set a password',
     })
     .catch(() => {});
   }
   try {
    assertCanSignIn(dbUser);
   } catch (error) {
    return `/login?authError=${error instanceof Error ? error.message : 'ACCESS_REJECTED'}`;
   }
   if (dbUser.mfaEnabled) {
    // No session yet: the code is collected on /login/mfa (see the mfa-challenge provider).
    return `/login/mfa?c=${encodeURIComponent(mfa.signChallenge(dbUser.id))}`;
   }
   await authDb.recordSuccessfulLogin(dbUser.id);
   await security.logSecurityEvent({ userId: dbUser.id, event: 'login_success', meta: { method: 'google', newUser: Boolean(result.isNewUser) } });
   return true;
  },
  async jwt({ token, account, user, trigger }) {
   const now = Date.now();

   if (account?.provider === 'google') {
    // signIn() above already resolved/linked the account and stamped google_sub.
    const dbUser: AuthUser | null = await authDb.getUserByGoogleSub(account.providerAccountId);
    if (!dbUser) {
     throw new SessionRevokedError('google_user_missing');
    }
    token.sub = dbUser.id;
    token.email = dbUser.email;
    token.sv = dbUser.sessionVersion;
    token.mfaEnabled = dbUser.mfaEnabled;
    token.loginAt = now;
    token.remember = true;
   } else if (user?.id) {
    token.sub = user.id;
    token.sv = user.sessionVersion ?? 0;
    token.mfaEnabled = user.mfaEnabled === true;
    token.loginAt = now;
    token.remember = user.remember !== false;
   }

   // "Keep me signed in" unticked: hard 12h ceiling from sign-in. Tokens minted before this
   // field existed have no loginAt and are left alone (they still expire at maxAge).
   if (token.remember === false && typeof token.loginAt === 'number' && now - token.loginAt > SHORT_SESSION_MS) {
    throw new SessionRevokedError('session_expired');
   }

   // DB-derived claims + revocation checks, on a TTL. These used to run on EVERY session
   // read, which with a JWT strategy means every getServerSession call — i.e. DB round-trips
   // on every single API request. Now one query (getSessionClaims), at most every
   // CLAIMS_TTL_MS, also re-validates the session:
   //   * user deleted                       -> revoked
   //   * status rejected/pending            -> revoked
   //   * subscription lapsed                -> revoked (no longer client-enforced only)
   //   * session_version moved on           -> revoked (password change/reset, admin reset,
   //                                           sign-out-everywhere)
   // `sv` is NEVER taken from an update() payload — only from sign-in or a server-side
   // re-issue (session-cookie.ts) — or any device could un-revoke itself.
   const refreshedAt = typeof token.claimsRefreshedAt === 'number' ? token.claimsRefreshedAt : 0;
   const isStale = now - refreshedAt > CLAIMS_TTL_MS;

   if (token.sub && (user || account || trigger === 'update' || isStale)) {
    const claims = await authDb.getSessionClaims(token.sub);
    if (!claims) {
     throw new SessionRevokedError('user_deleted');
    }
    if (claims.status === 'rejected' || claims.status === 'pending') {
     throw new SessionRevokedError('status');
    }
    if (isSubscriptionExpired(claims.subscriptionEndsAt)) {
     throw new SessionRevokedError('subscription_expired');
    }
    if (Number(claims.sessionVersion) !== Number(token.sv ?? 0)) {
     throw new SessionRevokedError('session_version');
    }
    token.email = claims.email;
    token.name = claims.name;
    token.defaultWorkspaceId = claims.defaultWorkspaceId || null;
    token.aiEnabled = claims.aiEnabled === true;
    token.mfaEnabled = claims.mfaEnabled === true;
    token.claimsRefreshedAt = now;
   }

   return token;
  },
  async session({ session, token }) {
   if (session.user && token.sub) {
    session.user.id = token.sub;
    session.user.email = (token.email as string | undefined) ?? session.user.email;
    session.user.defaultWorkspaceId = (token.defaultWorkspaceId as string | null) || null;
    session.user.isSuperAdmin = isSuperAdmin(token.sub);
    session.user.aiEnabled = token.aiEnabled === true;
    session.user.mfaEnabled = token.mfaEnabled === true;
   }

   return session;
  },
 },
 events: {
  // Records a login event for the super-admin activity view. Fires after a successful
  // sign-in for both Credentials and Google. Best-effort — a telemetry failure must never
  // block or break the login itself.
  async signIn({ user, account }) {
   try {
    const userId = account?.provider === 'google' ? (await authDb.getUserByGoogleSub(account.providerAccountId))?.id : user?.id;
    if (userId) {
     await authDb.recordActivityEvent({ userId, eventType: 'login' });
    }
   } catch {}
  },
 },
};
