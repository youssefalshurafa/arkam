'use client';

import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { panelClassName } from '@/shared/styles';
import { minLiveRatesInterval, maxLiveRatesInterval } from '@/shared/lib/localStorage';
import { useLiveRatesSettingsStore } from '@/features/live-rates/store/liveRatesSettingsStore';

const PRESETS = [5, 10, 30, 60];

export default function LiveRatesSettings() {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const intervalSec = useLiveRatesSettingsStore((s) => s.intervalSec);
 const setIntervalSec = useLiveRatesSettingsStore((s) => s.setIntervalSec);
 // Local draft so the field can be edited freely; committed (and clamped) on blur/Enter.
 const [draft, setDraft] = useState(String(intervalSec));

 const commit = (raw: string) => {
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) {
   setDraft(String(intervalSec));
   return;
  }
  setIntervalSec(parsed);
  const clamped = Math.min(maxLiveRatesInterval, Math.max(minLiveRatesInterval, parsed));
  setDraft(String(clamped));
 };

 return (
  <section className="flex flex-col gap-6">
   <div className={panelClassName}>
    <h2 className="text-2xl font-semibold">{t('settings_live_rates_title')}</h2>
    <p className="mt-2 text-sm text-fg-muted">{t('settings_live_rates_description')}</p>

    <div className="mt-6 max-w-md">
     <label className="block text-sm font-medium text-fg-muted">{t('settings_live_rates_interval_label')}</label>

     <div className="mt-2 flex flex-wrap gap-2">
      {PRESETS.map((preset) => {
       const isActive = intervalSec === preset;
       return (
        <button
         key={preset}
         type="button"
         onClick={() => {
          setIntervalSec(preset);
          setDraft(String(preset));
         }}
         className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${
          isActive
           ? 'border-accent bg-accent text-accent-contrast shadow-sm'
           : 'border-border-strong text-fg-muted hover:bg-surface-hover hover:text-fg'
         }`}
        >
         {t('settings_live_rates_seconds', { count: preset })}
        </button>
       );
      })}
     </div>

     <div className="mt-3 flex items-center gap-2">
      <input
       type="number"
       min={minLiveRatesInterval}
       max={maxLiveRatesInterval}
       value={draft}
       onChange={(event) => setDraft(event.target.value)}
       onBlur={(event) => commit(event.target.value)}
       onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
       }}
       className="w-24 rounded border border-border-strong bg-surface px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
      />
      <span className="text-sm text-fg-muted">{t('settings_live_rates_seconds_unit')}</span>
     </div>

     <p className="mt-3 text-xs text-fg-faint">{t('settings_live_rates_interval_hint')}</p>
    </div>
   </div>
  </section>
 );
}
