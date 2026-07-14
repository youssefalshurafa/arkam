'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStableSession } from '@/hooks/useStableSession';
import { alertDialog, confirmDialog } from '@/components/ui/AppDialog';
import { useAdminI18n } from '../_ui/useAdminI18n';
import { Icon } from '../_ui/icons';
import { Avatar, AuthBadge, RoleBadge, RowMenu, Modal, StateBlock, SubscriptionBadge, Check } from '../_ui/primitives';
import { formatDate, ROLE_RANK } from '../_lib/format';
import type { AdminUser } from '../_lib/types';

function AddUserModal({ onCancel, onCreated }: { onCancel: () => void; onCreated: () => void }) {
 const { t } = useAdminI18n();
 const [name, setName] = useState('');
 const [email, setEmail] = useState('');
 const [phone, setPhone] = useState('');
 const [durationDays, setDurationDays] = useState('30');
 const [isSubmitting, setIsSubmitting] = useState(false);
 const [error, setError] = useState<string | null>(null);

 const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setError(null);
  const trimmedEmail = email.trim();
  if (!trimmedEmail) {
   setError(t('admin_au_email_required'));
   return;
  }
  const days = Number(durationDays);
  if (!Number.isFinite(days) || days <= 0) {
   setError(t('admin_au_days_positive'));
   return;
  }
  setIsSubmitting(true);
  try {
   const res = await fetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim(), email: trimmedEmail, durationDays: days, phone: phone.trim() }),
   });
   const data = (await res.json()) as { error?: string };
   if (!res.ok) {
    setError(data.error || t('admin_au_failed'));
    return;
   }
   await alertDialog({
    title: t('admin_au_created_title'),
    message: t('admin_au_created_msg').replace('{email}', trimmedEmail),
   });
   onCreated();
  } catch {
   setError(t('admin_err_network'));
  } finally {
   setIsSubmitting(false);
  }
 };

 return (
  <Modal onClose={onCancel}>
   <form onSubmit={handleSubmit}>
    <h2>{t('admin_add_user')}</h2>
    <p className="sub">{t('admin_au_desc')}</p>

    <div className="ad-stack" style={{ gap: 12 }}>
     <div>
      <label className="ad-label">{t('admin_au_name')}</label>
      <input className="ad-input" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('admin_au_name_ph')} />
     </div>
     <div>
      <label className="ad-label">{t('admin_au_email')}</label>
      <input className="ad-input" type="text" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('admin_au_email_ph')} />
     </div>
     <div>
      <label className="ad-label">{t('admin_au_phone')}</label>
      <input className="ad-input" type="text" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+20 100 000 0000" />
     </div>
     <div>
      <label className="ad-label">{t('admin_au_duration')}</label>
      <input className="ad-input" type="number" min={1} value={durationDays} onChange={(e) => setDurationDays(e.target.value)} />
      <div className="ad-row" style={{ gap: 8, marginTop: 8 }}>
       {[30, 90, 365].map((d) => (
        <button key={d} type="button" className="ad-btn sm" onClick={() => setDurationDays(String(d))}>
         {d}d
        </button>
       ))}
      </div>
     </div>
    </div>

    {error && <p style={{ color: 'var(--ad-bad-text)', fontSize: 13, marginTop: 12 }}>{error}</p>}

    <div className="ad-modal-actions">
     <button type="button" className="ad-btn" onClick={onCancel} disabled={isSubmitting}>
      {t('admin_cancel')}
     </button>
     <button type="submit" className="ad-btn primary" disabled={isSubmitting}>
      {isSubmitting ? t('admin_working') : t('admin_add_user')}
     </button>
    </div>
   </form>
  </Modal>
 );
}

function DeleteDialog({ user, onCancel, onConfirm, isDeleting }: { user: AdminUser; onCancel: () => void; onConfirm: () => void; isDeleting: boolean }) {
 const { t } = useAdminI18n();
 return (
  <Modal onClose={onCancel}>
   <h2>{t('admin_del_title')}</h2>
   <p className="sub">{t('admin_del_desc')}</p>
   <div className="ad-row" style={{ gap: 11, marginBottom: 12 }}>
    <Avatar name={user.name} image={user.image} id={user.id} />
    <div>
     <div className="ad-u-name">{user.name}</div>
     <div className="ad-u-email">{user.email}</div>
    </div>
   </div>
   {user.workspaceCount > 0 && (
    <div className="ad-note warn">
     <Icon name="warning" />
     <span>{t('admin_del_ws_warn').replace('{count}', String(user.workspaceCount))}</span>
    </div>
   )}
   <div className="ad-modal-actions">
    <button className="ad-btn" onClick={onCancel} disabled={isDeleting}>
     {t('admin_cancel')}
    </button>
    <button className="ad-btn danger" onClick={onConfirm} disabled={isDeleting}>
     {isDeleting ? t('admin_working') : t('admin_delete')}
    </button>
   </div>
  </Modal>
 );
}

