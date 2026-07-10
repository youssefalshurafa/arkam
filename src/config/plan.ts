// Length of the free trial granted automatically on signup (credentials or Google),
// before a subscription window has ever been paid for.
export const TRIAL_DURATION_DAYS = 14;

// Subscription pricing tiers shown on the homepage and during signup.
// Edit these freely — they are display + payment-record only (no feature
// enforcement). The user picks a tier at the payment step; the chosen tier's
// duration drives the subscription window once the super admin approves.
//
// The USDT wallet address/network are read from environment variables so the
// real address is never committed. See getPaymentConfig below.

export type PlanTier = {
 /** Stable id stored with the request, e.g. "monthly". */
 id: string;
 /** Display name, e.g. "6 Months". */
 name: string;
 /** Price actually charged, in USDT. */
 priceUsdt: number;
 /** Optional original price, shown struck-through to highlight the discount. */
 originalUsdt?: number;
 /** Billing period label, e.g. "per month". */
 period: string;
 /** How many days this tier of subscription lasts. */
 durationDays: number;
 /** Visually highlight this tier as the recommended option. */
 highlight?: boolean;
};

export const PLAN_TIERS: PlanTier[] = [
 { id: 'monthly', name: 'Monthly', priceUsdt: 50, period: 'per month', durationDays: 30 },
 { id: '6months', name: '6 Months', priceUsdt: 250, originalUsdt: 300, period: 'every 6 months', durationDays: 180, highlight: true },
 { id: '1year', name: '1 Year', priceUsdt: 450, originalUsdt: 600, period: 'per year', durationDays: 365 },
];

// Features are shared across all tiers.
export const PLAN_FEATURES: string[] = [
 'Unlimited clients, organizations & currencies',
 'Unlimited transactions with multi-currency ledgers',
 'PDF & Excel exports',
 'Full database backup & restore',
 'Multi-language support (English, العربية, Français)',
];

/** Resolves a tier by id, falling back to the first (monthly) tier. */
export function getPlanTier(id?: string | null): PlanTier {
 return PLAN_TIERS.find((tier) => tier.id === id) || PLAN_TIERS[0];
}

/** Human-readable amount label for a tier, e.g. "250 USDT". */
export function getTierAmountLabel(tier: PlanTier): string {
 return `${tier.priceUsdt} USDT`;
}

/**
 * Payment destination. Address/network come from the server environment so they
 * stay out of the client bundle. Only read on the server (API routes).
 */
export function getPaymentConfig() {
 return {
  address: process.env.USDT_WALLET_ADDRESS?.trim() || '',
  network: process.env.USDT_NETWORK?.trim() || 'TRC20',
 };
}
