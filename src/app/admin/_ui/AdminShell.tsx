'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import './admin.css';
import { Icon } from './icons';
import { NAV_GROUPS, PAGE_META } from './nav';
import { useAdminI18n } from './useAdminI18n';
import { useLanguage, type Language } from '@/contexts/LanguageContext';
import { useStableSession } from '@/hooks/useStableSession';
import { getInitials, avatarColor } from '../_lib/format';

type Theme = 'light' | 'dark';
const THEME_KEY = 'arkam_admin_theme';
const THEME_EVENT = 'arkam-admin-theme';

// External-store readers for theme + OS preference. Using useSyncExternalStore
// (instead of a mount effect that calls setState) is the React-blessed way to read
// localStorage / matchMedia: getServerSnapshot keeps SSR and first hydration in
// sync (theme absent), then the client snapshot takes over — no hydration mismatch,
// and it satisfies the repo's no-setState-in-effect lint rule.
function subscribeTheme(cb: () => void) {
 window.addEventListener('storage', cb);
 window.addEventListener(THEME_EVENT, cb);
 return () => {
  window.removeEventListener('storage', cb);
  window.removeEventListener(THEME_EVENT, cb);
 };
}
function getThemeSnapshot(): Theme | null {
 const v = localStorage.getItem(THEME_KEY);
 return v === 'light' || v === 'dark' ? v : null;
}
const getThemeServer = (): Theme | null => null;

function subscribeSystem(cb: () => void) {
 const mq = window.matchMedia('(prefers-color-scheme: dark)');
 mq.addEventListener('change', cb);
 return () => mq.removeEventListener('change', cb);
}
const getSystemSnapshot = () => window.matchMedia('(prefers-color-scheme: dark)').matches;
const getSystemServer = () => false;

// Persistent chrome for every /admin/* route: sidebar navigation, topbar with the
// page title, a lock control, language switch and a light/dark theme toggle. The
// panel now follows the app language (no more forced LTR) and mirrors under RTL.
export default function AdminShell({ children }: { children: React.ReactNode }) {
 const pathname = usePathname() || '/admin';
 const router = useRouter();
 const { t } = useAdminI18n();
 const { language, setLanguage } = useLanguage();
 const { data: session } = useStableSession();

 // Theme: null = follow the OS; an explicit choice is persisted in localStorage.
 const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getThemeServer);
 const systemDark = useSyncExternalStore(subscribeSystem, getSystemSnapshot, getSystemServer);
 const [drawer, setDrawer] = useState(false);
 const [counts, setCounts] = useState<{ requests: number; resets: number }>({ requests: 0, resets: 0 });

 // Live pending badges for the Access-requests / Password-resets nav items.
 useEffect(() => {
  let cancelled = false;
  const load = async () => {
   try {
    const [reqRes, resetRes] = await Promise.all([
     fetch('/api/admin/access-requests').then((r) => (r.ok ? r.json() : { requests: [] })),
     fetch('/api/admin/password-reset-requests?status=pending').then((r) => (r.ok ? r.json() : { requests: [] })),
    ]);
    if (cancelled) return;
    const reqPending = (reqRes.requests || []).filter((x: { status: string }) => x.status === 'pending').length;
    const resetPending = (resetRes.requests || []).length;
    setCounts({ requests: reqPending, resets: resetPending });
   } catch {
    /* badges stay at 0 */
   }
  };
  void load();
  return () => {
   cancelled = true;
  };
 }, [pathname]);

 const effectiveDark = theme ? theme === 'dark' : systemDark;
 const toggleTheme = useCallback(() => {
  const next: Theme = effectiveDark ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  window.dispatchEvent(new Event(THEME_EVENT));
 }, [effectiveDark]);

 const lock = useCallback(async () => {
  try {
   await fetch('/api/admin/unlock', { method: 'DELETE' });
   router.refresh();
  } catch {
   /* ignore */
  }
 }, [router]);

 const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname === href || pathname.startsWith(href + '/'));

 const meta = PAGE_META[pathname] || (pathname.startsWith('/admin/users/') ? { title: 'admin_user_detail_title', sub: 'admin_user_detail_sub' } : PAGE_META['/admin']);

 const email = session?.user?.email || '';
 const adminName = session?.user?.name || email || 'Admin';
 const langs: { code: Language; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'ar', label: 'ع' },
  { code: 'fr', label: 'FR' },
 ];

 return (
  <div className="admin-scope" data-admin-theme={theme ?? undefined}>
   <div className="ad-app">
    {drawer && <div className="ad-backdrop" onClick={() => setDrawer(false)} />}

    <aside className={`ad-sidebar ${drawer ? 'drawer' : ''}`}>
     <div className="ad-brand">
      <div className="ad-brand-mark">أ</div>
      <div>
       <div className="ad-brand-name">Arkam</div>
       <div className="ad-brand-sub">{t('admin_brand_sub')}</div>
      </div>
     </div>

     <nav className="ad-nav">
      {NAV_GROUPS.map((group) => (
       <div key={group.labelKey}>
        <div className="ad-nav-label">{t(group.labelKey)}</div>
        {group.items.map((item) => {
         const active = isActive(item.href, item.exact);
         const badge = item.badge ? counts[item.badge] : 0;
         return (
          <Link key={item.key} href={item.href} className={`ad-nav-item ${active ? 'active' : ''}`} onClick={() => setDrawer(false)}>
           <Icon name={item.icon} />
           <span>{t(item.labelKey)}</span>
           {badge > 0 && <span className="ad-nav-badge ad-num">{badge}</span>}
          </Link>
         );
        })}
       </div>
      ))}
     </nav>

     <div className="ad-sidebar-foot">
      <div className="ad-admin-chip">
       <div className="ad-avatar" style={{ width: 30, height: 30, fontSize: 12, background: avatarColor(email || adminName) }}>
        {getInitials(adminName)}
       </div>
       <div className="ad-meta">
        <div className="n">{adminName}</div>
        <div className="e">{email}</div>
       </div>
      </div>
      <button type="button" className="ad-btn sm" onClick={() => void lock()} style={{ justifyContent: 'center' }}>
       <Icon name="lock" />
       {t('admin_lock')}
      </button>
     </div>
    </aside>

    <div className="ad-main">
     <header className="ad-topbar">
      <button type="button" className="ad-icon-btn ad-menu-toggle" aria-label="Menu" onClick={() => setDrawer(true)}>
       <Icon name="overview" />
      </button>
      <div>
       <div className="ad-page-title">{t(meta.title)}</div>
       <div className="ad-page-sub">{t(meta.sub)}</div>
      </div>
      <div className="ad-spacer" />
      <div className="ad-seg" role="group" aria-label="Language">
       {langs.map((l) => (
        <button key={l.code} type="button" className={language === l.code ? 'active' : ''} onClick={() => setLanguage(l.code)}>
         {l.label}
        </button>
       ))}
      </div>
      <button type="button" className="ad-icon-btn" onClick={toggleTheme} aria-label={t('admin_theme_toggle')} title={t('admin_theme_toggle')}>
       <Icon name={effectiveDark ? 'sun' : 'moon'} />
      </button>
     </header>

     <div className="ad-content">{children}</div>
    </div>
   </div>
  </div>
 );
}