function UserRow({
 user,
 nested,
 roleInTeam,
 selected,
 onToggleSelect,
 onDelete,
 onResetPassword,
}: {
 user: AdminUser;
 nested: boolean;
 roleInTeam?: string;
 selected: boolean;
 onToggleSelect: (id: string) => void;
 onDelete: (u: AdminUser) => void;
 onResetPassword: (u: AdminUser) => void;
}) {
 const router = useRouter();
 const { t, language } = useAdminI18n();
 return (
  <tr className={`clickable ${selected ? 'selected' : ''}`} onClick={() => router.push(`/admin/users/${user.id}`)}>
   <td onClick={(e) => e.stopPropagation()}>
    <Check on={selected} onClick={() => onToggleSelect(user.id)} />
   </td>
   <td>
    <div className="ad-u-cell" style={nested ? { paddingInlineStart: 26 } : undefined}>
     {nested && <span className="ad-faint">↳</span>}
     <Avatar name={user.name} image={user.image} id={user.id} size={nested ? 28 : 34} />
     <div>
      <div className="ad-u-name">
       {user.name}
       {roleInTeam && <RoleBadge role={roleInTeam} t={t} />}
      </div>
      <div className="ad-u-email">{user.email}</div>
     </div>
    </div>
   </td>
   <td>
    <AuthBadge provider={user.authProvider} t={t} />
   </td>
   <td>
    <SubscriptionBadge endsAt={user.subscriptionEndsAt} />
   </td>
   <td className="ad-muted ad-num" style={{ whiteSpace: 'nowrap' }}>
    {formatDate(user.createdAt, language)}
   </td>
   <td className="center">
    {user.workspaceCount > 0 ? <span className="ad-ws-pill ad-num">{user.workspaceCount}</span> : <span className="ad-faint">—</span>}
   </td>
   <td className="end" onClick={(e) => e.stopPropagation()}>
    <RowMenu
     ariaLabel={user.name}
     items={[
      { label: t('admin_view_details'), icon: 'user', onClick: () => router.push(`/admin/users/${user.id}`) },
      { label: t('admin_reset_password'), icon: 'key', onClick: () => onResetPassword(user) },
      { label: t('admin_delete'), icon: 'trash', danger: true, onClick: () => onDelete(user) },
     ]}
    />
   </td>
  </tr>
 );
}

