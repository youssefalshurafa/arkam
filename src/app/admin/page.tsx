'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

type Workspace = {
 id: string;
 name: string;
 slug: string;
 role: string;
 isOwner: boolean;
};

type AdminUser = {
 id: string;
 email: string;
 name: string;
 image: string | null;
 authProvider: 'credentials' | 'oauth';
 createdAt: string;
 workspaceCount: number;
 workspaces: Workspace[];
};

type Stats = {
 totalUsers: number;
 totalWorkspaces: number;
 credentialUsers: number;
 oauthUsers: number;
};

function formatDate(iso: string) {
 return new Date(iso).toLocaleDateString('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
 });
}

function getInitials(name: string) {
 return name
  .split(' ')
  .map((w) => w[0])
  .join('')
  .toUpperCase()
  .slice(0, 2);
}

function Avatar({ user }: { user: AdminUser }) {
 if (user.image) {
  return (
   <img
    src={user.image}
    alt={user.name}
    className="w-8 h-8 rounded-full object-cover"
   />
  );
 }
 return <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-semibold shrink-0">{getInitials(user.name)}</div>;
}

function StatCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
 return (
  <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-1">
   <span className="text-2xl font-bold text-gray-900">{value}</span>
   <span className="text-sm font-medium text-gray-700">{label}</span>
   {sub && <span className="text-xs text-gray-400">{sub}</span>}
  </div>
 );
}

type DeleteDialogProps = {
 user: AdminUser;
 onCancel: () => void;
 onConfirm: () => void;
 isDeleting: boolean;
};

function DeleteDialog({ user, onCancel, onConfirm, isDeleting }: DeleteDialogProps) {
 return (
  <div className="fixed inset-0 z-50 flex items-center justify-center">
   <div
    className="absolute inset-0 bg-black/40"
    onClick={onCancel}
   />
   <div className="relative bg-white rounded-2xl shadow-xl p-6 w-full max-w-md mx-4">
    <h2 className="text-lg font-semibold text-gray-900 mb-1">Delete user?</h2>
    <p className="text-sm text-gray-600 mb-1">You are about to permanently delete:</p>
    <p className="text-sm font-medium text-gray-900 mb-1">{user.name}</p>
    <p className="text-sm text-gray-500 mb-4">{user.email}</p>
    {user.workspaceCount > 0 && (
     <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700">
      This will also permanently delete{' '}
      <strong>
       {user.workspaceCount} workspace{user.workspaceCount > 1 ? 's' : ''}
      </strong>{' '}
      and all their accounting data.
     </div>
    )}
    <div className="flex justify-end gap-3">
     <button
      onClick={onCancel}
      disabled={isDeleting}
      className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
     >
      Cancel
     </button>
     <button
      onClick={onConfirm}
      disabled={isDeleting}
      className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-60"
     >
      {isDeleting ? 'Deleting…' : 'Delete permanently'}
     </button>
    </div>
   </div>
  </div>
 );
}

