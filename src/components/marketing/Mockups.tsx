'use client';

// Hand-built, decorative CSS mockups that stand in for real product screenshots
// on the marketing homepage until a super admin uploads real ones. They are
// purely visual (aria-hidden) and intentionally simplified.

import { ReactNode } from 'react';

// A window-like frame with a faux title bar, matching the app's white panels.
function Frame({ title, children }: { title: string; children: ReactNode }) {
 return (
  <div aria-hidden className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
   <div className="flex items-center gap-1.5 border-b border-gray-100 bg-gray-50 px-3 py-2">
    <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
    <span className="h-2.5 w-2.5 rounded-full bg-yellow-300" />
    <span className="h-2.5 w-2.5 rounded-full bg-green-300" />
    <span className="ms-2 truncate text-[11px] font-medium text-gray-400">{title}</span>
   </div>
   <div className="p-3.5">{children}</div>
  </div>
 );
}

function Bar({ w = 'w-full', tone = 'bg-gray-200' }: { w?: string; tone?: string }) {
 return <span className={`inline-block h-2 rounded ${w} ${tone}`} />;
}

// --- Ledger table -----------------------------------------------------------
export function LedgerMockup() {
 const rows = [
  { c: 'Ahmed Traders', dir: '+', amt: '12,400.00', bal: '18,900.00', up: true },
  { c: 'Cairo Exchange', dir: '−', amt: '3,250.00', bal: '15,650.00', up: false },
  { c: 'Nour Holdings', dir: '+', amt: '8,000.00', bal: '23,650.00', up: true },
  { c: 'Delta Money', dir: '−', amt: '1,120.00', bal: '22,530.00', up: false },
 ];
 return (
  <Frame title="Ledger · USD · Ahmed Traders">
   <div className="mb-2 flex items-center justify-between">
    <Bar w="w-24" tone="bg-blue-200" />
    <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700">Balance 22,530.00</span>
   </div>
   <div className="grid grid-cols-12 gap-2 border-b border-gray-100 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
    <span className="col-span-5">Counterparty</span>
    <span className="col-span-3 text-end">Amount</span>
    <span className="col-span-4 text-end">Balance</span>
   </div>
   <div className="divide-y divide-gray-50">
    {rows.map((r) => (
     <div key={r.c} className="grid grid-cols-12 items-center gap-2 py-2 text-[11px]">
      <span className="col-span-5 truncate font-medium text-gray-700">{r.c}</span>
      <span className={`col-span-3 text-end font-semibold ${r.up ? 'text-green-600' : 'text-red-500'}`}>
       {r.dir} {r.amt}
      </span>
      <span className="col-span-4 text-end tabular-nums text-gray-600">{r.bal}</span>
     </div>
    ))}
   </div>
  </Frame>
 );
}

// --- Transaction form -------------------------------------------------------
export function TransactionsMockup() {
 return (
  <Frame title="New transaction">
   <div className="grid grid-cols-2 gap-2.5">
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-2.5">
     <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">From</p>
     <p className="mt-1 text-[11px] font-medium text-gray-700">Cairo Exchange</p>
     <p className="mt-0.5 text-[11px] font-semibold text-red-500">− 5,000.00 USD</p>
    </div>
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-2.5">
     <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">To</p>
     <p className="mt-1 text-[11px] font-medium text-gray-700">Nour Holdings</p>
     <p className="mt-0.5 text-[11px] font-semibold text-green-600">+ 154,750.00 EGP</p>
    </div>
   </div>
   <div className="mt-2.5 grid grid-cols-3 gap-2 text-[10px]">
    <div className="rounded-lg border border-blue-100 bg-blue-50 p-2">
     <p className="font-semibold text-gray-400">Rate</p>
     <p className="mt-0.5 text-[11px] font-semibold text-blue-700">30.95</p>
    </div>
    <div className="rounded-lg border border-gray-100 p-2">
     <p className="font-semibold text-gray-400">Commission</p>
     <p className="mt-0.5 text-[11px] font-semibold text-gray-700">0.25%</p>
    </div>
    <div className="rounded-lg border border-gray-100 p-2">
     <p className="font-semibold text-gray-400">Charges</p>
     <p className="mt-0.5 text-[11px] font-semibold text-gray-700">15.00</p>
    </div>
   </div>
   <div className="mt-3 flex justify-end">
    <span className="rounded-md bg-blue-700 px-3 py-1.5 text-[11px] font-semibold text-white">Save transaction</span>
   </div>
  </Frame>
 );
}

