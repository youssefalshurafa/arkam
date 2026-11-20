'use client';

import Link from 'next/link';
import './_ui/admin.css';
import { useAdminI18n } from './_ui/useAdminI18n';

// Shown instead of the admin panel while the super-admin account has no two-factor
// authentication. The API routes enforce the same rule; this just explains it.
export default function AdminMfaRequired() {
 const { t } = useAdminI18n();
 return (
  <div className="admin-scope">
   <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
    <div className="acp-card acp-card-pad" style={{ width: '100%', maxWidth: 400 }}>
     <h1 style={{ fontSize: 16, fontWeight: 650, margin: '0 0 6px' }}>{t('admin_mfa_required_title')}</h1>
     <p className="acp-faint" style={{ fontSize: 13, marginBottom: 14 }}>{t('admin_mfa_required_desc')}</p>
     <Link className="acp-btn primary" href="/settings/account" style={{ width: '100%', justifyContent: 'center' }}>
      {t('admin_mfa_required_cta')}
     </Link>
    </div>
   </div>
  </div>
 );
}
