import { NextResponse } from 'next/server';
import type { LiveRate } from '@/shared/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Live TRY-based FX quotes from the Harem Altin RapidAPI feed. Proxied through the
// server so the RapidAPI key never ships in the client bundle. The key is read
// from the HAREM_RAPIDAPI_KEY env var; the literal fallback keeps the feature
// working out of the box and should be moved into the environment for production.
const RAPIDAPI_HOST = 'live-exchange-rates-api-try-based-forex-pairs.p.rapidapi.com';
const RAPIDAPI_URL = `https://${RAPIDAPI_HOST}/harem_altin/prices/doviz/ebc099879744f4aa3e02ff6762874055`;
const RAPIDAPI_KEY = process.env.HAREM_RAPIDAPI_KEY ?? 'c879306ca8mshe548e4ad5cbee7ap1e4446jsnd676fee577fc';

// A quote value may arrive as a number or a numeric string — coerce defensively.
const num = (value: unknown): number => {
 const n = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
 return Number.isFinite(n) ? n : 0;
};

type UpstreamQuote = {
 kod?: string;
 alis?: unknown;
 satis?: unknown;
 yuksek?: unknown;
 dusuk?: unknown;
 last_update?: string;
 kayit_tarihi?: string;
};

export async function GET() {
 try {
  const upstream = await fetch(RAPIDAPI_URL, {
   headers: {
    'Content-Type': 'application/json',
    'x-rapidapi-host': RAPIDAPI_HOST,
    'x-rapidapi-key': RAPIDAPI_KEY,
   },
   // Always fetch fresh quotes; this feed is meant to be live.
   cache: 'no-store',
  });

  if (!upstream.ok) {
   return NextResponse.json({ ok: false, error: `upstream_${upstream.status}` }, { status: 502 });
  }

  const body = (await upstream.json()) as { success?: boolean; data?: UpstreamQuote[] };
  const data = Array.isArray(body?.data) ? body.data : [];

  const rates: LiveRate[] = data.map((entry) => ({
   code: String(entry.kod ?? ''),
   buy: num(entry.alis),
   sell: num(entry.satis),
   high: num(entry.yuksek),
   low: num(entry.dusuk),
   time: String(entry.last_update ?? entry.kayit_tarihi ?? ''),
  }));

  return NextResponse.json({ ok: true, rates, timestamp: new Date().toISOString() });
 } catch {
  return NextResponse.json({ ok: false, error: 'fetch_failed' }, { status: 502 });
 }
}
