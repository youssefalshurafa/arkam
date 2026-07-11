// Registry of the homepage "mockup" image slots. Each slot on the marketing
// homepage renders a hand-built CSS mockup by default; a super admin can upload
// a real screenshot for any slot from the admin panel (Homepage Images tab),
// which then replaces the mockup. Both the homepage and the admin panel import
// this list so the set of slots never drifts between them.
//
// `label` is an English fallback shown in the admin panel; `slot` is the stable
// key used in the DB (marketing_assets.slot) and the image URL.

export type MarketingSlot = {
 /** Stable key stored in marketing_assets.slot and used in the image URL. */
 slot: string;
 /** Human-readable label for the admin panel. */
 label: string;
 /** Where this image appears on the homepage (admin panel hint). */
 hint: string;
};

export const MARKETING_SLOTS: MarketingSlot[] = [
 { slot: 'hero', label: 'Hero preview', hint: 'Large image beside the main headline at the top of the homepage.' },
 { slot: 'ledgers', label: 'Client ledgers', hint: 'Client & organization ledger feature section.' },
 { slot: 'transactions', label: 'Multi-currency transactions', hint: 'Exchange rates, commissions & charges feature section.' },
 { slot: 'overview', label: 'Exchange overview', hint: 'Pooled balances / exchange overview feature section.' },
 { slot: 'exports', label: 'Exports & PDF', hint: 'Branded PDF / Excel / archive export feature section.' },
 { slot: 'workspaces', label: 'Workspaces & team', hint: 'Multi-workspace & team roles feature section.' },
 { slot: 'liverates', label: 'Live rates', hint: 'Live gold & currency rates feature section.' },
];

/** Set of valid slot keys, for validating upload/serve requests. */
export const MARKETING_SLOT_KEYS: ReadonlySet<string> = new Set(MARKETING_SLOTS.map((s) => s.slot));

export function isMarketingSlot(slot: string): boolean {
 return MARKETING_SLOT_KEYS.has(slot);
}
