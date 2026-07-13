'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { alertDialog, confirmDialog } from '@/components/ui/AppDialog';
import { MARKETING_SLOTS } from '@/config/marketing';
import { useAdminI18n } from '@/app/admin/_ui/useAdminI18n';
import { Icon } from '@/app/admin/_ui/icons';
import { StateBlock } from '@/app/admin/_ui/primitives';

type SlotsMap = Record<string, number>;

// Super-admin panel to upload / replace / remove the real screenshots shown on
// the public homepage. An empty slot falls back to the built-in CSS mockup.
export default function MarketingImagesPanel() {
 const { t } = useAdminI18n();
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
   if (!res.ok || !data.ok) throw new Error(data.error || t('admin_img_upload_failed'));
   await refresh();
  } catch (err) {
   await alertDialog({ title: t('admin_img_upload_failed_title'), message: err instanceof Error ? err.message : t('admin_img_upload_failed') });
  } finally {
   setBusySlot(null);
  }
 };

 const remove = async (slot: string, label: string) => {
  if (!(await confirmDialog({ message: t('admin_img_remove_confirm').replace('{label}', label) }))) return;
  setBusySlot(slot);
  try {
   const res = await fetch(`/api/admin/marketing-images?slot=${encodeURIComponent(slot)}`, { method: 'DELETE' });
   const data = (await res.json()) as { ok?: boolean; error?: string };
   if (!res.ok || !data.ok) throw new Error(data.error || t('admin_img_remove_failed'));
   await refresh();
  } catch (err) {
   await alertDialog({ title: t('admin_img_remove_failed_title'), message: err instanceof Error ? err.message : t('admin_img_remove_failed') });
  } finally {
   setBusySlot(null);
  }
 };

 return (
  <>
   <div className="ad-note info">
    <Icon name="info" />
    {t('admin_img_intro')}
   </div>

   {loading ? (
    <StateBlock>{t('admin_loading')}</StateBlock>
   ) : (
    <div className="ad-grid-2">
     {MARKETING_SLOTS.map((s) => {
      const updatedAt = slots[s.slot];
      const hasImage = Boolean(updatedAt);
      const busy = busySlot === s.slot;
      return (
       <div key={s.slot} className="ad-card ad-card-pad">
        <div className="ad-row" style={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
         <div>
          <p className="ad-u-name">{s.label}</p>
          <p className="ad-faint" style={{ fontSize: 12, marginTop: 2 }}>{s.hint}</p>
         </div>
         <span className={`ad-badge ${hasImage ? 'good' : 'neutral'}`}>{hasImage ? t('admin_img_custom') : t('admin_img_default')}</span>
        </div>

        <div style={{ marginTop: 12, overflow: 'hidden', borderRadius: 10, border: '1px solid var(--ad-border)', background: 'var(--ad-surface-2)' }}>
         {hasImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/marketing-image/${s.slot}?v=${updatedAt}`} alt={s.label} style={{ maxHeight: 176, width: '100%', objectFit: 'contain' }} />
         ) : (
          <div style={{ height: 128, display: 'grid', placeItems: 'center' }} className="ad-faint">
           {t('admin_img_none')}
          </div>
         )}
        </div>

        <div className="ad-row" style={{ marginTop: 12, gap: 8 }}>
         <input
          ref={(el) => {
           inputs.current[s.slot] = el;
          }}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="ad-hidden"
          style={{ display: 'none' }}
          onChange={(e) => {
           const file = e.target.files?.[0];
           if (file) void upload(s.slot, file);
           e.target.value = '';
          }}
         />
         <button className="ad-btn sm primary" disabled={busy} onClick={() => inputs.current[s.slot]?.click()}>
          {busy ? t('admin_working') : hasImage ? t('admin_replace') : t('admin_upload')}
         </button>
         {hasImage && (
          <button className="ad-btn sm" disabled={busy} onClick={() => void remove(s.slot, s.label)}>
           {t('admin_remove')}
          </button>
         )}
        </div>
       </div>
      );
     })}
    </div>
   )}
  </>
 );
}
