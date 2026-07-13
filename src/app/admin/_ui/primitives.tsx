'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './icons';
import { useAdminI18n } from './useAdminI18n';
import { avatarColor, getInitials, teamRoleLabel } from '../_lib/format';
import { getSubscriptionState } from '@/app/admin/subscription';

// ---------- Avatar ----------
export function Avatar({ name, image, id, size = 34 }: { name: string; image?: string | null; id?: string; size?: number }) {
 if (image) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={image} alt={name} className="ad-avatar" style={{ width: size, height: size }} />;
 }
 return (
  <div className="ad-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: avatarColor(id || name || '') }}>
   {getInitials(name)}
  </div>
 );
}

// ---------- Badges ----------
export function AuthBadge({ provider, t }: { provider: 'credentials' | 'oauth'; t: (k: string) => string }) {
 return provider === 'oauth' ? (
  <span className="ad-badge info">
   <span className="dot" />
   {t('admin_auth_google')}
  </span>
 ) : (
  <span className="ad-badge neutral">
   <span className="dot" />
   {t('admin_auth_password')}
  </span>
 );
}

export function RoleBadge({ role, t }: { role: string; t: (k: string) => string }) {
 const owner = role === 'owner';
 return <span className={`ad-badge tiny ${owner ? 'warn' : 'neutral'}`}>{teamRoleLabel(role, t)}</span>;
}

// Subscription pill driven by the shared state helper. The English label from
// subscription.ts is ignored here; the localized label is composed from the tone
// and day count so the badge reads correctly in every language.
export function SubscriptionBadge({ endsAt }: { endsAt: string | null }) {
 const { t } = useAdminI18n();
 const s = getSubscriptionState(endsAt);
 const cls = s.tone === 'expired' ? 'bad' : s.tone === 'soon' ? 'warn' : s.tone === 'active' ? 'good' : 'neutral';
 let label: string;
 if (s.tone === 'none') label = t('admin_sub_none');
 else if (s.tone === 'expired') label = t('admin_sub_expired');
 else {
  const d = s.daysLeft ?? 0;
  label = (d === 1 ? t('admin_sub_day_left') : t('admin_sub_days_left')).replace('{days}', String(d));
 }
 return (
  <span className={`ad-badge ${cls}`}>
   {s.tone !== 'none' && <span className="dot" />}
   {label}
  </span>
 );
}

export function RequestStatusBadge({ status, t }: { status: 'pending' | 'approved' | 'rejected'; t: (k: string) => string }) {
 const cls = status === 'approved' ? 'good' : status === 'rejected' ? 'bad' : 'warn';
 const label = status === 'approved' ? t('admin_status_approved') : status === 'rejected' ? t('admin_status_rejected') : t('admin_status_pending');
 return <span className={`ad-badge ${cls}`}>{label}</span>;
}

// ---------- KPI card ----------
export function KpiCard({
 icon,
 tone,
 label,
 value,
 foot,
}: {
 icon: IconName;
 tone?: 'accent' | 'good' | 'warn' | 'bad';
 label: string;
 value: React.ReactNode;
 foot?: React.ReactNode;
}) {
 const toneCls = tone && tone !== 'accent' ? tone : '';
 return (
  <div className="ad-kpi">
   <div className="ad-kpi-top">
    <div className={`ad-kpi-ic ${toneCls}`}>
     <Icon name={icon} />
    </div>
    <span className="ad-kpi-label">{label}</span>
   </div>
   <div className="ad-kpi-val ad-num">{value}</div>
   {foot && <div className="ad-kpi-foot">{foot}</div>}
  </div>
 );
}

// Simple stat tile (used on user-detail); lighter than KpiCard.
export function StatTile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
 return (
  <div className="ad-card ad-card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
   <span className="ad-num" style={{ fontSize: 24, fontWeight: 700 }}>
    {value}
   </span>
   <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ad-muted)' }}>{label}</span>
   {sub && <span className="ad-faint" style={{ fontSize: 12 }}>{sub}</span>}
  </div>
 );
}

// ---------- State blocks ----------
export function StateBlock({ children }: { children: React.ReactNode }) {
 return <div className="ad-state">{children}</div>;
}

// ---------- Checkbox ----------
export function Check({ on, onClick }: { on: boolean; onClick: (e: React.MouseEvent) => void }) {
 return (
  <div className={`ad-chk ${on ? 'on' : ''}`} onClick={onClick} role="checkbox" aria-checked={on}>
   <Icon name="check-bold" strokeWidth={3} />
  </div>
 );
}

// ---------- Row action menu ----------
export type RowMenuItem = {
 label: string;
 icon?: IconName;
 onClick: () => void;
 danger?: boolean;
};

export function RowMenu({ items, ariaLabel }: { items: RowMenuItem[]; ariaLabel?: string }) {
 const [open, setOpen] = useState(false);
 const ref = useRef<HTMLDivElement>(null);

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

 return (
  <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
   <button
    type="button"
    className="ad-row-menu-btn"
    aria-label={ariaLabel || 'Actions'}
    aria-haspopup="menu"
    aria-expanded={open}
    onClick={(e) => {
     e.stopPropagation();
     setOpen((v) => !v);
    }}
   >
    <Icon name="dots" />
   </button>
   {open && (
    <div className="ad-menu" role="menu" onClick={(e) => e.stopPropagation()}>
     {items.map((item, i) => (
      <button
       key={i}
       type="button"
       role="menuitem"
       className={item.danger ? 'danger' : ''}
       onClick={() => {
        setOpen(false);
        item.onClick();
       }}
      >
       {item.icon && <Icon name={item.icon} />}
       {item.label}
      </button>
     ))}
    </div>
   )}
  </div>
 );
}

// ---------- Modal ----------
export function Modal({ onClose, children, maxWidth }: { onClose: () => void; children: React.ReactNode; maxWidth?: number }) {
 useEffect(() => {
  const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
  document.addEventListener('keydown', onEsc);
  return () => document.removeEventListener('keydown', onEsc);
 }, [onClose]);
 return (
  <div className="ad-modal-overlay" onClick={onClose}>
   <div className="ad-modal" style={maxWidth ? { maxWidth } : undefined} onClick={(e) => e.stopPropagation()}>
    {children}
   </div>
  </div>
 );
}

// ---------- Section header with optional action ----------
export function SectionHeader({ title, eyebrow, action }: { title: string; eyebrow?: boolean; action?: React.ReactNode }) {
 return (
  <div className="ad-section-head">
   <span className={eyebrow ? 'ad-eyebrow' : 'ad-section-title'}>{title}</span>
   {action}
  </div>
 );
}
