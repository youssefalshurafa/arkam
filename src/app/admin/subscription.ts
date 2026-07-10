// Shared subscription-status helper for the super-admin panel (list + user-detail pages).
//
// Days-remaining is computed as a WHOLE-CALENDAR-DAY difference, not a raw millisecond
// division. The old `Math.ceil((endsAt - now) / dayMs)` inflated the count by a day right
// after a grant: an expiry stored as `now + N*days` server-side, when re-divided against the
// browser's `Date.now()`, lands at `N + ε` whenever the server clock is even a fraction of a
// second ahead of the client — and `Math.ceil` rounds that ε up to a full extra day. Seconds
// later (or after a refresh) the browser clock passes the epsilon and the count "corrects"
// down by one, which is exactly the "+30 shows 32, refresh shows 31 / always adds 1" bug.
//
// Anchoring both ends to the start of their local day makes the difference an exact integer
// that is immune to sub-second skew and stable across refreshes: granting N days always reads
// N and stays N until the calendar date actually advances.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfDay(ms: number): number {
 const d = new Date(ms);
 d.setHours(0, 0, 0, 0);
 return d.getTime();
}

export type SubscriptionTone = 'none' | 'expired' | 'soon' | 'active';

export type SubscriptionState = {
 label: string;
 tone: SubscriptionTone;
 daysLeft: number | null;
};

// Computes a subscription state from the end date: how many whole days remain,
// whether it has lapsed, and whether it's expiring soon (≤7 days).
export function getSubscriptionState(endsAt: string | null): SubscriptionState {
 if (!endsAt) return { label: 'No subscription', tone: 'none', daysLeft: null };
 const end = new Date(endsAt).getTime();
 const now = Date.now();
 // Truly past its expiry timestamp — this uses the exact instant, so access ends
 // precisely when the login gate says it does, not at the start of the day.
 if (end <= now) return { label: 'Expired', tone: 'expired', daysLeft: 0 };
 // Still valid: report whole calendar days until expiry. `Math.max(1, …)` keeps a
 // subscription that ends later *today* reading "1 day left" rather than 0.
 const daysLeft = Math.max(1, Math.round((startOfDay(end) - startOfDay(now)) / MS_PER_DAY));
 if (daysLeft <= 7) return { label: `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`, tone: 'soon', daysLeft };
 return { label: `${daysLeft} days left`, tone: 'active', daysLeft };
}
