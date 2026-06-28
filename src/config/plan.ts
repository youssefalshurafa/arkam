// Single subscription plan shown on the homepage and during signup.
// Edit these placeholder values freely — they are display + payment-record only
// (no feature enforcement happens anywhere in the app yet).
//
// The USDT wallet address and network are read from environment variables so the
// real address is never committed to the repo. See PAYMENT below.

export type AppPlan = {
 /** Plan name shown to the user, e.g. "Arkam Pro". */
 name: string;
 /** Numeric price in USDT (used to build the "amount" label). */
 priceUsdt: number;
 /** Billing period label, e.g. "per month", "one-time". */
 period: string;
 /** How many days one paid period lasts. Used to compute the subscription end date. */
 durationDays: number;
 /** Short marketing line under the price. */
 tagline: string;
 /** Feature bullet points shown in the plan card. */
 features: string[];
};

export const APP_PLAN: AppPlan = {
 name: 'Arkam',
 priceUsdt: 50,
 period: 'per month',
 durationDays: 30,
 tagline: 'Full access to the Arkam exchange accounting workspace.',
 features: [
  'Unlimited clients, organizations & currencies',
  'Unlimited transactions with multi-currency ledgers',
  'PDF & Excel exports',
  'Full database backup & restore',
  'Multi-language support (English, العربية, Français)',
 ],
};

/** Number of days one paid subscription period lasts. */
export function getPlanDurationDays(): number {
 return APP_PLAN.durationDays;
}

/** Human-readable amount label, e.g. "50 USDT". */
export function getPlanAmountLabel(): string {
 return `${APP_PLAN.priceUsdt} USDT`;
}

/**
 * Payment destination. Address/network come from the server environment so they
 * stay out of the client bundle and are configurable per deployment.
 * These are only read on the server (API routes).
 */
export function getPaymentConfig() {
 return {
  address: process.env.USDT_WALLET_ADDRESS?.trim() || '',
  network: process.env.USDT_NETWORK?.trim() || 'TRC20',
  amount: getPlanAmountLabel(),
  plan: APP_PLAN.name,
 };
}