// --- Overview balance cards --------------------------------------------------
export function OverviewMockup() {
 const cards = [
  { org: 'Downtown Group', cur: 'USD', bal: '48,300.00', tone: 'text-green-600' },
  { org: 'Downtown Group', cur: 'EGP', bal: '1,204,900', tone: 'text-green-600' },
  { org: 'Harbor Traders', cur: 'EUR', bal: '−2,150.00', tone: 'text-red-500' },
  { org: 'Harbor Traders', cur: 'AED', bal: '76,500.00', tone: 'text-green-600' },
 ];
 return (
  <Frame title="Exchange overview">
   <div className="grid grid-cols-2 gap-2.5">
    {cards.map((c, i) => (
     <div key={i} className="rounded-lg border border-gray-100 p-2.5">
      <div className="flex items-center justify-between">
       <span className="text-[10px] font-medium text-gray-400">{c.org}</span>
       <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">{c.cur}</span>
      </div>
      <p className={`mt-1.5 text-sm font-bold tabular-nums ${c.tone}`}>{c.bal}</p>
     </div>
    ))}
   </div>
   <div className="mt-2.5 flex items-center justify-between rounded-lg bg-gray-900 px-3 py-2">
    <span className="text-[10px] font-medium text-gray-300">In main currency</span>
    <span className="text-[11px] font-bold text-white">≈ 92,480.00 USD</span>
   </div>
  </Frame>
 );
}

// --- PDF export preview ------------------------------------------------------
export function ExportsMockup() {
 return (
  <Frame title="Export · Statement.pdf">
   <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
    <div className="flex items-center justify-between border-b border-gray-100 pb-2">
     <div className="flex items-center gap-1.5">
      <span className="grid h-5 w-5 place-items-center rounded bg-blue-700 text-[9px] font-bold text-white">A</span>
      <span className="text-[11px] font-bold text-gray-800">ARKAM</span>
     </div>
     <span className="text-[9px] text-gray-400">Statement · Jan 2026</span>
    </div>
    <div className="mt-2 space-y-1.5">
     <Bar w="w-3/4" />
     <Bar w="w-full" />
     <Bar w="w-5/6" />
     <Bar w="w-2/3" />
    </div>
    <div className="mt-2 flex justify-end border-t border-gray-100 pt-2">
     <Bar w="w-20" tone="bg-blue-200" />
    </div>
   </div>
   <div className="mt-3 flex gap-2">
    <span className="flex-1 rounded-md border border-blue-700 bg-blue-700 px-2 py-1.5 text-center text-[10px] font-semibold text-white">PDF</span>
    <span className="flex-1 rounded-md border border-green-600 px-2 py-1.5 text-center text-[10px] font-semibold text-green-700">Excel</span>
   </div>
  </Frame>
 );
}

