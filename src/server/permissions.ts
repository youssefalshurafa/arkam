import { createHash, createHmac, timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';

// Global (platform-level) super-admin check, distinct from the per-workspace "owner" role.
//
// Pinned to an immutable user ID (SUPER_ADMIN_USER_ID), NOT an email. It used to compare
// session.user.email against SUPER_ADMIN_EMAIL, but emails are user-controlled (signup takes
// any address, change-email rewrites it), so anyone who registered or switched to that address
// became super-admin. Fails closed: with the env var unset there is no super-admin at all.
// SUPER_ADMIN_EMAIL survives only as the admin-notification fallback address in mailer.js.
export function isSuperAdmin(userId: string | null | undefined): boolean {
 const superAdminUserId = process.env.SUPER_ADMIN_USER_ID?.trim();
 if (!superAdminUserId || !userId) {
  return false;
 }
 return userId === superAdminUserId;
}

// Second, independent gate in front of the super-admin panel (on top of isSuperAdmin):
// even someone signed into the super-admin account needs this separate panel password
// to get in. The "unlock" is a signed, time-limited token stored in the admin_unlock
// cookie — signed with NEXTAUTH_SECRET (already required by next-auth) rather than a
// new secret, and never stores the password itself client-side.
export const ADMIN_UNLOCK_COOKIE = 'admin_unlock';
const ADMIN_UNLOCK_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function adminUnlockSigningKey(): string | null {
 return process.env.NEXTAUTH_SECRET?.trim() || null;
}

// The signed payload binds the unlock to one user: a cookie minted for one account is
// worthless to any other session, even on the same browser.
function hmacFor(userId: string, expiresAt: number, key: string): string {
 return createHmac('sha256', key).update(`admin-unlock:${userId}.${expiresAt}`).digest('hex');
}

function digest(value: string): Buffer {
 return createHash('sha256').update(value).digest();
}

// Both sides are hashed to a fixed 32 bytes before the constant-time compare, so neither
// the comparison's timing nor an early length check reveals the configured password's length.
export function checkAdminPanelPassword(password: string): boolean {
 const configured = process.env.SUPER_ADMIN_PANEL_PASSWORD;
 if (!configured || !password) return false;
 return timingSafeEqual(digest(password), digest(configured));
}

export function signAdminUnlockToken(userId: string): string | null {
 const key = adminUnlockSigningKey();
 if (!key || !userId) return null;
 const expiresAt = Date.now() + ADMIN_UNLOCK_TTL_MS;
 return `${userId}.${expiresAt}.${hmacFor(userId, expiresAt, key)}`;
}

export function verifyAdminUnlockToken(token: string | null | undefined, userId: string | null | undefined): boolean {
 const key = adminUnlockSigningKey();
 if (!key || !token || !userId) return false;
 const parts = token.split('.');
 if (parts.length !== 3) return false;
 const [tokenUserId, expiresAtRaw, signature] = parts;
 const expiresAt = Number(expiresAtRaw);
 if (tokenUserId !== userId || !Number.isFinite(expiresAt) || !signature || Date.now() > expiresAt) return false;
 const expected = hmacFor(userId, expiresAt, key);
 const a = Buffer.from(signature);
 const b = Buffer.from(expected);
 return a.length === b.length && timingSafeEqual(a, b);
}

// Convenience for API routes: checks the panel-unlock cookie belongs to this user.
// Both admin API routes and the /admin layout must check this (alongside isSuperAdmin) —
// the layout alone would just be a bypassable UI decoration since the routes are
// reachable directly.
export function isAdminPanelUnlocked(request: NextRequest, userId: string | null | undefined): boolean {
 return verifyAdminUnlockToken(request.cookies.get(ADMIN_UNLOCK_COOKIE)?.value, userId);
}
