import { NextResponse } from 'next/server';
import type { LiveRate } from '@/shared/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Live TRY-based FX/gold quotes from altinapi.com (https://altinapi.com/docs/). Proxied
// through the server so the API key never ships in the client bundle. Requires
// ALTINAPI_KEY to be set — no hardcoded fallback, since that would ship a real secret
// in source.
const ALTINAPI_URL = 'https://altinapi.com/api/v1/prices';
const ALTINAPI_KEY = process.env.ALTINAPI_KEY;

// The upstream feed carries 200+ symbols (every metal/gold-jewelry/cross-pair variant it
// tracks); the app only shows this curated set, in this order, matching the reference
// Harem Altın "Döviz" (forex) tab.
const DISPLAY_SYMBOLS = ['USDTRY', 'EURTRY', 'EURUSD', 'GBPTRY', 'CHFTRY', 'AUDTRY', 'CADTRY', 'SARTRY', 'JPYTRY'];

// A quote value may arrive as a number or a numeric string — coerce defensively.
const num = (value: unknown): number => {
 const n = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
 return Number.isFinite(n) ? n : 0;
};

type UpstreamQuote = {
 symbol?: string;
 bid?: unknown;
 ask?: unknown;
 timestamp?: unknown;
};

type UpstreamResponse = {
 data?: UpstreamQuote[];
 updatedAt?: string;
};

export async function GET() {
 if (!ALTINAPI_KEY) {
  return NextResponse.json({ ok: false, error: 'missing_api_key' }, { status: 500 });
 }

 try {
  const upstream = await fetch(ALTINAPI_URL, {
   headers: { 'X-API-Key': ALTINAPI_KEY },
   // Always fetch fresh quotes; this feed is meant to be live.
   cache: 'no-store',
  });

  if (!upstream.ok) {
   return NextResponse.json({ ok: false, error: `upstream_${upstream.status}` }, { status: 502 });
  }

  const body = (await upstream.json()) as UpstreamResponse;
  const data = Array.isArray(body?.data) ? body.data : [];
  const bySymbol = new Map(data.map((entry) => [entry.symbol, entry]));

  const rates: LiveRate[] = DISPLAY_SYMBOLS.flatMap((symbol) => {
   const entry = bySymbol.get(symbol);
   if (!entry) return [];
   const timestampMs = num(entry.timestamp);
   return [
    {
     code: symbol,
     buy: num(entry.bid),
     sell: num(entry.ask),
     high: 0,
     low: 0,
     time: timestampMs ? new Date(timestampMs).toISOString() : body.updatedAt || '',
    },
   ];
  });

  return NextResponse.json({ ok: true, rates, timestamp: body.updatedAt || new Date().toISOString() });
 } catch {
  return NextResponse.json({ ok: false, error: 'fetch_failed' }, { status: 502 });
 }
}
