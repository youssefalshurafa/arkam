import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { ZodType } from 'zod';

// Shared plumbing for the auth / account / admin API routes.

/**
 * node-postgres errors carry a string SQLSTATE `code` and a `severity`; the intentional,
 * user-facing errors thrown by auth-db.js/db.js are plain Errors without either. Raw pg
 * messages can name tables, columns and constraint values, so they never reach a client.
 */
export function isDatabaseError(error: unknown): boolean {
 if (typeof error !== 'object' || error === null) return false;
 const candidate = error as { code?: unknown; severity?: unknown };
 return typeof candidate.code === 'string' && typeof candidate.severity === 'string';
}

/**
 * Converts a thrown error into a JSON error response without leaking database details.
 * Intentional errors may carry a machine-readable `code` (e.g. VerificationError), which is
 * passed through so the client can branch on it.
 */
export function errorResponse(error: unknown, fallback: string, status = 400, logLabel = 'api'): NextResponse {
 if (isDatabaseError(error)) {
  console.error(`[${logLabel}] database error`, error);
  return NextResponse.json({ error: 'A server error occurred. Please try again.' }, { status: 500 });
 }
 const message = error instanceof Error && error.message ? error.message : fallback;
 const code = typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : undefined;
 return NextResponse.json(code ? { error: message, code } : { error: message }, { status });
}

/** Body parse that never throws: malformed JSON (or none) becomes an empty object. */
export async function readJson(request: NextRequest | Request): Promise<Record<string, unknown>> {
 try {
  const value = await request.json();
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
 } catch {
  return {};
 }
}

/**
 * Parses + validates a JSON body against a zod schema. Returns the typed data, or a ready
 * 400 response listing the first problem. Unknown keys are stripped by the schema.
 */
export async function parseBody<T>(
 request: NextRequest | Request,
 schema: ZodType<T>,
): Promise<{ data: T; response?: undefined } | { data?: undefined; response: NextResponse }> {
 const raw = await readJson(request);
 const result = schema.safeParse(raw);
 if (!result.success) {
  const issue = result.error.issues[0];
  const message = issue?.message && !issue.message.startsWith('Invalid input') ? issue.message : 'Invalid request.';
  return { response: NextResponse.json({ error: message }, { status: 400 }) };
 }
 return { data: result.data };
}

export function tooManyRequests(retryAfterSeconds: number, message = 'Too many attempts. Please wait a few minutes and try again.'): NextResponse {
 return NextResponse.json(
  { error: message, code: 'RATE_LIMITED', retryAfterSeconds },
  { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))) } },
 );
}

/**
 * Identifies an uploaded image from its leading bytes. The browser-declared File.type is
 * whatever the client says it is, so it can't be trusted for what we store and later serve.
 */
export function sniffImageMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
 if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
  return 'image/png';
 }
 if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
  return 'image/jpeg';
 }
 if (
  bytes.length >= 12 &&
  bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // RIFF
  bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 // WEBP
 ) {
  return 'image/webp';
 }
 return null;
}
