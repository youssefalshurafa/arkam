import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { GoogleGenAI } from '@google/genai';
import * as z from 'zod/v4';
import { authOptions } from '@/server/auth-options';
import { AI_MODEL, AI_THINKING_CONFIG, AI_EXTRACTION_TEMPERATURE } from '@/server/ai-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// AI-powered ledger review: a semantic second pass over the statistical anomaly checks in
// src/features/ledger/utils/ledgerAnomalies.ts. Those checks catch magnitude outliers; this
// catches the class of mistake that looks numerically normal but contradicts the transaction's
// own description (e.g. a rate value typed into the commission field). Proxied server-side so
// the API key never ships to the client, mirroring src/app/api/live-rates/route.ts.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Caps the request size (latency + cost) for very large export ranges. Reviewing this many
// rows in one call is still enough for a meaningful pass; a larger range only reviews its
// first slice, which is preferable to a request that never returns.
const MAX_ENTRIES = 200;

const EntrySchema = z.object({
 transactionId: z.number(),
 date: z.string(),
 description: z.string(),
 amount: z.number(),
 currencyCode: z.string(),
 exchangeRate: z.number(),
 commission: z.number(),
 direction: z.enum(['incoming', 'outgoing']),
});

// The app's three UI languages (src/contexts/LanguageContext.tsx). Falls back to English
// for anything else rather than rejecting the request.
const LANGUAGE_NAMES: Record<string, string> = {
 en: 'English',
 ar: 'Arabic',
 fr: 'French',
};

const RequestSchema = z.object({
 language: z.string().optional(),
 entries: z.array(EntrySchema).min(1).max(MAX_ENTRIES),
});

const ReviewResult = z.object({
 flagged: z.array(
  z.object({
   transactionId: z.number(),
   concern: z.string(),
  }),
 ),
});

// Hand-written rather than derived from the Zod schema above — Gemini's responseSchema only
// supports a subset of JSON Schema (no $ref, limited keyword support), and this shape is
// simple enough that keeping it in sync by hand is less risk than a lossy auto-conversion.
const RESPONSE_SCHEMA = {
 type: 'object',
 properties: {
  flagged: {
   type: 'array',
   items: {
    type: 'object',
    properties: {
     transactionId: { type: 'number' },
     concern: { type: 'string' },
    },
    required: ['transactionId', 'concern'],
   },
  },
 },
 required: ['flagged'],
};

function buildSystemInstruction(languageName: string): string {
 return (
  'You are a meticulous bookkeeping reviewer performing a second-opinion pass on a list of ' +
  'ledger transactions (date, free-text description, amount, currency, exchange rate, ' +
  'commission percentage, direction) from the same client account. Flag a transaction if ' +
  'EITHER of the following holds:\n' +
  '1. Description mismatch: the description implies something the numbers contradict or omit ' +
  '— e.g. it mentions a rate/figure that does not match the stored exchange rate, or a ' +
  'rate-like number appears to have been entered in the commission field instead of the rate ' +
  'field.\n' +
  '2. Magnitude outlier: the exchange rate or commission is an obvious data-entry slip relative ' +
  'to the OTHER transactions in this same list for the same currency — most often a misplaced ' +
  'decimal point, i.e. a rate that is roughly 10x, 100x, or 1000x another transaction\'s rate ' +
  'for the same currency (e.g. 1065.00 appearing when other same-currency transactions show ' +
  '10.65). Compare within the same currency only; different currencies naturally have very ' +
  'different rate magnitudes and that is not itself a problem.\n' +
  'Do not flag ordinary variation in commission or rate values that has no such contradiction ' +
  `or outlier pattern. Write every "concern" string in ${languageName}, since that is the ` +
  'language the reviewing accountant reads. Respond with JSON matching the given schema. If ' +
  'nothing looks wrong, return an empty "flagged" list.'
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
  const requestConfig = {
   model: AI_MODEL,
   contents: JSON.stringify(parsedBody.entries.slice(0, MAX_ENTRIES)),
   config: {
    systemInstruction: buildSystemInstruction(languageName),
    responseMimeType: 'application/json',
    responseSchema: RESPONSE_SCHEMA,
    thinkingConfig: AI_THINKING_CONFIG,
    temperature: AI_EXTRACTION_TEMPERATURE,
   },
  };

  // One retry on a malformed/schema-invalid response — a single bad generation shouldn't fail
  // the whole request outright.
  let result: z.infer<typeof ReviewResult> | null = null;
  for (let attempt = 0; attempt < 2 && !result; attempt += 1) {
   const response = await client.models.generateContent(requestConfig);

   if (response.promptFeedback?.blockReason || response.candidates?.[0]?.finishReason === 'SAFETY') {
    return NextResponse.json({ error: 'refused' }, { status: 502 });
   }

   const raw = response.text;
   if (!raw) continue;
   try {
    result = ReviewResult.parse(JSON.parse(raw));
   } catch {
    result = null;
   }
  }
  if (!result) {
   return NextResponse.json({ error: 'ai_request_failed' }, { status: 502 });
  }
  return NextResponse.json({ flagged: result.flagged });
 } catch {
  return NextResponse.json({ error: 'ai_request_failed' }, { status: 502 });
 }
}
