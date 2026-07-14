'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { panelClassName } from '@/shared/styles';
import { useSettingsStore } from '../store/settingsStore';

// Workspace-wide rules for exchange (صرف) transactions. Currently just the tolerance: how far
// the entered "actual" (الفعلي) destination amount may deviate from the computed amount × rate
// before the new-transaction form blocks submission. Persisted (and shared across members) via
// the settings store's exchange settings.
export default function ExchangeSettingsTab() {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const exchangeSettings = useSettingsStore((s) => s.exchangeSettings);
 const updateExchangeSettings = useSettingsStore((s) => s.updateExchangeSettings);

 return (
  <div className={panelClassName}>
   <h3 className="text-lg font-semibold">{t('exchange_settings_title')}</h3>
   <p className="mt-1 text-sm text-fg-muted">{t('exchange_tolerance_hint')}</p>
   <div className="mt-4 max-w-xs">
    <label className="block text-sm font-medium text-fg">{t('exchange_tolerance_setting_label')}</label>
    <input
     type="text"
     inputMode="decimal"
     dir="ltr"
     value={String(exchangeSettings.tolerance)}
     onChange={(e) => {
      const raw = e.target.value.replace(/[^0-9.]/g, '');
      const parsed = parseFloat(raw);
      updateExchangeSettings({ tolerance: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0 });
     }}
     className="mt-2 w-full rounded border border-border-strong bg-surface px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-blue-400"
     placeholder="5"
    />
   </div>
  </div>
 );
}
