import { createHmac, timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';

// Global (platform-level) super-admin check, distinct from the per-workspace
// "owner" role. Gated on a single allowlisted email via env var.
export function isSuperAdmin(email: string | null | undefined): boolean {
 const superAdminEmail = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
 if (!superAdminEmail || !email) {
  return false;
 }
 return email.trim().toLowerCase() === superAdminEmail;
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

function hmacFor(expiresAt: number, key: string): string {
 return createHmac('sha256', key).update(String(expiresAt)).digest('hex');
}

export function checkAdminPanelPassword(password: string): boolean {
 const configured = process.env.SUPER_ADMIN_PANEL_PASSWORD;
 if (!configured || !password) return false;
 const a = Buffer.from(password);
 const b = Buffer.from(configured);
 return a.length === b.length && timingSafeEqual(a, b);
}

export function signAdminUnlockToken(): string | null {
 const key = adminUnlockSigningKey();
 if (!key) return null;
 const expiresAt = Date.now() + ADMIN_UNLOCK_TTL_MS;
 return `${expiresAt}.${hmacFor(expiresAt, key)}`;
}

export function verifyAdminUnlockToken(token: string | null | undefined): boolean {
 const key = adminUnlockSigningKey();
 if (!key || !token) return false;
 const [expiresAtRaw, signature] = token.split('.');
 const expiresAt = Number(expiresAtRaw);
 if (!Number.isFinite(expiresAt) || !signature || Date.now() > expiresAt) return false;
 const expected = hmacFor(expiresAt, key);
 const a = Buffer.from(signature);
 const b = Buffer.from(expected);
 return a.length === b.length && timingSafeEqual(a, b);
}

// Convenience for API routes: combines the email allowlist with the panel-unlock cookie.
// Both admin API routes and the /admin layout must check this — the layout alone would
// just be a bypassable UI decoration since the routes are reachable directly.
export function isAdminPanelUnlocked(request: NextRequest): boolean {
 return verifyAdminUnlockToken(request.cookies.get(ADMIN_UNLOCK_COOKIE)?.value);
}
