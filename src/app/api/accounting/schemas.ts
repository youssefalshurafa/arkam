import { z } from 'zod';

/**
 * Payload schemas for the highest-risk `/api/accounting` actions — the ones that move money
 * or mutate in bulk. Actions with no entry here are passed through unvalidated, exactly as
 * before, so this file can grow incrementally without a big-bang migration.
 *
 * IMPORTANT — these are a GATE, not a transform. route.ts validates the payload and then
 * forwards the ORIGINAL object to db.js, never zod's parsed output. That matters because
 * zod's default `z.object()` STRIPS unknown keys: forwarding the parsed value would silently
 * drop any field the client sends that isn't modelled here, which is exactly the kind of
 * quiet data-loss bug this validation exists to prevent. Every schema below is therefore
 * deliberately permissive about extra keys, and rejects only shapes that would reach
 * Postgres as a broken value.
 *
 * The point is to turn "NaN lands in a DOUBLE PRECISION column" and "undefined lands in a
 * NOT NULL id" into a clean 400, without tightening the contract the client already relies
 * on. db.js keeps its own semantic checks (required party, currency, reconciliation locks)
 * and their user-facing messages — those are better than anything zod would produce here.
 */

/** A real, finite number. Rejects NaN/Infinity, which pass a bare `typeof === 'number'` check. */
const finiteNumber = z.number().refine(Number.isFinite, { message: 'must be a finite number' });

/** A row id: a finite number, or null where the column is nullable. */
const id = finiteNumber;
const nullableId = finiteNumber.nullable();

/**
 * Numeric fields that reach the API as either a number or a numeric string, depending on
 * which form built the payload (the ledger's inline row editor keeps drafts as strings).
 *
 * A string is accepted only when it is empty — which db.js reads as "unset", e.g. clearing a
 * harvest rate — or when it actually parses to a finite number. Accepting arbitrary strings
 * here would defeat the point: 'abc' would sail through and fail down in Postgres as a
 * DOUBLE PRECISION cast error instead of a clean 400.
 */
const numericString = z.string().refine((value) => value.trim() === '' || Number.isFinite(Number(value)), { message: 'must be a number' });
const looseNumber = z.union([finiteNumber, numericString]);

/**
 * The `*Reversed` and `isArchived` flags are typed `number` (0/1) on `Transaction` but read
 * as booleans by db.js (`Boolean(...)`) and stored as BOOLEAN. Both representations are live
 * in the client today — buildTransactionCreatePayload forwards the raw 0/1 from an existing
 * row, while NewTransactionForm sends a real boolean — so both must be accepted.
 */
const looseBoolean = z.union([z.boolean(), finiteNumber]);

/** Optional-and-nullable, the shape most of these fields actually arrive in. */
const opt = <T extends z.ZodTypeAny>(schema: T) => schema.nullish();

/**
 * Fields shared by createTransaction and updateTransaction. Only `amount` and `currencyId`
 * are required here — the party accounts are deliberately not, because db.js enforces the
 * real rule (at least one side, unless archived) and phrases it for the user.
 */
const transactionFields = {
 accountFromId: opt(nullableId),
 accountToId: opt(nullableId),
 currencyId: nullableId,
 amount: looseNumber,
 type: opt(z.string()),
 isArchived: opt(looseBoolean),
 exchangeRateFrom: opt(looseNumber),
 commissionFrom: opt(looseNumber),
 exchangeRateTo: opt(looseNumber),
 commissionTo: opt(looseNumber),
 exchangeRateFromReversed: opt(looseBoolean),
 exchangeRateToReversed: opt(looseBoolean),
 charges: opt(looseNumber),
 chargesCurrencyId: opt(nullableId),
 chargesPayer: opt(z.string()),
 chargesExchangeRate: opt(looseNumber),
 chargesDescription: opt(z.string()),
 charges2: opt(looseNumber),
 charges2CurrencyId: opt(nullableId),
 chargesPayer2: opt(z.string()),
 charges2ExchangeRate: opt(looseNumber),
 charges2Description: opt(z.string()),
 description: opt(z.string()),
 descriptionFrom: opt(z.string()),
 descriptionTo: opt(z.string()),
 exchangeActualAmount: opt(looseNumber),
 archiveNote: opt(z.string()),
 counterParty: opt(z.string()),
 distributionLocationId: opt(nullableId),
 createdAt: opt(z.string()),
 acknowledgeReconciliationOverride: opt(z.boolean()),
};

export const actionSchemas: Record<string, z.ZodType> = {
 createTransaction: z.object(transactionFields),

 updateTransaction: z.object({ ...transactionFields, id }),

 /**
  * Two live shapes: a bare id (legacy callers) or an object. Modelled as a union rather
  * than collapsed, because db.js still accepts both — see its `typeof payload === 'object'`
  * branch. Collapsing this would break the legacy path.
  */
 deleteTransaction: z.union([id, z.object({ id, acknowledgeReconciliationOverride: opt(z.boolean()) })]),

 deleteTransactionsBulk: z.object({
  transactionIds: z.array(looseNumber),
  acknowledgeReconciliationOverride: opt(z.boolean()),
 }),

 /**
  * Only the envelope is checked. Per-row validation is left to db.js's own import loop,
  * which reports which row failed — far more useful to a user importing a spreadsheet than
  * a zod path like `transactions[417].amount`.
  */
 bulkImportTransactions: z.object({ transactions: z.array(z.unknown()) }),

 setTransactionArchiveHidden: z.object({ id, hidden: opt(looseBoolean) }),

 createClientAccount: z.object({
  clientId: nullableId,
  currencyId: nullableId,
  startingBalance: opt(looseNumber),
 }),

 updateClientAccountStartingBalance: z.object({
  accountId: nullableId,
  startingBalance: opt(looseNumber),
 }),

 moveAccountTransactions: z.object({ fromAccountId: id, toAccountId: id }),

 createReconciliation: z.object({
  accountId: nullableId,
  anchorTransactionId: opt(nullableId),
  anchorDate: opt(z.string()),
  balance: opt(looseNumber),
  note: opt(z.string()),
  lockedTransactionIds: opt(z.array(looseNumber)),
 }),

 /**
  * `rate` is intentionally wide: db.js treats null, '', and any non-positive number as
  * "delete this day's rate" rather than an error. A plain z.number() here would break the
  * clear-a-rate path.
  */
 saveHarvestRate: z.object({
  day: z.string(),
  organizationId: opt(nullableId),
  currencyId: nullableId,
  rate: opt(looseNumber),
 }),

 saveWriteOffMargin: z.object({ currencyId: id, threshold: looseNumber }),

 listTransactionHistory: z.object({ transactionId: id }),
};

/**
 * Validates `payload` for `action`. Returns null when it passes (or when the action has no
 * schema yet); otherwise a short, path-prefixed message naming what was wrong.
 *
 * Note the caller must forward the original payload, not a parsed copy — see the file header.
 */
export function validateActionPayload(action: string, payload: unknown): string | null {
 const schema = actionSchemas[action];
 if (!schema) return null;

 const result = schema.safeParse(payload);
 if (result.success) return null;

 return result.error.issues
  .slice(0, 5)
  .map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
  .join('; ');
}
