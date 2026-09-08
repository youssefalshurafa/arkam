/**
 * Configuration for the Second Accountant — the engine that reads every entry back against the
 * workspace's own history and flags what looks like a slip (see ledgerAnomalies.ts).
 *
 * Stored as one JSON object on the workspace (workspace_settings.review_engine), so a workspace
 * tailors the checks to how it actually trades without anyone touching code. Everything here has
 * a default that reproduces the behaviour the engine shipped with, and every stored value is
 * clamped on the way in — a hand-edited or partially-written row can never widen a bound past
 * what the UI allows, nor produce a NaN that would silently disable a check.
 */

// How much room the rate check leaves around the band a pair has actually traded in. This is the
// one genuinely subjective dial — how twitchy the user wants the warnings — so it is offered as
// three named settings rather than a raw number, and the multipliers scale the engine's own
// margins rather than replacing them. Strict leaves less room, so it flags more.
export type ReviewSensitivity = 'strict' | 'balanced' | 'relaxed';

export const SENSITIVITY_MULTIPLIER: Record<ReviewSensitivity, number> = {
 strict: 0.5,
 balanced: 1,
 relaxed: 2,
};

export type ReviewEngineSettings = {
 // Master switch. Off means no badges, no review queue, no export warnings — the engine stops
 // being consulted at all rather than being consulted and ignored.
 enabled: boolean;
 rate: {
  enabled: boolean;
  sensitivity: ReviewSensitivity;
  // Prior transactions of the same currency pair required before the check will judge at all.
  // Below it there is no meaningful reference, and flagging would just punish rare or new pairs.
  minSamples: number;
 };
 commission: {
  enabled: boolean;
  // Prior transactions in the same group required before that scope may speak — see
  // CommissionScope. Raising it makes the engine wait for more evidence at every rung.
  minSamples: number;
  // How near-unanimous a history must be before it counts as a rule the user meant, expressed
  // as a share between 0 and 1. Commission is frequently negotiated per deal (unlike exchange
  // rates, which track a real market), so distance from a loose statistical centre is not a
  // reliable signal on its own — plenty of genuinely variable relationships would trip it.
  // Demanding near-unanimity first means the engine only ever compares against a history that
  // really does have a convention to break, and it is also what makes widening the scope safe:
  // a wider pool can only mix in more practices, and a mixed pool fails this test and stays
  // silent. Lowering it makes the engine readier to call a habit a rule.
  agreement: number;
  // The point past which a number is not a commission at all but something else typed into the
  // field — an exchange rate, usually. 'auto' measures it from the workspace's own recorded
  // commissions, which is right for almost everyone; 'fixed' pins it for a workspace whose
  // books are too new or too unusual for that measurement to mean anything.
  ceiling: { mode: 'auto' } | { mode: 'fixed'; value: number };
 };
 // Whether a ledger export stops to list what the engine flagged. Independent of the badges:
 // some workspaces want the quiet in-page hints but no interruption on the way out, and some
 // want the opposite.
 warnOnExport: boolean;
};

export const DEFAULT_REVIEW_SETTINGS: ReviewEngineSettings = {
 enabled: true,
 rate: { enabled: true, sensitivity: 'balanced', minSamples: 5 },
 commission: { enabled: true, minSamples: 5, agreement: 0.9, ceiling: { mode: 'auto' } },
 warnOnExport: true,
};

// The bounds the UI offers and the parser enforces. Both ends are meaningful: a minimum sample
// size of 0 would judge a transaction against nothing, and an agreement threshold below half
// would let a minority practice be called the rule.
export const REVIEW_LIMITS = {
 minSamples: { min: 2, max: 100 },
 agreement: { min: 0.5, max: 1 },
 ceiling: { min: 0.1, max: 100 },
} as const;

function clamp(value: number, { min, max }: { min: number; max: number }): number {
 return Math.min(max, Math.max(min, value));
}

function readNumber(raw: unknown, fallback: number, bounds: { min: number; max: number }, integer = false): number {
 const value = typeof raw === 'number' ? raw : Number(raw);
 if (!Number.isFinite(value)) return fallback;
 const clamped = clamp(value, bounds);
 return integer ? Math.round(clamped) : clamped;
}

function readBoolean(raw: unknown, fallback: boolean): boolean {
 return typeof raw === 'boolean' ? raw : fallback;
}

/**
 * Builds a complete, in-range settings object from whatever the workspace has stored — which may
 * be null (never configured), a partial object (saved by an older version that had fewer knobs),
 * or something malformed. Anything unreadable falls back to the default for that field alone, so
 * one bad value never costs the user the rest of their configuration.
 */
export function resolveReviewSettings(raw: unknown): ReviewEngineSettings {
 if (!raw || typeof raw !== 'object') return DEFAULT_REVIEW_SETTINGS;
 const stored = raw as Record<string, unknown>;
 const rate = (stored.rate && typeof stored.rate === 'object' ? stored.rate : {}) as Record<string, unknown>;
 const commission = (stored.commission && typeof stored.commission === 'object' ? stored.commission : {}) as Record<string, unknown>;
 const storedCeiling = (commission.ceiling && typeof commission.ceiling === 'object' ? commission.ceiling : {}) as Record<string, unknown>;
 const defaults = DEFAULT_REVIEW_SETTINGS;
 return {
  enabled: readBoolean(stored.enabled, defaults.enabled),
  rate: {
   enabled: readBoolean(rate.enabled, defaults.rate.enabled),
   sensitivity: rate.sensitivity === 'strict' || rate.sensitivity === 'relaxed' || rate.sensitivity === 'balanced' ? rate.sensitivity : defaults.rate.sensitivity,
   minSamples: readNumber(rate.minSamples, defaults.rate.minSamples, REVIEW_LIMITS.minSamples, true),
  },
  commission: {
   enabled: readBoolean(commission.enabled, defaults.commission.enabled),
   minSamples: readNumber(commission.minSamples, defaults.commission.minSamples, REVIEW_LIMITS.minSamples, true),
   agreement: readNumber(commission.agreement, defaults.commission.agreement, REVIEW_LIMITS.agreement),
   ceiling:
    storedCeiling.mode === 'fixed'
     ? { mode: 'fixed', value: readNumber(storedCeiling.value, DEFAULT_FIXED_CEILING, REVIEW_LIMITS.ceiling) }
     : { mode: 'auto' },
  },
  warnOnExport: readBoolean(stored.warnOnExport, defaults.warnOnExport),
 };
}

// Where the "fixed" ceiling field starts when a user first switches off 'auto'. Only a starting
// point for the input — the engine never uses it unless the user saves that mode.
export const DEFAULT_FIXED_CEILING = 10;
