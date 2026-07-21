import type { PdfSettings } from '@/shared/types';

// Local calendar day as `yyyy-mm-dd`. Used wherever "today" must mean the user's own
// wall-clock day rather than the UTC day (`new Date().toISOString()` would give the UTC
// date, which is a day off for part of the day in non-UTC timezones).
export function localDateKey(date = new Date()): string {
 const p = (n: number) => String(n).padStart(2, '0');
 return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

// The current local wall-clock as an ISO-like `yyyy-mm-ddThh:mm:ss.mmmZ` string whose
// DIGITS are the local time (not a UTC conversion). The app stores/reads createdAt as a
// naive wall-clock string (see formatTimeValue), so recording the real local time here
// makes displayed times accurate and keeps the embedded date === the user's local date.
// The trailing Z pins those exact digits when the value round-trips through a TIMESTAMPTZ
// column (Postgres session tz is UTC), so what is read back matches what was entered.
export function localWallClock(date = new Date()): string {
 const p = (n: number, len = 2) => String(n).padStart(len, '0');
 return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}.${p(date.getMilliseconds(), 3)}Z`;
}

// Recovers the true epoch from a createdAt string produced by localWallClock (or its
// space-separated DB equivalent). Its digits are local wall-clock time despite the
// trailing 'Z', so it must NOT be parsed with Date.parse/`new Date(str)` — those read
// the 'Z' literally and treat the digits as UTC, shifting the result by the local UTC
// offset (e.g. producing a time hours into "tomorrow" for positive offsets). Only use
// this when the true elapsed time matters (comparing against Date.now()); plain
// Date.parse is fine for comparing two createdAt strings against each other, since both
// carry the same constant mislabeling and their relative order/diff is unaffected.
export function parseLocalWallClock(value: string): number {
 const m = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/);
 if (!m) return Date.parse(value);
 const [, y, mo, d, h, mi, s, ms] = m;
 return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), Number(ms ?? '0')).getTime();
}

// Whether a row's date falls before today (yesterday or earlier) — used together with the
// workspace's "lock past-dated edits" setting to grey out edit/delete controls in the UI.
// The actual enforcement lives server-side (route.ts/db.js); this only decides what the
// button looks like.
export function isBeforeToday(createdAt: string): boolean {
 return createdAt.slice(0, 10) < localDateKey();
}

export function formatDateValue(value: string, dateFormat: PdfSettings['dateFormat']) {
 const iso = value.slice(0, 10);
 const [y = '', m = '', d = ''] = iso.split('-');
 switch (dateFormat) {
  case 'day-month':
   return `${d}/${m}`;
  case 'month-year':
   return `${m}/${y}`;
  case 'day-month-year-2':
   return `${d}/${m}/${y.slice(2)}`;
  case 'month-day':
   return `${m}/${d}`;
  default:
   return iso;
 }
}

// Extracts "HH:mm" from a raw local-time createdAt string ("YYYY-MM-DD HH:mm:ss" or
// "YYYY-MM-DDTHH:mm:ss") without going through Date/timezone conversion.
export function formatTimeValue(value: string): string {
 const sep = value.includes('T') ? 'T' : ' ';
 const timePart = value.split(sep)[1] ?? '';
 return timePart.slice(0, 5);
}
