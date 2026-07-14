'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

// slot key -> updatedAt (ms). Presence means a super admin uploaded a real
// screenshot for that slot, which replaces the built-in CSS mockup.
type SlotsMap = Record<string, number>;

const MarketingImagesContext = createContext<SlotsMap>({});

// Fetches the set of homepage slots that have an uploaded image, once, and makes
// it available to every <MarketingMockup> below it. Non-critical: on failure the
// map stays empty and all mockups render their CSS fallback.
export function MarketingImagesProvider({ children }: { children: ReactNode }) {
 const [slots, setSlots] = useState<SlotsMap>({});

 useEffect(() => {
  let active = true;
  fetch('/api/marketing-images')
   .then((res) => (res.ok ? res.json() : { slots: {} }))
   .then((data) => {
    if (active && data && typeof data.slots === 'object') setSlots(data.slots as SlotsMap);
   })
   .catch(() => {
    /* keep CSS mockups */
   });
  return () => {
   active = false;
  };
 }, []);

 return <MarketingImagesContext.Provider value={slots}>{children}</MarketingImagesContext.Provider>;
}

// Renders the admin-uploaded screenshot for `slot` when one exists, otherwise the
// `children` (a hand-built CSS mockup). Falls back to children if the image fails.
export function MarketingMockup({
 slot,
 children,
 className = '',
}: {
 slot: string;
 children: ReactNode;
 className?: string;
}) {
 const slots = useContext(MarketingImagesContext);
 const [failed, setFailed] = useState(false);
 const updatedAt = slots[slot];

 if (updatedAt && !failed) {
  return (
   <div className={className}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img
     src={`/api/marketing-image/${slot}?v=${updatedAt}`}
     alt=""
     onError={() => setFailed(true)}
     className="w-full rounded-xl border border-border shadow-lg"
    />
   </div>
  );
 }

 return <div className={className}>{children}</div>;
}
