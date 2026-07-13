'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from './icons';
import { Avatar } from './primitives';
import { useAdminI18n } from './useAdminI18n';
import type { AdminUser } from '../_lib/types';

// Topbar quick-search: lazily loads the user list on first focus, filters by name
// or email as you type, and jumps to a user's detail page. A "see all" row hands
// off to the full Users screen. Hidden on narrow viewports (Users has its own search).
export function GlobalSearch() {
 const router = useRouter();
 const { t } = useAdminI18n();
 const [q, setQ] = useState('');
 const [open, setOpen] = useState(false);
 const [users, setUsers] = useState<AdminUser[] | null>(null);
 const ref = useRef<HTMLDivElement>(null);

 const ensureUsers = async () => {
  if (users) return;
  try {
   const res = await fetch('/api/admin/users');
   const data = res.ok ? ((await res.json()) as { users: AdminUser[] }) : { users: [] };
   setUsers(data.users || []);
  } catch {
   setUsers([]);
  }
 };

 useEffect(() => {
  if (!open) return;
  const onDoc = (e: MouseEvent) => {
   if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
  };
  const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
  document.addEventListener('mousedown', onDoc);
  document.addEventListener('keydown', onEsc);
  return () => {
   document.removeEventListener('mousedown', onDoc);
   document.removeEventListener('keydown', onEsc);
  };
 }, [open]);

 const ql = q.trim().toLowerCase();
 const matches = ql && users ? users.filter((u) => u.name.toLowerCase().includes(ql) || u.email.toLowerCase().includes(ql)).slice(0, 6) : [];

 const go = (id: string) => {
  setOpen(false);
  setQ('');
  router.push(`/admin/users/${id}`);
 };

 return (
  <div className="ad-search ad-global-search" ref={ref} style={{ width: 240 }}>
   <Icon name="search" />
   <input
    type="text"
    placeholder={t('admin_search_global_ph')}
    value={q}
    onFocus={() => {
     setOpen(true);
     void ensureUsers();
    }}
    onChange={(e) => {
     setQ(e.target.value);
     setOpen(true);
    }}
   />
   {open && ql.length > 0 && (
    <div className="ad-search-menu">
     {matches.length === 0 ? (
      <div className="ad-search-empty">{t('admin_search_none')}</div>
     ) : (
      matches.map((u) => (
       <button key={u.id} type="button" className="ad-search-item" onClick={() => go(u.id)}>
        <Avatar name={u.name} image={u.image} id={u.id} size={26} />
        <div style={{ minWidth: 0 }}>
         <div className="ad-u-name" style={{ fontSize: 13 }}>{u.name}</div>
         <div className="ad-u-email">{u.email}</div>
        </div>
       </button>
      ))
     )}
     <button
      type="button"
      className="ad-search-all"
      onClick={() => {
       setOpen(false);
       router.push('/admin/users');
      }}
     >
      {t('admin_search_see_all')}
     </button>
    </div>
   )}
  </div>
 );
}