// --- Workspace / team --------------------------------------------------------
export function TeamMockup() {
 const members = [
  { n: 'You', r: 'Owner', tone: 'bg-blue-700 text-white' },
  { n: 'Sara M.', r: 'Admin', tone: 'bg-indigo-100 text-indigo-700' },
  { n: 'Omar K.', r: 'Editor', tone: 'bg-gray-100 text-gray-600' },
  { n: 'Lina R.', r: 'Reviewer', tone: 'bg-gray-100 text-gray-600' },
 ];
 return (
  <Frame title="Workspace · Downtown Books">
   <div className="mb-2.5 flex gap-1.5">
    <span className="rounded-md bg-blue-700 px-2 py-1 text-[10px] font-semibold text-white">Downtown Books</span>
    <span className="rounded-md bg-gray-100 px-2 py-1 text-[10px] font-medium text-gray-500">Harbor Ltd</span>
    <span className="rounded-md bg-gray-100 px-2 py-1 text-[10px] font-medium text-gray-500">+ Add</span>
   </div>
   <div className="space-y-1.5">
    {members.map((m) => (
     <div key={m.n} className="flex items-center justify-between rounded-lg border border-gray-100 px-2.5 py-1.5">
      <div className="flex items-center gap-2">
       <span className="grid h-6 w-6 place-items-center rounded-full bg-gray-100 text-[10px] font-bold text-gray-500">
        {m.n[0]}
       </span>
       <span className="text-[11px] font-medium text-gray-700">{m.n}</span>
      </div>
      <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${m.tone}`}>{m.r}</span>
     </div>
    ))}
   </div>
  </Frame>
 );
}

// --- Live rates --------------------------------------------------------------
export function RatesMockup() {
 const rates = [
  { s: 'Gold 24K', v: '2,412.30', chg: '+0.8%', up: true },
  { s: 'USD / EGP', v: '30.95', chg: '+0.2%', up: true },
  { s: 'EUR / USD', v: '1.084', chg: '−0.3%', up: false },
  { s: 'USD / AED', v: '3.673', chg: '0.0%', up: true },
 ];
 return (
  <Frame title="Live rates">
   <div className="space-y-1.5">
    {rates.map((r) => (
     <div key={r.s} className="flex items-center justify-between rounded-lg border border-gray-100 px-2.5 py-2">
      <span className="text-[11px] font-medium text-gray-700">{r.s}</span>
      <div className="flex items-center gap-2">
       <svg viewBox="0 0 40 16" className={`h-4 w-10 ${r.up ? 'text-green-500' : 'text-red-400'}`} fill="none" stroke="currentColor" strokeWidth="1.5">
        <polyline points={r.up ? '0,13 10,9 20,11 30,4 40,2' : '0,3 10,7 20,5 30,11 40,13'} />
       </svg>
       <span className="w-14 text-end text-[11px] font-semibold tabular-nums text-gray-800">{r.v}</span>
       <span className={`w-10 text-end text-[10px] font-semibold ${r.up ? 'text-green-600' : 'text-red-500'}`}>{r.chg}</span>
      </div>
     </div>
    ))}
   </div>
  </Frame>
 );
}

// --- Phone + tablet (works on every device) ---------------------------------
export function MobileMockup() {
 const rows = [
  { c: 'Ahmed Traders', amt: '+ 12,400', up: true },
  { c: 'Cairo Exchange', amt: '− 3,250', up: false },
  { c: 'Nour Holdings', amt: '+ 8,000', up: true },
  { c: 'Delta Money', amt: '− 1,120', up: false },
 ];
 return (
  <div aria-hidden className="relative mx-auto flex items-end justify-center gap-4">
   {/* Tablet */}
   <div className="hidden w-56 shrink-0 rounded-2xl border border-gray-300 bg-gray-900 p-1.5 shadow-xl sm:block">
    <div className="overflow-hidden rounded-xl bg-white">
     <div className="flex items-center justify-between bg-blue-700 px-3 py-2">
      <span className="text-[10px] font-bold text-white">ARKAM</span>
      <span className="text-[9px] text-blue-100">Overview</span>
     </div>
     <div className="grid grid-cols-2 gap-1.5 p-2">
      {['USD', 'EGP', 'EUR', 'AED'].map((cur, i) => (
       <div key={cur} className="rounded-lg border border-gray-100 p-1.5">
        <span className="text-[8px] font-bold text-blue-700">{cur}</span>
        <p className={`text-[10px] font-bold tabular-nums ${i === 2 ? 'text-red-500' : 'text-green-600'}`}>
         {i === 2 ? '−2,150' : '48,300'}
        </p>
       </div>
      ))}
     </div>
    </div>
   </div>

   {/* Phone */}
   <div className="relative w-36 rounded-[2rem] border-[6px] border-gray-900 bg-gray-900 shadow-2xl">
    <div className="absolute left-1/2 top-2 z-10 h-1.5 w-10 -translate-x-1/2 rounded-full bg-gray-700" />
    <div className="overflow-hidden rounded-[1.5rem] bg-white pt-5">
     <div className="flex items-center justify-between bg-blue-700 px-3 py-2.5">
      <span className="text-[10px] font-bold text-white">ARKAM</span>
      <span className="h-4 w-4 rounded-full bg-blue-500/60" />
     </div>
     <div className="p-2.5 pb-4">
      <div className="rounded-xl bg-gradient-to-br from-blue-600 to-blue-800 p-3.5 text-white">
       <p className="text-[8px] font-medium text-blue-100">Total balance</p>
       <p className="mt-0.5 text-sm font-bold tabular-nums">92,480.00</p>
       <p className="text-[8px] text-blue-100">▲ 4.2% this week</p>
      </div>
      <div className="mt-2.5 space-y-2">
       {rows.map((r) => (
        <div key={r.c} className="flex items-center justify-between rounded-lg border border-gray-100 px-2 py-1.5">
         <span className="text-[8px] font-medium text-gray-700">{r.c}</span>
         <span className={`text-[8px] font-semibold ${r.up ? 'text-green-600' : 'text-red-500'}`}>{r.amt}</span>
        </div>
       ))}
      </div>
     </div>
    </div>
   </div>
  </div>
 );
}

// --- Hero composite (stacked ledger + balance) ------------------------------
export function HeroMockup() {
 return (
  <div aria-hidden className="relative">
   <LedgerMockup />
   <div className="absolute -bottom-6 -end-4 w-44 rotate-2 rounded-xl border border-gray-200 bg-white p-3 shadow-xl sm:-end-6">
    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Total balance</p>
    <p className="mt-1 text-lg font-bold text-gray-900">92,480.00</p>
    <p className="text-[10px] font-medium text-green-600">▲ 4.2% this week</p>
    <div className="mt-2 flex gap-1">
     <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">USD</span>
     <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-bold text-gray-500">EGP</span>
     <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-bold text-gray-500">EUR</span>
    </div>
   </div>
  </div>
 );
}
