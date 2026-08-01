import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { GoogleGenAI } from '@google/genai';
import * as z from 'zod/v4';
import { authOptions } from '@/server/auth-options';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Natural-language transaction entry: parses a typed sentence into a partial transaction-form
// payload so the user has fewer fields to type by hand (and fewer chances to fat-finger one —
// the same root cause behind every ledger bug fixed earlier this session). Never auto-submits:
// the client only pre-fills the existing new-transaction form, so the same human review that
// already applies to manual entry still applies here. Proxied server-side, mirroring
// src/app/api/ai/review-ledger/route.ts.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-3.6-flash';

const MAX_TEXT_LENGTH = 500;
const MAX_REFERENCE_ROWS = 500;

const LANGUAGE_NAMES: Record<string, string> = {
 en: 'English',
 ar: 'Arabic',
 fr: 'French',
};

const RequestSchema = z.object({
 language: z.string().optional(),
 text: z.string().min(1).max(MAX_TEXT_LENGTH),
 today: z.string(),
 accounts: z.array(z.object({ id: z.number(), label: z.string() })).max(MAX_REFERENCE_ROWS),
 currencies: z.array(z.object({ id: z.number(), code: z.string() })).max(MAX_REFERENCE_ROWS),
});

const ParsedTransaction = z.object({
 type: z.enum(['buy', 'sell', 'exchange', 'transfer', 'adjustment']).nullable(),
 accountFromId: z.number().nullable(),
 accountToId: z.number().nullable(),
 currencyId: z.number().nullable(),
 amount: z.number().nullable(),
 exchangeRateFrom: z.number().nullable(),
 commissionFrom: z.number().nullable(),
 exchangeRateTo: z.number().nullable(),
 commissionTo: z.number().nullable(),
 description: z.string().nullable(),
 // YYYY-MM-DD, only when the text implies a date other than "today".
 date: z.string().nullable(),
});

// Hand-written for the same reason as review-ledger's RESPONSE_SCHEMA: Gemini's responseSchema
// supports only a subset of JSON Schema, so a small fixed shape is kept in sync by hand rather
// than derived (lossily) from the Zod schema above.
const RESPONSE_SCHEMA = {
 type: 'object',
 properties: {
  type: { type: 'string', enum: ['buy', 'sell', 'exchange', 'transfer', 'adjustment', 'null'] },
  accountFromId: { type: ['number', 'null'] },
  accountToId: { type: ['number', 'null'] },
  currencyId: { type: ['number', 'null'] },
  amount: { type: ['number', 'null'] },
  exchangeRateFrom: { type: ['number', 'null'] },
  commissionFrom: { type: ['number', 'null'] },
  exchangeRateTo: { type: ['number', 'null'] },
  commissionTo: { type: ['number', 'null'] },
  description: { type: ['string', 'null'] },
  date: { type: ['string', 'null'] },
 },
 required: ['type', 'accountFromId', 'accountToId', 'currencyId', 'amount', 'exchangeRateFrom', 'commissionFrom', 'exchangeRateTo', 'commissionTo', 'description', 'date'],
};