export default function AdminPage() {
 const { data: session, status } = useSession();
 const router = useRouter();

 const [users, setUsers] = useState<AdminUser[]>([]);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);
 const [search, setSearch] = useState('');
 const [pendingDelete, setPendingDelete] = useState<AdminUser | null>(null);
 const [isDeleting, setIsDeleting] = useState(false);
 const [expandedUser, setExpandedUser] = useState<string | null>(null);

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
  if (status === 'unauthenticated') {
   router.replace('/login');
  }
 }, [status, router]);

 useEffect(() => {
  if (status === 'authenticated') {
   void fetchUsers();
  }
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
    alert(data.error || 'Failed to delete user.');
    return;
   }
   setUsers((prev) => prev.filter((u) => u.id !== pendingDelete.id));
   setPendingDelete(null);
  } catch {
   alert('Network error. Please try again.');
  } finally {
   setIsDeleting(false);
  }
 };

 const filtered = users.filter((u) => u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase()));

 const stats: Stats = {
  totalUsers: users.length,
  totalWorkspaces: users.reduce((s, u) => s + u.workspaceCount, 0),
  credentialUsers: users.filter((u) => u.authProvider === 'credentials').length,
  oauthUsers: users.filter((u) => u.authProvider === 'oauth').length,
 };

 if (status === 'loading') {
  return (
   <div className="min-h-screen flex items-center justify-center bg-gray-50">
    <div className="text-gray-400 text-sm">Loading…</div>
   </div>
  );
 }

 if (error === 'forbidden') {
  return (
   <div className="min-h-screen flex items-center justify-center bg-gray-50">
    <div className="text-center">
     <p className="text-4xl mb-2">🚫</p>
     <h1 className="text-xl font-semibold text-gray-800 mb-1">Access Denied</h1>
     <p className="text-sm text-gray-500">You are not authorised to view this page.</p>
    </div>
   </div>
  );
 }

 return (
  <div className="min-h-screen bg-gray-50">
   {/* Header */}
   <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
    <div className="flex items-center gap-3">
     <button
      onClick={() => router.push('/')}
      className="text-gray-400 hover:text-gray-700 text-sm flex items-center gap-1"
     >
      <svg
       width="16"
       height="16"
       viewBox="0 0 16 16"
       fill="none"
       xmlns="http://www.w3.org/2000/svg"
      >
       <path
        d="M10 12L6 8L10 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
       />
      </svg>
      Back
     </button>
     <span className="text-gray-300">|</span>
     <h1 className="text-base font-semibold text-gray-900">Super Admin</h1>
    </div>
    <span className="text-xs text-gray-400">{session?.user?.email}</span>
   </div>

   <div className="max-w-6xl mx-auto px-6 py-8">
    {/* Stats */}
    <div className="grid grid-cols-2 gap-4 mb-8 sm:grid-cols-4">
     <StatCard
      label="Total users"
      value={stats.totalUsers}
     />
     <StatCard
      label="Total workspaces"
      value={stats.totalWorkspaces}
     />
     <StatCard
      label="Password accounts"
      value={stats.credentialUsers}
     />
     <StatCard
      label="OAuth accounts"
      value={stats.oauthUsers}
     />
    </div>

    {/* Toolbar */}
    <div className="flex items-center gap-3 mb-4">
     <input
      type="text"
      placeholder="Search by name or email…"
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      className="flex-1 max-w-sm px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
     />
     <button
      onClick={() => void fetchUsers()}
      className="px-3 py-2 text-sm rounded-lg border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
     >
      Refresh
     </button>
     <span className="text-xs text-gray-400 ml-auto">
      {filtered.length} of {users.length} users
     </span>
    </div>

    {/* Table */}
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
     {loading ? (
      <div className="py-16 text-center text-sm text-gray-400">Loading users…</div>
     ) : error ? (
      <div className="py-16 text-center text-sm text-red-500">{error}</div>
     ) : filtered.length === 0 ? (
      <div className="py-16 text-center text-sm text-gray-400">No users found.</div>
     ) : (
      <table className="w-full text-sm">
       <thead>
        <tr className="bg-gray-50 border-b border-gray-200">
         <th className="text-left px-4 py-3 font-medium text-gray-500">User</th>
         <th className="text-left px-4 py-3 font-medium text-gray-500 hidden md:table-cell">Auth</th>
         <th className="text-left px-4 py-3 font-medium text-gray-500 hidden sm:table-cell">Joined</th>
         <th className="text-center px-4 py-3 font-medium text-gray-500">Workspaces</th>
         <th className="px-4 py-3" />
        </tr>
       </thead>
       <tbody className="divide-y divide-gray-100">
        {filtered.map((user) => (
         <React.Fragment key={user.id}>
          <tr className="hover:bg-gray-50 transition-colors">
           <td className="px-4 py-3">
            <div className="flex items-center gap-3">
             <Avatar user={user} />
             <div>
              <div className="font-medium text-gray-900">{user.name}</div>
              <div className="text-xs text-gray-400">{user.email}</div>
             </div>
            </div>
           </td>
           <td className="px-4 py-3 hidden md:table-cell">
            <span
             className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
              user.authProvider === 'oauth' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'
             }`}
            >
             {user.authProvider === 'oauth' ? 'Google' : 'Password'}
            </span>
           </td>
           <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">{formatDate(user.createdAt)}</td>
           <td className="px-4 py-3 text-center">
            {user.workspaceCount > 0 ? (
             <button
              onClick={() => setExpandedUser((prev) => (prev === user.id ? null : user.id))}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
             >
              {user.workspaceCount}
              <svg
               width="10"
               height="10"
               viewBox="0 0 10 10"
               fill="none"
               xmlns="http://www.w3.org/2000/svg"
               className={`transition-transform ${expandedUser === user.id ? 'rotate-180' : ''}`}
              >
               <path
                d="M2 3.5L5 6.5L8 3.5"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
               />
              </svg>
             </button>
            ) : (
             <span className="text-gray-300">—</span>
            )}
           </td>
           <td className="px-4 py-3 text-right">
            <button
             onClick={() => setPendingDelete(user)}
             className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
            >
             Delete
            </button>
           </td>
          </tr>
          {expandedUser === user.id && (
           <tr
            key={`${user.id}-workspaces`}
            className="bg-indigo-50/40"
           >
            <td
             colSpan={5}
             className="px-4 py-3"
            >
             <div className="pl-11 flex flex-wrap gap-2">
              {user.workspaces.map((ws) => (
               <div
                key={ws.id}
                className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs"
               >
                <span className="text-gray-700 font-medium">{ws.name}</span>
                <span className="text-gray-400">/</span>
                <span className="text-gray-400">{ws.slug}</span>
                <span className={`ml-1 px-1.5 py-0.5 rounded-full text-xs ${ws.isOwner ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>{ws.role}</span>
               </div>
              ))}
             </div>
            </td>
           </tr>
          )}
         </React.Fragment>
        ))}
       </tbody>
      </table>
     )}
    </div>
   </div>

   {pendingDelete && (
    <DeleteDialog
     user={pendingDelete}
     onCancel={() => setPendingDelete(null)}
     onConfirm={() => void handleDelete()}
     isDeleting={isDeleting}
    />
   )}
  </div>
 );
}
