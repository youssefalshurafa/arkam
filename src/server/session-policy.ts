// Session lifetime policy, shared by auth-options.ts and the cookie re-issue helper.

// Hard ceiling for any session ("Keep me signed in" ticked).
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

// Without "Keep me signed in", a session ends this long after sign-in regardless of activity.
export const SHORT_SESSION_MS = 12 * 60 * 60 * 1000;

// How long the DB-derived claims on the JWT may go without being re-read. Each re-read also
// re-checks revocation (deleted / rejected / expired / session_version), so this is the
// worst-case delay before a revoked session stops working on another device.
export const CLAIMS_TTL_MS = 5 * 60 * 1000;

export function isSubscriptionExpired(subscriptionEndsAt: string | Date | null | undefined): boolean {
 if (!subscriptionEndsAt) return false; // NULL = indefinite access (admin-created, teammates)
 return new Date(subscriptionEndsAt).getTime() < Date.now();
}
