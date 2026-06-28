'use client';

import { useEffect, useState } from 'react';
import { subscribeToApiActivity } from '@/lib/accountingApi';
import { Spinner } from '@/components/ui/Spinner';

// App-wide loading feedback: an animated bar pinned to the top of the viewport
// plus a small floating spinner, shown whenever any accountingApi request is in
// flight. Mounted once near the root so every load/mutation gets feedback.
export function GlobalLoadingBar() {
 const [active, setActive] = useState(false);

 useEffect(() => subscribeToApiActivity(setActive), []);

 if (!active) return null;

 return (
  <>
   <div className="pointer-events-none fixed inset-x-0 top-0 z-[200] h-0.5 overflow-hidden bg-blue-100">
    <div className="h-full w-1/3 animate-[loading-bar_1s_ease-in-out_infinite] bg-blue-600" />
   </div>
   <div className="pointer-events-none fixed bottom-4 right-4 z-[200] flex items-center gap-2 rounded-full bg-slate-900/85 px-3 py-1.5 text-xs font-medium text-white shadow-lg">
    <Spinner className="text-base text-white" />
    Loading…
   </div>
  </>
 );
}
