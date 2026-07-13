'use client';

import { Icon, type IconName } from './icons';
import { useAdminI18n } from './useAdminI18n';

// Shared "coming in a later phase" card for routes that exist in the nav but
// whose full feature set lands in a subsequent redesign phase (Subscriptions,
// Audit log). Keeps the sidebar complete without shipping empty screens.
export function Placeholder({ icon, bodyKey }: { icon: IconName; bodyKey: string }) {
 const { t } = useAdminI18n();
 return (
  <div className="ad-card ad-card-pad" style={{ padding: '48px 24px', textAlign: 'center' }}>
   <div className="ad-kpi-ic" style={{ width: 46, height: 46, margin: '0 auto 14px' }}>
    <Icon name={icon} width={22} height={22} />
   </div>
   <div style={{ fontSize: 15, fontWeight: 650 }}>{t('admin_soon_title')}</div>
   <p className="ad-muted" style={{ fontSize: 13, marginTop: 8, maxWidth: 520, marginInline: 'auto' }}>
    {t(bodyKey)}
   </p>
  </div>
 );
}
