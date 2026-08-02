import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { GoogleGenAI } from '@google/genai';
import * as z from 'zod/v4';
import { authOptions } from '@/server/auth-options';
import { AI_MODEL, AI_THINKING_CONFIG, AI_EXTRACTION_TEMPERATURE } from '@/server/ai-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Natural-language bulk edit for an open ledger's exchange rates (e.g. "starting from 27/07 the
// rate for Berlin is 10.76, then Costa 10.88"). This route ONLY PROPOSES edits — it never writes
// to the database. The client shows every proposed edit for the user to review/uncheck, and only
// on explicit confirmation does the existing per-row save machinery
// (openLedgerRowForEdit/updateLedgerTransactionDraft/onSaveAllLedger in useLedgerActions.ts) apply
// them, so reconciliation-lock checks and everything else that already guards manual edits still
// applies unchanged. The model is given the real entries and must return only transactionIds that
// were actually in that list — never left to guess an id.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const MAX_COMMAND_LENGTH = 500;
const MAX_ENTRIES = 300;

const LANGUAGE_NAMES: Record<string, string> = {
 en: 'English',
 ar: 'Arabic',
 fr: 'French',
};

const EntrySchema = z.object({
 transactionId: z.number(),
 date: z.string(),
 counterpartyName: z.string(),
 description: z.string().optional(),
 exchangeRate: z.number(),
 currencyCode: z.string(),
 isHighlighted: z.boolean().optional(),
});

const RequestSchema = z.object({
 language: z.string().optional(),
 command: z.string().min(1).max(MAX_COMMAND_LENGTH),
 entries: z.array(EntrySchema).min(1).max(MAX_ENTRIES),
});

const EditSchema = z.object({
 transactionId: z.number(),
 newExchangeRate: z.number(),
});

const ResultSchema = z.object({
 edits: z.array(EditSchema),
});

const RESPONSE_SCHEMA = {
 type: 'object',
 properties: {
  edits: {
   type: 'array',
   items: {
    type: 'object',
    properties: {
     transactionId: { type: 'number' },
     newExchangeRate: { type: 'number' },
    },
    required: ['transactionId', 'newExchangeRate'],
   },
  },
 },
 required: ['edits'],
};

function buildSystemInstruction(languageName: string): string {
 return (
  'You extract exchange-rate edits from a bookkeeping command for a ledger you are given as a ' +
  'list of existing transactions (transactionId, date, counterpartyName, description, current ' +
  'exchangeRate, currencyCode, isHighlighted). The command names an entity (often a place or ' +
  'party) and new rate values, e.g. "starting from 27/07 the rate for Berlin is 10.76, then ' +
  'Costa 10.88, then France 10.70" — meaning: for each named entity, set the exchange rate of ' +
  'every matching transaction to the given value, only considering transactions on or after the ' +
  'stated start date (if any date scoping is given; with no date scoping, consider all given ' +
  'transactions).\n\n' +
  'Two name fields: counterpartyName is the formal client/counterparty name; description is a ' +
  'free-text note the user types per-transaction, very often naming a place or label (e.g. ' +
  '"Milano", "Berlin", "usdt") that is NOT the same as counterpartyName and does not appear ' +
  'anywhere else. A name in the command may match EITHER field — always check both, and prefer ' +
  'whichever field actually contains a plausible match rather than assuming it must be ' +
  'counterpartyName.\n\n' +
  'Highlighted rows: isHighlighted:true/false has ALREADY been fully resolved for you by the ' +
  'app — it marks entries within the ledger UI\'s "highlighted rows" range (an independent ' +
  'selection the user made before giving this command, using the app\'s existing highlight ' +
  'feature; the range logic, including what "between" the highlighted rows means, is computed ' +
  'in code, not by you). Do not try to infer or recompute a date range yourself from the entries ' +
  '— just use the isHighlighted flag exactly as given.\n' +
  'If the command refers to "the highlighted rows", "the marked rows", "the selected rows", "the ' +
  'colored rows", "between the highlighted/colored rows" (or an equivalent phrase/synonym in ' +
  'another language — e.g. Arabic "الصفوف الملونة/المظللة/المحددة"), you MUST restrict matching ' +
  'to ONLY entries with isHighlighted:true — completely ignore every entry with ' +
  'isHighlighted:false, even if its counterpartyName or description matches the command, no ' +
  'matter how many other transactions elsewhere in the ledger share that same name. If the ' +
  'command references highlighted rows but none of the given entries have isHighlighted:true, ' +
  'return an empty edits list rather than guessing which rows were meant.\n' +
  'If the command does NOT reference highlighted/marked/selected/colored rows at all, ignore the ' +
  'isHighlighted field entirely and match against every given entry as usual.\n\n' +
  'Rules:\n' +
  '- transactionId MUST be one of the ids in the given entries list. Never invent an id.\n' +
  '- Match a named entity against counterpartyName and description case-insensitively and ' +
  'tolerate minor spelling/transliteration differences, but only when reasonably confident — a ' +
  'name in the command that does not plausibly match anything in either field should simply ' +
  'produce no edit for that name, not a guess at the closest unrelated name. A name in the ' +
  'command is also often partial (a first name only, a last name only, a nickname, or a fragment ' +
  'of a longer counterpartyName/description) rather than an exact full match — treat a fragment ' +
  'that uniquely identifies one entity as a confident match, the same way you would an exact ' +
  'name.\n' +
  '- When the command names a country, region, or nationality (e.g. "Germany", "the UK", "Gulf ' +
  'clients") rather than one specific place/person, treat every counterpartyName or description ' +
  'that names any city, town, or place you know to be located in that country/region as a ' +
  'confident match — including less globally-famous places, not only capitals or major cities. Be ' +
  'liberal here: for a geographic filter, err toward including a plausible place in that country ' +
  'rather than excluding it, since this is different from the cautious exact/fragment ' +
  'name-matching described above.\n' +
  '- If a name matches MORE THAN ONE transaction (e.g. it appears twice within the date scope), ' +
  'include an edit for EVERY matching transaction rather than guessing which single one was ' +
  'meant — the human reviewing your proposal will decide which to keep.\n' +
  '- newExchangeRate is the plain rate number as stated, not a percentage or a computed value. ' +
  'The command may spell the rate out in words rather than digits (this is common with ' +
  'voice-dictated commands) — compute its exact value by working out each place value and ' +
  'summing them, never by concatenating or truncating the individual number words. For example ' +
  'the Arabic "خمسة وعشرين ألف وأحد عشر" (literally "twenty-five thousand and eleven") is 25011, ' +
  'not 2511.\n' +
  `- If nothing in the command matches anything in the entries, return an empty edits list.\n\n` +
  `The user's own language for this session is ${languageName}, but this only affects how you ` +
  'interpret the command text — your output is structured data, not prose, so there is nothing ' +
  'to translate in the response.'
 );
}

export async function POST(request: NextRequest) {
 const session = await getServerSession(authOptions);
 if (!session?.user?.id) {
  return NextResponse.json({ error: 'Unauthorized. Please sign in.' }, { status: 401 });
 }
 // Same admin-granted permission gate as the other AI routes.
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
   contents: JSON.stringify({ command: parsedBody.command, entries: parsedBody.entries }),
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
  let result: z.infer<typeof ResultSchema> | null = null;
  for (let attempt = 0; attempt < 2 && !result; attempt += 1) {
   const response = await client.models.generateContent(requestConfig);

   if (response.promptFeedback?.blockReason || response.candidates?.[0]?.finishReason === 'SAFETY') {
    return NextResponse.json({ error: 'refused' }, { status: 502 });
   }

   const raw = response.text;
   if (!raw) continue;
   try {
    result = ResultSchema.parse(JSON.parse(raw));
   } catch {
    result = null;
   }
  }
  if (!result) {
   return NextResponse.json({ error: 'ai_request_failed' }, { status: 502 });
  }

  // Defense in depth: never trust an id back that wasn't in what we sent, and drop any
  // duplicate proposals for the same transaction (keep the first).
  const validIds = new Set(parsedBody.entries.map((e) => e.transactionId));
  const seen = new Set<number>();
  const edits = result.edits.filter((edit) => {
   if (!validIds.has(edit.transactionId) || seen.has(edit.transactionId)) return false;
   seen.add(edit.transactionId);
   return true;
  });

  return NextResponse.json({ edits });
 } catch {
  return NextResponse.json({ error: 'ai_request_failed' }, { status: 502 });
 }
}
