// Client helpers around the admin access-requests endpoint for the two
// subscription mutations the panel performs by userId (renew/extend and set an
// exact days-remaining). Shared by the user-detail and Subscriptions screens so
// the request shape stays in one place.

export type SubResult = { ok: boolean; subscriptionEndsAt?: string; error?: string };

async function post(body: Record<string, unknown>): Promise<SubResult> {
 try {
  const res = await fetch('/api/admin/access-requests', {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify(body),
  });
  const data = (await res.json()) as SubResult;
  if (!res.ok || !data.ok || !data.subscriptionEndsAt) return { ok: false, error: data.error };
  return { ok: true, subscriptionEndsAt: data.subscriptionEndsAt };
 } catch {
  return { ok: false, error: 'network' };
 }
}

// Adds `durationDays` on top of the current expiry (or starts from today if expired).
export function renewSubscription(userId: string, durationDays: number) {
 return post({ userId, action: 'renew', durationDays });
}

// Replaces the expiry with exactly `days` from now.
export function setSubscriptionDays(userId: string, days: number) {
 return post({ userId, action: 'setDays', days });
}
