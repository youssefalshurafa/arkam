'use client';

import { useQuery } from '@tanstack/react-query';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { queryKeys } from '@/lib/queryClient';
import { Spinner } from '@/components/ui/Spinner';
import { useLiveRatesHistoryStore } from '../store/liveRatesHistoryStore';
import type { LiveRatesResponse } from '@/shared/types';

const UP = '#16c784';
const DOWN = '#f0455a';

async function fetchLiveRates(): Promise<LiveRatesResponse> {
 const res = await fetch('/api/live-rates', { cache: 'no-store' });
 const body = (await res.json()) as LiveRatesResponse;
 if (!res.ok || !body.ok) throw new Error(body.error || `http_${res.status}`);
 // Accumulate price history outside React render so the sparkline/% change stay live.
 if (body.rates) useLiveRatesHistoryStore.getState().record(body.rates);
 return body;
}

// Turkish-style value (comma decimals) to mirror the reference app.
const fmtVal = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

function Sparkline({ points, color }: { points: number[]; color: string }) {
 const w = 60;
 const h = 26;
 if (points.length < 2) {
  return (
   <svg width={w} height={h} aria-hidden>
    <line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke={color} strokeWidth={1.5} opacity={0.5} />
   </svg>
  );
 }
 const min = Math.min(...points);
 const max = Math.max(...points);
 const range = max - min || 1;
 const stepX = w / (points.length - 1);
 const coords = points.map((p, i) => [i * stepX, h - ((p - min) / range) * (h - 5) - 2.5] as const);
 const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' ');
 const area = `${line} L${w},${h} L0,${h} Z`;
 return (
  <svg width={w} height={h} aria-hidden>
   <path d={area} fill={color} opacity={0.18} />
   <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
  </svg>
 );
}

export default function LiveRatesSection() {
 const { language } = useLanguage();
 const { t } = useTranslation(language);

 // The feed is only ever hit when the user opens this page (mount) or clicks
 // refresh — never on a timer, window refocus, or network reconnect.
 const { data, isLoading, isError, isFetching, refetch } = useQuery({
  queryKey: queryKeys.liveRates(),
  queryFn: fetchLiveRates,
  refetchInterval: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  refetchOnMount: 'always',
  staleTime: Infinity,
  gcTime: 0,
 });

 const rates = data?.rates ?? [];
 // Live sparkline / session-relative % change, accumulated across polls (see store).
 const history = useLiveRatesHistoryStore((s) => s.history);

 const changeOf = (code: string) => {
  const arr = history[code];
  if (!arr || arr.length < 2 || arr[0] <= 0) return 0;
  return ((arr[arr.length - 1] - arr[0]) / arr[0]) * 100;
 };

 // Localized pair name: "US Dollar" for XXXTRY, "EUR/USD" for a cross pair.
 const pairName = (code: string) => {
  const base = code.slice(0, 3);
  const quote = code.slice(3);
  if (quote === 'TRY') {
   try {
    if (typeof Intl.DisplayNames === 'function') return new Intl.DisplayNames([language], { type: 'currency' }).of(base) || base;
   } catch {
    /* fall through */
   }
   return base;
  }
  return `${base}/${quote}`;
 };

 return (
  <section className="mx-auto max-w-[430px] overflow-hidden rounded-lg border border-slate-200 shadow-sm">
   {/* Header — royal-blue gradient with brand title and the featured strip */}
   <div
    className="text-white"
    style={{ background: 'linear-gradient(165deg, #17265f 0%, #26307f 55%, #3a3a8c 100%)' }}
   >
    <div className="flex items-center justify-between px-4 pt-4">
     <span className="w-8 shrink-0" aria-hidden />
     <h1 className="font-serif text-2xl font-semibold uppercase tracking-[0.35em] ps-[0.35em]">HAREM</h1>
     <button
      type="button"
      onClick={() => refetch()}
      disabled={isFetching}
      title={t('live_rates_refresh')}
      aria-label={t('live_rates_refresh')}
      className="rounded-full p-1 text-white/90 transition hover:bg-white/10 disabled:opacity-60"
     >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={isFetching ? 'animate-spin' : ''}>
       <path d="M21 12a9 9 0 1 1-2.64-6.36" />
       <path d="M21 3v5h-5" />
      </svg>
     </button>
    </div>

    <div dir="ltr" className="mt-4 flex overflow-x-auto pb-4 text-left">
     {rates.map((rate) => {
      const change = changeOf(rate.code);
      const color = change < 0 ? DOWN : UP;
      return (
       <div key={rate.code} className="min-w-34 shrink-0 border-e border-white/10 px-4 last:border-e-0">
        <div className="text-sm font-medium text-[#8fb2ff]">{rate.code}</div>
        <div className="mt-0.5 text-2xl font-bold tabular-nums">{fmtVal(rate.sell)}</div>
        <div className="mt-1 flex items-center justify-end">
         <Sparkline points={history[rate.code] ?? []} color={color} />
        </div>
       </div>
      );
     })}
    </div>
   </div>

   {/* Body */}
   {isLoading ? (
    <div className="flex items-center justify-center gap-3 bg-white py-20 text-slate-500">
     <Spinner className="text-xl text-slate-400" />
     {t('live_rates_loading')}
    </div>
   ) : isError ? (
    <p className="bg-white px-4 py-16 text-center text-sm text-red-600">{t('live_rates_error')}</p>
   ) : rates.length === 0 ? (
    <p className="bg-white px-4 py-16 text-center text-sm text-slate-600">{t('live_rates_empty')}</p>
   ) : (
    <div dir="ltr" className="bg-white text-left">
     {/* Column header */}
     <div className="flex items-center gap-4 bg-[#eef1f5] px-4 py-3 text-sm font-medium text-slate-500">
      <span className="flex flex-1 items-center gap-1">
       {t('live_rates_currency')}
       <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M7 4v16M7 4 4 7M7 4l3 3M17 20V4M17 20l3-3M17 20l-3-3" />
       </svg>
      </span>
      <span className="w-24 text-end">{t('live_rates_buy')}</span>
      <span className="w-24 text-end">{t('live_rates_sell')}</span>
     </div>

     {/* Rows */}
     {rates.map((rate) => (
      <div key={rate.code} className="flex items-center gap-4 border-b border-slate-100 px-4 py-3 last:border-b-0">
       <div className="min-w-0 flex-1">
        <div className="text-[15px] font-bold text-slate-800">{rate.code}</div>
        <div className="truncate text-xs text-slate-400">{pairName(rate.code)}</div>
       </div>
       <div className="w-24 text-end text-[17px] tabular-nums text-slate-700">{fmtVal(rate.buy)}</div>
       <div className="w-24 text-end text-[17px] tabular-nums text-slate-700">{fmtVal(rate.sell)}</div>
      </div>
     ))}

     <p className="px-4 py-4 text-xs leading-relaxed text-slate-400">{t('live_rates_disclaimer')}</p>
    </div>
   )}
  </section>
 );
}
