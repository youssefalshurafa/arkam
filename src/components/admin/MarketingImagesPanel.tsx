'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { alertDialog, confirmDialog } from '@/components/ui/AppDialog';
import { MARKETING_SLOTS } from '@/config/marketing';

type SlotsMap = Record<string, number>;

// Super-admin panel to upload / replace / remove the real screenshots shown on
// the public homepage. An empty slot falls back to the built-in CSS mockup.
export default function MarketingImagesPanel() {
 const [slots, setSlots] = useState<SlotsMap>({});
 const [loading, setLoading] = useState(true);
 const [busySlot, setBusySlot] = useState<string | null>(null);
 const inputs = useRef<Record<string, HTMLInputElement | null>>({});

 const refresh = useCallback(async () => {
  setLoading(true);
  try {
   const res = await fetch('/api/marketing-images', { cache: 'no-store' });
   if (res.ok) {
    const data = (await res.json()) as { slots?: SlotsMap };
    setSlots(data.slots || {});
   }
  } finally {
   setLoading(false);
  }
 }, []);

 useEffect(() => {
  void refresh();
 }, [refresh]);

 const upload = async (slot: string, file: File) => {
  setBusySlot(slot);
  try {
   const body = new FormData();
   body.append('slot', slot);
   body.append('file', file);
   const res = await fetch('/api/admin/marketing-images', { method: 'POST', body });
   const data = (await res.json()) as { ok?: boolean; error?: string };
   if (!res.ok || !data.ok) throw new Error(data.error || 'Upload failed.');
   await refresh();
  } catch (err) {
   await alertDialog({ title: 'Upload failed', message: err instanceof Error ? err.message : 'Upload failed.' });
  } finally {
   setBusySlot(null);
  }
 };

 const remove = async (slot: string, label: string) => {
  if (!(await confirmDialog({ message: `Remove the image for "${label}"? The homepage will show its default mockup again.` }))) return;
  setBusySlot(slot);
  try {
   const res = await fetch(`/api/admin/marketing-images?slot=${encodeURIComponent(slot)}`, { method: 'DELETE' });
   const data = (await res.json()) as { ok?: boolean; error?: string };
   if (!res.ok || !data.ok) throw new Error(data.error || 'Remove failed.');
   await refresh();
  } catch (err) {
   await alertDialog({ title: 'Remove failed', message: err instanceof Error ? err.message : 'Remove failed.' });
  } finally {
   setBusySlot(null);
  }
 };

 return (
  <div>
   <div className="mb-6 flex items-start justify-between gap-4">
    <div>
     <h2 className="text-base font-semibold text-gray-900">Homepage images</h2>
     <p className="mt-1 max-w-2xl text-sm text-gray-500">
      Upload a real screenshot for any section of the public homepage. Empty slots show a built-in mockup instead.
      PNG, JPG, or WEBP up to 5MB. Wide images (roughly 4:3) look best.
     </p>
    </div>
    <button
     onClick={() => void refresh()}
     className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
    >
     Refresh
    </button>
   </div>

   {loading ? (
    <div className="py-16 text-center text-sm text-gray-400">Loading…</div>
   ) : (
    <div className="grid gap-4 sm:grid-cols-2">
     {MARKETING_SLOTS.map((s) => {
      const updatedAt = slots[s.slot];
      const hasImage = Boolean(updatedAt);
      const busy = busySlot === s.slot;
      return (
       <div key={s.slot} className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
         <div>
          <p className="text-sm font-semibold text-gray-900">{s.label}</p>
          <p className="mt-0.5 text-xs text-gray-400">{s.hint}</p>
         </div>
         <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
           hasImage ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
          }`}
         >
          {hasImage ? 'Custom image' : 'Default mockup'}
         </span>
        </div>

        <div className="mt-3 overflow-hidden rounded-lg border border-gray-100 bg-gray-50">
         {hasImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
           src={`/api/marketing-image/${s.slot}?v=${updatedAt}`}
           alt={s.label}
           className="max-h-44 w-full object-contain"
          />
         ) : (
          <div className="grid h-32 place-items-center text-xs text-gray-400">No image uploaded</div>
         )}
        </div>

        <div className="mt-3 flex items-center gap-2">
         <input
          ref={(el) => {
           inputs.current[s.slot] = el;
          }}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
           const file = e.target.files?.[0];
           if (file) void upload(s.slot, file);
           e.target.value = '';
          }}
         />
         <button
          disabled={busy}
          onClick={() => inputs.current[s.slot]?.click()}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
         >
          {busy ? 'Working…' : hasImage ? 'Replace' : 'Upload'}
         </button>
         {hasImage && (
          <button
           disabled={busy}
           onClick={() => void remove(s.slot, s.label)}
           className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
           Remove
          </button>
         )}
        </div>
       </div>
      );
     })}
    </div>
   )}
  </div>
 );
}
