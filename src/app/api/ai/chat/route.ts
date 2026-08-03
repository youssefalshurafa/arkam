import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { GoogleGenAI, Type, type Content } from '@google/genai';
import { authOptions } from '@/server/auth-options';
import { AI_MODEL, AI_THINKING_CONFIG } from '@/server/ai-config';
import { filterRealClientAccounts } from '@/shared/utils/systemAccounts';
import { computeAccountBalances } from '@/shared/utils/accountBalances';
import type { Client, ClientAccount, Transaction } from '@/shared/types';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authDb = require('@/server/auth-db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const db = require('@/server/db');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Natural-language "ask your ledger a question" chat. Unlike the other two AI routes, this one
// gives Gemini tools instead of raw data — the model never does arithmetic on money itself, it
// calls a tool and the server computes the real answer via the same computeAccountBalances used
// by the ledger UI (src/shared/utils/accountBalances.ts). The route is stateless: the client
// holds the conversation history (opaque Content[] this route hands back each turn) and resends
// it with the next message, same pattern as every other route in this app.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const MAX_HISTORY_ENTRIES = 60;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_TOOL_ITERATIONS = 5;
const MAX_BALANCE_ROWS = 300;
const MAX_TRANSACTION_ROWS = 100;

const LANGUAGE_NAMES: Record<string, string> = {
 en: 'English',
 ar: 'Arabic',
 fr: 'French',
};

function createAppLike(workspaceId: string, userId: string, role: string) {
 return {
  workspaceId,
  todayKey: null as string | null,
  userId,
  role,
  getPath(name: string) {
   const root = process.cwd();
   if (name === 'userData') return path.join(root, 'database');
   return root;
  },
 };
}

function getWorkspaceId(sessionWorkspaceId: string | null | undefined, headerWorkspaceId: string | null): string | null {
 if (headerWorkspaceId?.trim()) return headerWorkspaceId.trim();
 if (sessionWorkspaceId?.trim()) return sessionWorkspaceId.trim();
 return null;
}

const GET_BALANCES_TOOL = {
 name: 'get_client_balances',
 description:
  "Returns the current balance for every individual CLIENT account in the workspace, per currency. balance > 0 means the client owes the workspace owner (a debit); balance < 0 means the workspace owner owes the client (a credit); balance === 0 means settled. Use this for questions about a specific client. For a question about an ORGANIZATION (a group of clients), use get_organization_balances instead — client and organization names are different things and may not match each other. Always call one of these rather than guessing or computing from other data.",
 parameters: { type: Type.OBJECT, properties: {} },
};

const GET_ORGANIZATION_BALANCES_TOOL = {
 name: 'get_organization_balances',
 description:
  'Returns the current balance for every ORGANIZATION in the workspace, per currency — the sum of all its member clients\' balances (clients with no organization, or excluded from balance totals, are not included in any organization total). Same sign convention as get_client_balances: balance > 0 is a debit (owed to the workspace owner), balance < 0 is a credit (owed by the workspace owner). Use this for questions about an organization/group rather than a single client.',
 parameters: { type: Type.OBJECT, properties: {} },
};

const LIST_TRANSACTIONS_TOOL = {
 name: 'list_recent_transactions',
 description:
  'Lists recent transactions, most recent first. Optionally filter by client name (partial match), currency code, and/or onlyPendingRate. Each returned row includes hasPendingRate: true when that transaction involves a currency different from the sending/receiving account\'s own currency and no exchange rate has been entered for it yet — shown in the ledger as awaiting a rate and excluded from the balance until one is set. Use this field for any question about pending/unset/awaiting exchange rates; never guess that answer from the description or amount alone.',
 parameters: {
  type: Type.OBJECT,
  properties: {
   clientName: { type: Type.STRING, description: 'Optional: only transactions involving a client whose name contains this text (case-insensitive).' },
   currencyCode: { type: Type.STRING, description: 'Optional: only transactions in this currency, e.g. "EUR".' },
   limit: { type: Type.NUMBER, description: `Max rows to return, default 20, capped at ${MAX_TRANSACTION_ROWS}.` },
   onlyPendingRate: {
    type: Type.BOOLEAN,
    description: 'Optional: if true, only return transactions with hasPendingRate: true. Use this for a question specifically about pending/awaiting rates, so an older one is not missed outside the default row limit.',
   },
  },
 },
};

type BalanceRow = { clientName: string; currencyCode: string; balance: number };
type OrganizationBalanceRow = { organizationName: string; currencyCode: string; balance: number };
type TransactionRow = {
 date: string;
 description: string;
 amount: number;
 currencyCode: string;
 clientFromName: string;
 clientToName: string;
 type: string;
 hasPendingRate: boolean;
};

// Same rule the ledger itself uses per account side (src/features/ledger/utils/ledgerBalances.ts)
// generalized to "either side of this transaction", since this tool has no single account to view
// it from. A cross-currency leg with no rate entered yet is pending — except an "exchange" (صرف)
// transaction with a recorded actual destination amount, which is never pending on the "to" side.
function transactionHasPendingRate(tx: Transaction): boolean {
 const hasExchangeActual = tx.type === 'exchange' && tx.exchangeActualAmount != null;
 const fromPending = tx.accountFromId != null && tx.accountFromCurrencyCode !== tx.currencyCode && tx.exchangeRateFrom === 0;
 const toPending = !hasExchangeActual && tx.accountToId != null && tx.accountToCurrencyCode !== tx.currencyCode && tx.exchangeRateTo === 0;
 return fromPending || toPending;
}

function buildBalanceRows(clientAccounts: ClientAccount[], transactions: Transaction[]): BalanceRow[] {
 const realAccounts = filterRealClientAccounts(clientAccounts);
 const balances = computeAccountBalances({ clientAccounts: realAccounts, transactions });
 return realAccounts
  .map((account) => ({ clientName: account.clientName, currencyCode: account.currencyCode, balance: balances.get(account.id) ?? 0 }))
  .slice(0, MAX_BALANCE_ROWS);
}

// Real, exact aggregation done here in JS — never left for the model to sum itself. Mirrors
// the same excludeFromBalance rule the Organizations page already applies (Client type comment,
// src/shared/types.ts) so this answers consistently with what the UI shows.
function buildOrganizationBalanceRows(clientAccounts: ClientAccount[], transactions: Transaction[], clients: Client[]): OrganizationBalanceRow[] {
 const realAccounts = filterRealClientAccounts(clientAccounts);
 const balances = computeAccountBalances({ clientAccounts: realAccounts, transactions });
 const clientById = new Map(clients.map((c) => [c.id, c]));

 // Keyed by organizationName -> currencyCode -> running total, avoiding a composite string
 // key built out of names that may themselves contain spaces/punctuation.
 const totals = new Map<string, Map<string, number>>();
 for (const account of realAccounts) {
  const client = clientById.get(account.clientId ?? -1);
  if (!client || !client.organizationName || client.excludeFromBalance) continue;
  let byCurrency = totals.get(client.organizationName);
  if (!byCurrency) {
   byCurrency = new Map<string, number>();
   totals.set(client.organizationName, byCurrency);
  }
  byCurrency.set(account.currencyCode, (byCurrency.get(account.currencyCode) ?? 0) + (balances.get(account.id) ?? 0));
 }

 const rows: OrganizationBalanceRow[] = [];
 for (const [organizationName, byCurrency] of totals) {
  for (const [currencyCode, balance] of byCurrency) {
   rows.push({ organizationName, currencyCode, balance });
  }
 }
 return rows.slice(0, MAX_BALANCE_ROWS);
}


function listRecentTransactions(transactions: Transaction[], args: { clientName?: string; currencyCode?: string; limit?: number; onlyPendingRate?: boolean }): TransactionRow[] {
 const nameFilter = args.clientName?.trim().toLowerCase();
 const currencyFilter = args.currencyCode?.trim().toUpperCase();
 const limit = Math.max(1, Math.min(MAX_TRANSACTION_ROWS, Math.floor(args.limit ?? 20)));

 return transactions
  .filter((tx) => !tx.isArchived)
  .filter((tx) => !nameFilter || tx.clientFromName?.toLowerCase().includes(nameFilter) || tx.clientToName?.toLowerCase().includes(nameFilter))
  .filter((tx) => !currencyFilter || tx.currencyCode?.toUpperCase() === currencyFilter)
  .filter((tx) => !args.onlyPendingRate || transactionHasPendingRate(tx))
  .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  .slice(0, limit)
  .map((tx) => ({
   // db.listTransactions returns raw `pg` rows, where a timestamp column comes back as a native
   // Date object, not a string — unlike everywhere else in the app, which only ever sees this
   // field after it's passed through NextResponse.json() (Date -> ISO string via JSON.stringify).
   // This route calls the db layer directly, so it must do that conversion itself.
   date: new Date(tx.createdAt).toISOString().slice(0, 10),
   description: tx.description || '',
   amount: tx.amount,
   currencyCode: tx.currencyCode,
   clientFromName: tx.clientFromName || '',
   clientToName: tx.clientToName || '',
   type: tx.type,
   hasPendingRate: transactionHasPendingRate(tx),
  }));
}

function buildSystemInstruction(languageName: string): string {
 return (
  'You are a bookkeeping assistant answering questions about the workspace owner\'s client ledger. ' +
  'You have tools that query the real, exact data — always use them for any question involving ' +
  'balances, amounts, or transactions rather than guessing or computing from memory of earlier ' +
  'turns; call a tool again if you need up-to-date figures. A "client" and an "organization" (a ' +
  'group of clients) are different things with separate tools — pick whichever the question is ' +
  'actually about. A name in the question is often partial relative to what a tool returns — just ' +
  'a first name, a last name, or a nickname rather than the full registered name (e.g. the ' +
  'question says "الفرشم" but a returned row is named "رشيد الفرشم") — treat a fragment that ' +
  'uniquely identifies exactly one row as a confident match rather than requiring an exact ' +
  'full-string match. Only treat a name as not matching when it does not plausibly correspond to ' +
  'any returned row, or could equally refer to more than one; in that case say so plainly rather ' +
  'than guessing which one was meant or answering about the wrong one. If you are unable to get a ' +
  'real answer (e.g. after retrying), say briefly that you could not ' +
  'find that information, rather than describing an internal error. Report currency amounts with ' +
  'their currency code (e.g. "1,000 EUR"). When stating a balance, NEVER describe it as ' +
  '"positive"/"negative" (or a translation of those words) — the balance tools return a signed ' +
  'number only so you can tell which direction it goes, not as bookkeeping language to repeat. ' +
  'Instead say whether it is a debit (balance > 0, the client/organization owes the workspace ' +
  'owner) or a credit (balance < 0, the workspace owner owes the client/organization), using the ' +
  'magnitude only (drop the minus sign) alongside that word. In English or French use ' +
  '"debit"/"credit"; in Arabic use "لنا" for a debit (owed to us) and "له" for a credit (owed to ' +
  'them) — this app\'s own convention — not the literal translations "دائن"/"مدين". A zero ' +
  'balance is simply settled, with nothing owed either way. Keep answers to 1–2 short sentences — ' +
  `a direct answer, not a report. Plain text only: no markdown, no bold/asterisks, no bullet ` +
  `lists, no headers. Respond in ${languageName}.`
 );
}

export async function POST(request: NextRequest) {
 const session = await getServerSession(authOptions);
 if (!session?.user?.id) {
  return NextResponse.json({ error: 'Unauthorized. Please sign in.' }, { status: 401 });
 }
 // Same admin-granted permission gate as the other two AI routes.
 if (session.user.aiEnabled !== true) {
  return NextResponse.json({ error: 'AI features are not enabled for this account.' }, { status: 403 });
 }
 if (!GEMINI_API_KEY) {
  return NextResponse.json({ error: 'missing_api_key' }, { status: 500 });
 }

 const workspaceId = getWorkspaceId(session.user.defaultWorkspaceId, request.headers.get('x-workspace-id'));
 if (!workspaceId) {
  return NextResponse.json({ error: 'No workspace selected.' }, { status: 400 });
 }
 const role = await authDb.getWorkspaceRole(session.user.id, workspaceId);
 if (!role) {
  return NextResponse.json({ error: 'Access denied for this workspace.' }, { status: 403 });
 }

 let body: { language?: string; message?: string; history?: unknown };
 try {
  body = await request.json();
 } catch {
  return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
 }
 const message = typeof body.message === 'string' ? body.message.trim() : '';
 if (!message || message.length > MAX_MESSAGE_LENGTH) {
  return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
 }
 const priorHistory = Array.isArray(body.history) ? (body.history as Content[]) : [];
 if (priorHistory.length > MAX_HISTORY_ENTRIES) {
  return NextResponse.json({ error: 'conversation_too_long' }, { status: 400 });
 }

 const appLike = createAppLike(workspaceId, session.user.id, role);

 try {
  const [clientAccounts, transactions, clients] = await Promise.all([db.listAllClientAccounts(appLike), db.listTransactions(appLike), db.listClients(appLike)]);

  const languageName = LANGUAGE_NAMES[body.language ?? 'en'] ?? LANGUAGE_NAMES.en;
  const client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const tools = [{ functionDeclarations: [GET_BALANCES_TOOL, GET_ORGANIZATION_BALANCES_TOOL, LIST_TRANSACTIONS_TOOL] }];

  const contents: Content[] = [...priorHistory, { role: 'user', parts: [{ text: message }] }];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i += 1) {
   // On the final attempt, omit tools entirely so the model is forced to produce a text
   // answer from whatever it has already gathered, instead of the request just running out
   // of iterations and the user getting a bare technical error.
   const isLastAttempt = i === MAX_TOOL_ITERATIONS - 1;
   const response = await client.models.generateContent({
    model: AI_MODEL,
    contents,
    config: {
     systemInstruction: buildSystemInstruction(languageName),
     thinkingConfig: AI_THINKING_CONFIG,
     ...(isLastAttempt ? {} : { tools, automaticFunctionCalling: { disable: true } }),
    },
   });

   if (response.promptFeedback?.blockReason || response.candidates?.[0]?.finishReason === 'SAFETY') {
    return NextResponse.json({ error: 'refused' }, { status: 502 });
   }

   const calls = isLastAttempt ? undefined : response.functionCalls;
   if (!calls || calls.length === 0) {
    // response.candidates[0].content sometimes comes back without a `role` — per the SDK's own
    // Content type, an unset role defaults to 'user' server-side, which would misattribute the
    // model's own final answer to the user on the next turn. Set it explicitly.
    const finalTurn = response.candidates?.[0]?.content;
    if (finalTurn) contents.push({ ...finalTurn, role: 'model' });
    return NextResponse.json({ text: response.text || '...', history: contents });
   }

   // Same missing-role issue applies to intermediate tool-call turns — and matters more here,
   // since each one carries a thoughtSignature that must be correctly attributed back to the
   // model on every later request or the API rejects it as a corrupted signature.
   const modelTurn = response.candidates?.[0]?.content;
   if (modelTurn) contents.push({ ...modelTurn, role: 'model' });

   const responseParts = calls.map((call) => {
    let result: unknown;
    if (call.name === 'get_client_balances') {
     result = buildBalanceRows(clientAccounts as ClientAccount[], transactions as Transaction[]);
    } else if (call.name === 'get_organization_balances') {
     result = buildOrganizationBalanceRows(clientAccounts as ClientAccount[], transactions as Transaction[], clients as Client[]);
    } else if (call.name === 'list_recent_transactions') {
     const args = (call.args ?? {}) as { clientName?: string; currencyCode?: string; limit?: number; onlyPendingRate?: boolean };
     result = listRecentTransactions(transactions as Transaction[], args);
    } else {
     result = { error: `Unknown tool: ${call.name}` };
    }
    return { functionResponse: { id: call.id, name: call.name, response: { result } } };
   });
   contents.push({ role: 'user', parts: responseParts });
  }

  return NextResponse.json({ error: 'ai_request_failed' }, { status: 502 });
 } catch (e) {
  // Previously swallowed silently — logged now since this is the only way to see what actually
  // failed (a Gemini API error, a bug in one of the tool-dispatch functions, etc.). `detail` is
  // temporary: surfaced in the response too so it's visible without needing server-log access
  // while tracking down a live bug — remove once this route is confirmed stable again.
  const detail = e instanceof Error ? e.message : String(e);
  console.error('[ai/chat] request failed:', e);
  return NextResponse.json({ error: 'ai_request_failed', detail }, { status: 502 });
 }
}