export default function AdminUsersPage() {
 const { status } = useStableSession();
 const router = useRouter();
 const { t } = useAdminI18n();

 const [users, setUsers] = useState<AdminUser[]>([]);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);
 const [search, setSearch] = useState('');
 const [pendingDelete, setPendingDelete] = useState<AdminUser | null>(null);
 const [isDeleting, setIsDeleting] = useState(false);
 const [showAddUser, setShowAddUser] = useState(false);
 const [sel, setSel] = useState<Set<string>>(new Set());
 const [bulkBusy, setBulkBusy] = useState(false);

 const fetchUsers = useCallback(async () => {
  setLoading(true);
  setError(null);
  try {
   const res = await fetch('/api/admin/users');
   if (res.status === 403) {
    setError('forbidden');
    return;
   }
   if (!res.ok) throw new Error('Failed to load users.');
   const data = (await res.json()) as { users: AdminUser[] };
   setUsers(data.users);
  } catch {
   setError('Failed to load users.');
  } finally {
   setLoading(false);
  }
 }, []);

 useEffect(() => {
  if (status === 'unauthenticated') router.replace('/login');
 }, [status, router]);
 useEffect(() => {
  if (status === 'authenticated') void fetchUsers();
 }, [status, fetchUsers]);

 const handleDelete = async () => {
  if (!pendingDelete) return;
  setIsDeleting(true);
  try {
   const res = await fetch('/api/admin/users', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: pendingDelete.id }),
   });
   const data = (await res.json()) as { error?: string };
   if (!res.ok) {
    await alertDialog({ title: t('admin_err_title'), message: data.error || t('admin_del_failed') });
    return;
   }
   setUsers((prev) => prev.filter((u) => u.id !== pendingDelete.id));
   setPendingDelete(null);
  } catch {
   await alertDialog({ title: t('admin_err_title'), message: t('admin_err_network') });
  } finally {
   setIsDeleting(false);
  }
 };

 const handleResetPassword = async (user: AdminUser) => {
  const confirmed = await confirmDialog({
   title: t('admin_rp_title'),
   message: t('admin_rp_confirm').replace(/\{name\}/g, user.name).replace(/\{email\}/g, user.email),
  });
  if (!confirmed) return;
  try {
   const res = await fetch(`/api/admin/users/${user.id}`, { method: 'POST' });
   const data = (await res.json()) as { ok?: boolean; error?: string };
   if (!res.ok || !data.ok) {
    await alertDialog({ title: t('admin_err_title'), message: data.error || t('admin_rp_failed') });
    return;
   }
   await alertDialog({
    title: t('admin_rp_done_title'),
    message: t('admin_rp_done_msg').replace(/\{name\}/g, user.name).replace(/\{email\}/g, user.email),
   });
  } catch {
   await alertDialog({ title: t('admin_err_title'), message: t('admin_err_network') });
  }
 };

 // Nest teammates (who own no workspace of their own) under the owner of the
 // workspace they belong to, ranked by role. Mirrors the original grouping.
 const { userGroups, visibleUserCount, visibleIds } = useMemo(() => {
  const workspaceOwnerId = new Map<string, string>();
  for (const u of users) for (const ws of u.workspaces) if (ws.isOwner) workspaceOwnerId.set(ws.id, u.id);

  const childrenByParentId = new Map<string, Array<{ user: AdminUser; role: string }>>();
  const nestedChildIds = new Set<string>();
  for (const u of users) {
   if (u.workspaces.some((ws) => ws.isOwner)) continue;
   for (const ws of u.workspaces) {
    const ownerId = workspaceOwnerId.get(ws.id);
    if (ownerId && ownerId !== u.id) {
     const arr = childrenByParentId.get(ownerId) ?? [];
     arr.push({ user: u, role: ws.role });
     childrenByParentId.set(ownerId, arr);
     nestedChildIds.add(u.id);
     break;
    }
   }
  }
  for (const children of childrenByParentId.values()) children.sort((a, b) => (ROLE_RANK[a.role] ?? 99) - (ROLE_RANK[b.role] ?? 99));

  const searchLower = search.toLowerCase();
  const matches = (u: AdminUser) => u.name.toLowerCase().includes(searchLower) || u.email.toLowerCase().includes(searchLower);

  const groups = users
   .filter((u) => !nestedChildIds.has(u.id))
   .map((user) => {
    const children = childrenByParentId.get(user.id) ?? [];
    const parentMatches = !search || matches(user);
    const visibleChildren = parentMatches ? children : children.filter((c) => matches(c.user));
    return { user, children: visibleChildren, include: parentMatches || children.some((c) => matches(c.user)) };
   })
   .filter((g) => g.include);

  return {
   userGroups: groups,
   visibleUserCount: groups.reduce((sum, g) => sum + 1 + g.children.length, 0),
   visibleIds: groups.flatMap((g) => [g.user.id, ...g.children.map((c) => c.user.id)]),
  };
 }, [users, search]);

 const selectedVisible = visibleIds.filter((id) => sel.has(id));
 const toggleSelect = (id: string) =>
  setSel((prev) => {
   const n = new Set(prev);
   if (n.has(id)) n.delete(id);
   else n.add(id);
   return n;
  });
 const toggleAll = () => setSel(selectedVisible.length === visibleIds.length && visibleIds.length > 0 ? new Set() : new Set(visibleIds));
 const clearSel = () => setSel(new Set());

 const bulkReport = async (titleKey: string, done: number, total: number) =>
  alertDialog({ title: t(titleKey), message: t('admin_bulk_done').replace('{done}', String(done)).replace('{total}', String(total)) });

 const bulkDelete = async () => {
  const ids = selectedVisible;
  if (ids.length === 0) return;
  if (!(await confirmDialog({ title: t('admin_del_title'), message: t('admin_bulk_delete_confirm').replace('{count}', String(ids.length)) }))) return;
  setBulkBusy(true);
  let done = 0;
  for (const id of ids) {
   try {
    const res = await fetch('/api/admin/users', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: id }) });
    if (res.ok) done += 1;
   } catch {
    /* counted as not-done */
   }
  }
  setBulkBusy(false);
  clearSel();
  await bulkReport('admin_delete', done, ids.length);
  void fetchUsers();
 };

 const bulkReset = async () => {
  const ids = selectedVisible;
  if (ids.length === 0) return;
  if (!(await confirmDialog({ title: t('admin_rp_title'), message: t('admin_bulk_reset_confirm').replace('{count}', String(ids.length)) }))) return;
  setBulkBusy(true);
  let done = 0;
  for (const id of ids) {
   try {
    const res = await fetch(`/api/admin/users/${id}`, { method: 'POST' });
    const d = (await res.json()) as { ok?: boolean };
    if (res.ok && d.ok) done += 1;
   } catch {
    /* counted as not-done */
   }
  }
  setBulkBusy(false);
  clearSel();
  await bulkReport('admin_reset_password', done, ids.length);
 };

 const exportCsv = () => {
  const rows = [['Name', 'Email', 'Auth', 'Joined', 'Workspaces']];
  for (const u of users) rows.push([u.name, u.email, u.authProvider === 'oauth' ? 'Google' : 'Password', u.createdAt, String(u.workspaceCount)]);
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `arkam-users-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
 };

 const countLabel = t('admin_users_count').replace('{visible}', String(visibleUserCount)).replace('{total}', String(users.length));

 return (
  <>
   <div className="ad-toolbar">
    <div className="ad-search" style={{ width: 280 }}>
     <Icon name="search" />
     <input type="text" placeholder={t('admin_search_users_ph')} value={search} onChange={(e) => setSearch(e.target.value)} />
    </div>
    <div className="ad-spacer" />
    <span className="ad-faint" style={{ fontSize: 12 }}>
     {countLabel}
    </span>
    <button className="ad-btn" onClick={() => void fetchUsers()}>
     <Icon name="refresh" />
     {t('admin_refresh')}
    </button>
    <button className="ad-btn" onClick={exportCsv}>
     <Icon name="download" />
     {t('admin_export')}
    </button>
    <button className="ad-btn primary" onClick={() => setShowAddUser(true)}>
     <Icon name="plus" />
     {t('admin_add_user')}
    </button>
   </div>

   {selectedVisible.length > 0 && (
    <div className="ad-bulk-bar">
     <span className="cnt ad-num">{t('admin_selected').replace('{count}', String(selectedVisible.length))}</span>
     <span className="sep" />
     <button className="bbtn" disabled={bulkBusy} onClick={() => void bulkReset()}>
      <Icon name="key" />
      {t('admin_reset_password')}
     </button>
     <button className="bbtn danger" disabled={bulkBusy} onClick={() => void bulkDelete()}>
      <Icon name="trash" />
      {t('admin_delete')}
     </button>
     <button className="bbtn close" onClick={clearSel} aria-label={t('admin_clear')}>
      <Icon name="x" strokeWidth={2} />
     </button>
    </div>
   )}

   <div className="ad-card ad-table-wrap">
    {loading ? (
     <StateBlock>{t('admin_loading')}</StateBlock>
    ) : error === 'forbidden' ? (
     <StateBlock>🚫 {error}</StateBlock>
    ) : error ? (
     <StateBlock>{error}</StateBlock>
    ) : userGroups.length === 0 ? (
     <StateBlock>{t('admin_no_users')}</StateBlock>
    ) : (
     <table className="ad-table hover">
      <thead>
       <tr>
        <th style={{ width: 20 }}>
         <Check on={selectedVisible.length === visibleIds.length && visibleIds.length > 0} onClick={toggleAll} />
        </th>
        <th>{t('admin_col_user')}</th>
        <th>{t('admin_col_auth')}</th>
        <th>{t('admin_col_sub')}</th>
        <th>{t('admin_col_joined')}</th>
        <th className="center">{t('admin_col_ws')}</th>
        <th />
       </tr>
      </thead>
      <tbody>
       {userGroups.map(({ user, children }) => (
        <React.Fragment key={user.id}>
         <UserRow
          user={user}
          nested={false}
          selected={sel.has(user.id)}
          onToggleSelect={toggleSelect}
          onDelete={setPendingDelete}
          onResetPassword={(u) => void handleResetPassword(u)}
         />
         {children.map(({ user: child, role }) => (
          <UserRow
           key={child.id}
           user={child}
           nested
           roleInTeam={role}
           selected={sel.has(child.id)}
           onToggleSelect={toggleSelect}
           onDelete={setPendingDelete}
           onResetPassword={(u) => void handleResetPassword(u)}
          />
         ))}
        </React.Fragment>
       ))}
      </tbody>
     </table>
    )}
   </div>

   {pendingDelete && <DeleteDialog user={pendingDelete} onCancel={() => setPendingDelete(null)} onConfirm={() => void handleDelete()} isDeleting={isDeleting} />}
   {showAddUser && (
    <AddUserModal
     onCancel={() => setShowAddUser(false)}
     onCreated={() => {
      setShowAddUser(false);
      void fetchUsers();
     }}
    />
   )}
  </>
 );
}
