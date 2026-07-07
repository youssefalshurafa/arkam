'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { confirmDialog, promptDialog } from '@/components/ui/AppDialog';
import { accountingApi, type WorkspaceMember, type WorkspaceRole } from '@/lib/accountingApi';

const ROLE_OPTIONS: WorkspaceRole[] = ['admin', 'member', 'viewer'];

function roleLabel(role: string, t: (key: string) => string) {
 switch (role) {
  case 'owner':
   return t('team_role_owner');
  case 'admin':
   return t('team_role_admin');
  case 'member':
   return t('team_role_member');
  case 'viewer':
   return t('team_role_viewer');
  default:
   return role;
 }
}

function roleBadgeClass(role: string) {
 switch (role) {
  case 'owner':
   return 'bg-amber-100 text-amber-700';
  case 'admin':
   return 'bg-blue-50 text-blue-700';
  case 'member':
   return 'bg-green-50 text-green-700';
  default:
   return 'bg-gray-100 text-gray-500';
 }
}

const panelClass = 'rounded-lg border border-gray-200 bg-white p-5 shadow-sm';

export default function TeamSettings() {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const { data: session } = useSession();
 const currentUserId = session?.user?.id;
 const isSuperAdmin = Boolean(session?.user?.isSuperAdmin);

 const [workspaceId, setWorkspaceId] = useState<string | null>(null);
 const [workspaceName, setWorkspaceName] = useState('');
 const [currentRole, setCurrentRole] = useState<string>('');
 const [members, setMembers] = useState<WorkspaceMember[]>([]);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState('');
 const [notice, setNotice] = useState('');

 // Every workspace the user belongs to, for the "Your workspaces" list (rename/delete).
 const [allWorkspaces, setAllWorkspaces] = useState<Array<{ id: string; name: string; role: string }>>([]);
 const [workspaceActionBusyId, setWorkspaceActionBusyId] = useState<string | null>(null);
 const [workspaceActionError, setWorkspaceActionError] = useState('');

 // Super-admin-only, for now (eventually gated by subscription plan instead).
 const [newWorkspaceName, setNewWorkspaceName] = useState('');
 const [creatingWorkspace, setCreatingWorkspace] = useState(false);
 const [createWorkspaceError, setCreateWorkspaceError] = useState('');

 // Invite form
 const [inviteName, setInviteName] = useState('');
 const [inviteEmail, setInviteEmail] = useState('');
 const [inviteRole, setInviteRole] = useState<WorkspaceRole>('member');
 const [inviting, setInviting] = useState(false);
 const [busyUserId, setBusyUserId] = useState<string | null>(null);

 const canManage = currentRole === 'owner' || currentRole === 'admin';

 const loadMembers = async (wsId: string) => {
  try {
   const { members: list } = await accountingApi.listWorkspaceMembers(wsId);
   setMembers(list);
  } catch (e) {
   setError(e instanceof Error ? e.message : 'Failed to load members.');
  }
 };

 useEffect(() => {
  const init = async () => {
   setLoading(true);
   try {
    const { workspaces, defaultWorkspaceId } = await accountingApi.listWorkspaces();
    setAllWorkspaces(workspaces);
    const activeId = accountingApi.getActiveWorkspaceId() || defaultWorkspaceId || workspaces[0]?.id || null;
    const active = workspaces.find((w) => w.id === activeId) || workspaces[0] || null;
    if (active) {
     setWorkspaceId(active.id);
     setWorkspaceName(active.name);
     setCurrentRole(active.role);
     await loadMembers(active.id);
    }
   } catch (e) {
    setError(e instanceof Error ? e.message : 'Failed to load workspace.');
   } finally {
    setLoading(false);
   }
  };
  void init();
 }, []);

 const onInvite = async (event: FormEvent) => {
  event.preventDefault();
  if (!workspaceId) return;
  setError('');
  setNotice('');
  setInviting(true);
  try {
   const res = await accountingApi.inviteWorkspaceMember({ workspaceId, name: inviteName, email: inviteEmail, role: inviteRole });
   if (!res.emailSent) {
    setNotice(t('team_invite_no_email_notice'));
   } else {
    setNotice(res.status === 'invited' ? t('team_invite_sent') : t('team_member_added'));
   }
   setInviteName('');
   setInviteEmail('');
   setInviteRole('member');
   await loadMembers(workspaceId);
  } catch (e) {
   setError(e instanceof Error ? e.message : t('team_invite_failed'));
  } finally {
   setInviting(false);
  }
 };

 const onChangeRole = async (member: WorkspaceMember, role: WorkspaceRole) => {
  if (!workspaceId) return;
  setError('');
  setNotice('');
  setBusyUserId(member.id);
  try {
   await accountingApi.updateWorkspaceMemberRole({ workspaceId, targetUserId: member.id, role });
   await loadMembers(workspaceId);
  } catch (e) {
   setError(e instanceof Error ? e.message : 'Failed to update role.');
  } finally {
   setBusyUserId(null);
  }
 };

 const onCreateWorkspace = async (event: FormEvent) => {
  event.preventDefault();
  if (!newWorkspaceName.trim() || creatingWorkspace) return;
  setCreateWorkspaceError('');
  setCreatingWorkspace(true);
  try {
   const { workspace } = await accountingApi.createWorkspace(newWorkspaceName.trim());
   accountingApi.setActiveWorkspaceId(workspace.id);
   // Full reload to cleanly re-scope all workspace-bound state to the new workspace.
   window.location.reload();
  } catch (e) {
   setCreateWorkspaceError(e instanceof Error ? e.message : t('team_new_workspace_failed'));
   setCreatingWorkspace(false);
  }
 };

 const onRenameWorkspace = async (ws: { id: string; name: string }) => {
  setWorkspaceActionError('');
  const name = await promptDialog({
   title: t('team_workspace_rename_title'),
   defaultValue: ws.name,
   placeholder: t('team_workspace_rename_placeholder'),
  });
  if (!name || !name.trim() || name.trim() === ws.name) return;
  setWorkspaceActionBusyId(ws.id);
  try {
   await accountingApi.renameWorkspace(ws.id, name.trim());
   // Full reload: the sidebar workspace switcher + header both hold their own
   // copy of the workspace list from the page, not reactive to this component.
   window.location.reload();
  } catch (e) {
   setWorkspaceActionError(e instanceof Error ? e.message : t('team_workspace_rename_failed'));
   setWorkspaceActionBusyId(null);
  }
 };

 const onDeleteWorkspace = async (ws: { id: string; name: string }) => {
  setWorkspaceActionError('');
  setWorkspaceActionBusyId(ws.id);
  try {
   const { transactionCount } = await accountingApi.getWorkspaceTransactionCount(ws.id);
   const confirmed = await confirmDialog({
    title: t('team_workspace_delete_title'),
    message: t('team_workspace_delete_message').replace('{name}', ws.name).replace('{count}', String(transactionCount)),
    confirmText: t('team_workspace_delete'),
    tone: 'danger',
   });
   if (!confirmed) {
    setWorkspaceActionBusyId(null);
    return;
   }
   await accountingApi.deleteWorkspace(ws.id);
   // Full reload: lets page.tsx's existing stale-workspace fallback pick a
   // valid active workspace if the deleted one was the active one.
   window.location.reload();
  } catch (e) {
   setWorkspaceActionError(e instanceof Error ? e.message : t('team_workspace_delete_failed'));
   setWorkspaceActionBusyId(null);
  }
 };

 const onRemove = async (member: WorkspaceMember) => {
  if (!workspaceId) return;
  if (!(await confirmDialog({ message: t('team_remove_confirm').replace('{name}', member.name || member.email), confirmText: t('delete'), tone: 'danger' }))) return;
  setError('');
  setNotice('');
  setBusyUserId(member.id);
  try {
   await accountingApi.removeWorkspaceMember({ workspaceId, targetUserId: member.id });
   await loadMembers(workspaceId);
  } catch (e) {
   setError(e instanceof Error ? e.message : 'Failed to remove member.');
  } finally {
   setBusyUserId(null);
  }
 };

 return (
  <section className="flex flex-col gap-6">
   {/* Create workspace (super admin only, for now) */}
   {isSuperAdmin && (
    <div className={panelClass}>
     <h2 className="text-2xl font-semibold">{t('team_new_workspace_title')}</h2>
     <p className="mt-2 text-sm text-slate-600">{t('team_new_workspace_desc')}</p>

     <form onSubmit={(e) => void onCreateWorkspace(e)} className="mt-5 flex flex-col gap-3 sm:flex-row">
      <input
       type="text"
       value={newWorkspaceName}
       onChange={(e) => setNewWorkspaceName(e.target.value)}
       placeholder={t('team_new_workspace_placeholder')}
       required
       className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
      />
      <button
       type="submit"
       disabled={creatingWorkspace || !newWorkspaceName.trim()}
       className="rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
       {creatingWorkspace ? t('team_new_workspace_creating') : t('team_new_workspace_button')}
      </button>
     </form>
     {createWorkspaceError && <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{createWorkspaceError}</p>}
    </div>
   )}

   {/* Your workspaces (list + rename/delete for ones you own) */}
   {allWorkspaces.length > 0 && (
    <div className={panelClass}>
     <h2 className="text-2xl font-semibold">{t('team_workspaces_title')}</h2>
     <p className="mt-2 text-sm text-slate-600">{t('team_workspaces_desc')}</p>

     <div className="mt-5 divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
      {allWorkspaces.map((ws) => {
       const isOwner = ws.role === 'owner';
       const busy = workspaceActionBusyId === ws.id;
       return (
        <div key={ws.id} className="flex items-center justify-between gap-3 px-4 py-3">
         <div>
          <div className="font-medium text-gray-900">{ws.name}</div>
          <span className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${roleBadgeClass(ws.role)}`}>{roleLabel(ws.role, t)}</span>
         </div>
         {isOwner && (
          <div className="flex shrink-0 gap-2">
           <button
            type="button"
            onClick={() => void onRenameWorkspace(ws)}
            disabled={busy}
            className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
           >
            {t('team_workspace_rename')}
           </button>
           <button
            type="button"
            onClick={() => void onDeleteWorkspace(ws)}
            disabled={busy}
            className="rounded border border-red-200 px-3 py-1.5 text-xs text-red-600 transition hover:bg-red-50 disabled:opacity-50"
           >
            {t('team_workspace_delete')}
           </button>
          </div>
         )}
        </div>
       );
      })}
     </div>
     {workspaceActionError && <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{workspaceActionError}</p>}
    </div>
   )}

   {/* Invite */}
   {canManage && (
    <div className={panelClass}>
     <h2 className="text-2xl font-semibold">{t('team_invite_title')}</h2>
     <p className="mt-2 text-sm text-slate-600">{t('team_invite_desc')}</p>

     <form onSubmit={(e) => void onInvite(e)} className="mt-5 grid gap-3 sm:grid-cols-4">
      <input
       type="text"
       value={inviteName}
       onChange={(e) => setInviteName(e.target.value)}
       placeholder={t('team_name')}
       className="rounded border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
      />
      <input
       type="text"
       value={inviteEmail}
       onChange={(e) => setInviteEmail(e.target.value)}
       placeholder={t('team_email')}
       required
       className="rounded border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
      />
      <select
       value={inviteRole}
       onChange={(e) => setInviteRole(e.target.value as WorkspaceRole)}
       className="rounded border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
      >
       {ROLE_OPTIONS.map((r) => (
        <option key={r} value={r}>
         {roleLabel(r, t)}
        </option>
       ))}
      </select>
      <button
       type="submit"
       disabled={inviting}
       className="rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
       {inviting ? t('team_inviting') : t('team_invite_button')}
      </button>
     </form>
     {notice && <p className="mt-3 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>}
     {error && <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </div>
   )}

   {/* Members */}
   <div className={panelClass}>
    <h2 className="text-2xl font-semibold">{t('team_members_title')}</h2>
    <p className="mt-2 text-sm text-slate-600">
     {t('team_members_desc')}
     {workspaceName ? ` — ${workspaceName}` : ''}
    </p>

    {!canManage && error && <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

    <div className="mt-5 overflow-hidden rounded-lg border border-gray-200">
     {loading ? (
      <div className="py-12 text-center text-sm text-gray-400">{t('loading')}</div>
     ) : members.length === 0 ? (
      <div className="py-12 text-center text-sm text-gray-400">{t('team_no_members')}</div>
     ) : (
      <table className="w-full text-sm">
       <thead>
        <tr className="border-b border-gray-200 bg-gray-50">
         <th className="px-4 py-3 text-left font-medium text-gray-500">{t('team_member')}</th>
         <th className="px-4 py-3 text-left font-medium text-gray-500">{t('team_role')}</th>
         {canManage && <th className="px-4 py-3" />}
        </tr>
       </thead>
       <tbody className="divide-y divide-gray-100">
        {members.map((member) => {
         const isOwnerRow = member.role === 'owner';
         const isSelf = member.id === currentUserId;
         const editable = canManage && !isOwnerRow && !isSelf;
         return (
          <tr key={member.id} className="hover:bg-gray-50">
           <td className="px-4 py-3">
            <div className="font-medium text-gray-900">{member.name || member.email}</div>
            <div className="text-xs text-gray-400">{member.email}</div>
           </td>
           <td className="px-4 py-3">
            {editable ? (
             <select
              value={member.role}
              disabled={busyUserId === member.id}
              onChange={(e) => void onChangeRole(member, e.target.value as WorkspaceRole)}
              className="rounded border border-gray-300 px-2 py-1 text-xs outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
             >
              {ROLE_OPTIONS.map((r) => (
               <option key={r} value={r}>
                {roleLabel(r, t)}
               </option>
              ))}
             </select>
            ) : (
             <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${roleBadgeClass(member.role)}`}>{roleLabel(member.role, t)}</span>
            )}
           </td>
           {canManage && (
            <td className="px-4 py-3 text-right">
             {editable ? (
              <button
               type="button"
               onClick={() => void onRemove(member)}
               disabled={busyUserId === member.id}
               className="rounded border border-red-200 px-3 py-1.5 text-xs text-red-600 transition hover:bg-red-50 disabled:opacity-50"
              >
               {t('team_remove')}
              </button>
             ) : (
              <span className="text-xs text-gray-300">—</span>
             )}
            </td>
           )}
          </tr>
         );
        })}
       </tbody>
      </table>
     )}
    </div>
   </div>
  </section>
 );
}
