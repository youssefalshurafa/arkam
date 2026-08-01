'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { panelClassName } from '@/shared/styles';
import { useSettingsStore } from '../store/settingsStore';

export default function AiSettingsTab() {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const aiSettings = useSettingsStore((s) => s.aiSettings);
 const updateAiSettings = useSettingsStore((s) => s.updateAiSettings);

 return (
  <section className="flex flex-col gap-6">
   <div className={panelClassName}>
    <h2 className="text-2xl font-semibold">{t('settings_ai_title')}</h2>
    <p className="mt-2 text-sm text-fg-muted">{t('settings_ai_description')}</p>

    <label className="mt-6 flex max-w-md items-start gap-3">
     <input
      type="checkbox"
      checked={aiSettings.enabled}
      onChange={(event) => updateAiSettings({ enabled: event.target.checked })}
      className="mt-1 h-4 w-4 rounded border-border-strong"
     />
     <span className="text-sm text-fg">{t('settings_ai_enable_label')}</span>
    </label>

    <p className="mt-3 max-w-md text-xs text-fg-faint">{t('settings_ai_privacy_hint')}</p>
   </div>
  </section>
 );
}
