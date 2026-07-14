'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import './_ui/admin.css';
import { useAdminI18n } from './_ui/useAdminI18n';

// Password prompt shown by the /admin layout when the signed-in super-admin hasn't
// unlocked the panel yet. Submitting sets an httpOnly cookie server-side, then
// router.refresh() re-runs the server layout, which now sees the cookie and renders
// the real panel — the admin content never mounts until this succeeds. Rendered
// outside AdminShell, so it imports the design-system CSS itself and follows the OS
// theme (no explicit toggle here).
export default function AdminUnlockGate() {
 const router = useRouter();
 const { t } = useAdminI18n();
 const [password, setPassword] = useState('');
 const [error, setError] = useState<string | null>(null);
 const [isSubmitting, setIsSubmitting] = useState(false);

 // Render the form only after mount — skips SSR of a purely client-driven screen and
 // avoids hydration mismatches from password-manager extensions mutating the field.
 const [mounted, setMounted] = useState(false);
 useEffect(() => setMounted(true), []);

 const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setError(null);
  setIsSubmitting(true);
  try {
   const res = await fetch('/api/admin/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
   });
   if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setError(data.error || t('admin_unlock_wrong'));
    return;
   }
   setPassword('');
   router.refresh();
  } catch {
   setError(t('admin_err_network'));
  } finally {
   setIsSubmitting(false);
  }
 };

 if (!mounted) {
  return <div className="admin-scope" style={{ minHeight: '100vh' }} />;
 }

 return (
  <div className="admin-scope">
   <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
    <form onSubmit={handleSubmit} className="ad-card ad-card-pad" style={{ width: '100%', maxWidth: 360 }}>
     <div className="ad-brand" style={{ padding: '0 0 12px' }}>
      <div className="ad-brand-mark">أ</div>
      <div>
       <div className="ad-brand-name">Arkam</div>
       <div className="ad-brand-sub">{t('admin_brand_sub')}</div>
      </div>
     </div>
     <h1 style={{ fontSize: 16, fontWeight: 650, margin: '4px 0 2px' }}>{t('admin_unlock_title')}</h1>
     <p className="ad-faint" style={{ fontSize: 13, marginBottom: 14 }}>{t('admin_unlock_desc')}</p>
     <input
      className="ad-input"
      type="password"
      autoFocus
      value={password}
      onChange={(e) => setPassword(e.target.value)}
      placeholder={t('admin_unlock_ph')}
     />
     {error && <p style={{ color: 'var(--ad-bad-text)', fontSize: 13, marginTop: 10 }}>{error}</p>}
     <button className="ad-btn primary" type="submit" disabled={isSubmitting || !password} style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}>
      {isSubmitting ? t('admin_unlock_checking') : t('admin_unlock_btn')}
     </button>
    </form>
   </div>
  </div>
 );
}