function buildSystemInstruction(languageName: string): string {
 return (
  'You are a data-entry assistant for a bookkeeping app. The user types a free-text sentence ' +
  "describing a transaction, in any language, and you extract it into the app's transaction " +
  'form fields. You are given the sentence, the current date, and reference lists of the ' +
  "workspace's existing accounts (id + label, where label is \"ClientName · CURRENCY\") and " +
  'currencies (id + code).\n\n' +
  'Rules:\n' +
  '- accountFromId/accountToId/currencyId MUST be an id from the given reference lists, or ' +
  'null if you cannot confidently match a name/currency mentioned in the text to one of them. ' +
  'Never invent an id that is not in the list.\n' +
  '- "from" is who the money/currency is leaving (paid by), "to" is who is receiving it — infer ' +
  'this from the sentence\'s wording (e.g. "received X from A" means A is accountFrom and the ' +
  'workspace\'s own side is accountTo; "sent/paid X to B" means B is accountTo).\n' +
  '- amount is a plain positive number, no currency symbols or thousands separators.\n' +
  '- exchangeRateFrom/exchangeRateTo/commissionFrom/commissionTo are plain numbers as mentioned ' +
  '(commission as a percentage, e.g. "1% commission" → 1). Leave null if not mentioned — do not ' +
  'default to 1 or 0 yourself, the app already has sensible defaults for anything you omit.\n' +
  '- description is a short free-text note if the sentence has one beyond the structured fields, ' +
  'otherwise null.\n' +
  '- date: only set this (as YYYY-MM-DD) if the sentence explicitly implies a date different ' +
  'from "today" (e.g. "yesterday", "last Monday", an explicit date). Otherwise null.\n' +
  '- type: one of buy, sell, exchange, transfer, adjustment, based on what the sentence ' +
  'describes; null if unclear.\n' +
  `- Any field you cannot confidently determine from the text MUST be null, not a guess. Write ` +
  `the "description" field (if any) in ${languageName}, matching the sentence's own language ` +
  'where possible.\n\n' +
  'Respond with JSON matching the given schema.'
 );
}

export async function POST(request: NextRequest) {
 const session = await getServerSession(authOptions);
 if (!session?.user?.id) {
  return NextResponse.json({ error: 'Unauthorized. Please sign in.' }, { status: 401 });
 }
 // AI features are opt-in per user, granted by a super admin (src/app/admin/users/[userId]).
 // Off by default — this check is the real enforcement; the client also hides the UI, but that
 // alone would just be a bypassable UI decoration.
 if (session.user.aiEnabled !== true) {
  return NextResponse.json({ error: 'AI features are not enabled for this account.' }, { status: 403 });
 }

 if (!GEMINI_API_KEY) {
  return NextResponse.json({ error: 'missing_api_key' }, { status: 500 });
 }

 let parsedBody: z.infer<typeof RequestSchema>;
 try {
  const rawBody = await request.json();
  parsedBody = RequestSchema.parse(rawBody);
 } catch {
  return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
 }

 const client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

 try {
  const languageName = LANGUAGE_NAMES[parsedBody.language ?? 'en'] ?? LANGUAGE_NAMES.en;
  const response = await client.models.generateContent({
   model: MODEL,
   contents: JSON.stringify({
    text: parsedBody.text,
    today: parsedBody.today,
    accounts: parsedBody.accounts,
    currencies: parsedBody.currencies,
   }),
   config: {
    systemInstruction: buildSystemInstruction(languageName),
    responseMimeType: 'application/json',
    responseSchema: RESPONSE_SCHEMA,
   },
  });

  if (response.promptFeedback?.blockReason || response.candidates?.[0]?.finishReason === 'SAFETY') {
   return NextResponse.json({ error: 'refused' }, { status: 502 });
  }

  const raw = response.text;
  if (!raw) {
   return NextResponse.json({ error: 'ai_request_failed' }, { status: 502 });
  }

  const result = ParsedTransaction.parse(JSON.parse(raw));

  // Defense in depth beyond the prompt: never trust an id back that wasn't in what we sent.
  const accountIds = new Set(parsedBody.accounts.map((a) => a.id));
  const currencyIds = new Set(parsedBody.currencies.map((c) => c.id));
  if (result.accountFromId != null && !accountIds.has(result.accountFromId)) result.accountFromId = null;
  if (result.accountToId != null && !accountIds.has(result.accountToId)) result.accountToId = null;
  if (result.currencyId != null && !currencyIds.has(result.currencyId)) result.currencyId = null;

  return NextResponse.json({ parsed: result });
 } catch {
  return NextResponse.json({ error: 'ai_request_failed' }, { status: 502 });
 }
}
