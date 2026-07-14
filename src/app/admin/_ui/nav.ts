import type { IconName } from './icons';

// Sidebar navigation model for the admin panel. `badge` names a live pending-count
// key the shell fills in (see AdminShell): 'requests' | 'resets'. Grouped so the
// sidebar can render section labels.
export type NavItem = {
 key: string;
 href: string;
 icon: IconName;
 labelKey: string;
 badge?: 'requests' | 'resets';
 exact?: boolean;
};

export type NavGroup = {
 labelKey: string;
 items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
 {
  labelKey: 'admin_nav_group_main',
  items: [
   { key: 'overview', href: '/admin', icon: 'overview', labelKey: 'admin_nav_overview', exact: true },
   { key: 'users', href: '/admin/users', icon: 'users', labelKey: 'admin_nav_users' },
   { key: 'subscriptions', href: '/admin/subscriptions', icon: 'subscriptions', labelKey: 'admin_nav_subscriptions' },
   { key: 'requests', href: '/admin/requests', icon: 'requests', labelKey: 'admin_nav_requests', badge: 'requests' },
   { key: 'resets', href: '/admin/resets', icon: 'resets', labelKey: 'admin_nav_resets', badge: 'resets' },
  ],
 },
 {
  labelKey: 'admin_nav_group_site',
  items: [
   { key: 'marketing', href: '/admin/marketing', icon: 'images', labelKey: 'admin_nav_images' },
   { key: 'audit', href: '/admin/audit', icon: 'audit', labelKey: 'admin_nav_audit' },
  ],
 },
];

// Maps a pathname to the page title/subtitle i18n keys shown in the topbar.
export const PAGE_META: Record<string, { title: string; sub: string }> = {
 '/admin': { title: 'admin_ov_title', sub: 'admin_ov_sub' },
 '/admin/users': { title: 'admin_users_title', sub: 'admin_users_sub' },
 '/admin/subscriptions': { title: 'admin_subs_title', sub: 'admin_subs_sub' },
 '/admin/requests': { title: 'admin_req_title', sub: 'admin_req_sub' },
 '/admin/resets': { title: 'admin_reset_title', sub: 'admin_reset_sub' },
 '/admin/marketing': { title: 'admin_img_title', sub: 'admin_img_sub' },
 '/admin/audit': { title: 'admin_audit_title', sub: 'admin_audit_sub' },
};
