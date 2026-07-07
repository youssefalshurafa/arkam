'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { confirmDialog, alertDialog, promptDialog } from '@/components/ui/AppDialog';

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

type AccessRequest = {
 id: string;
 userId: string;
 email: string;
 name: string;
 plan: string;
 amount: string;
 network: string;
 txReference: string;
 proofMime: string;
 hasProof: boolean;
 status: 'pending' | 'approved' | 'rejected';
 note: string;
 createdAt: string;
 reviewedAt: string | null;
 userStatus: 'pending' | 'approved' | 'rejected';
 phone: string;
 company: string;
 country: string;
 subscriptionStartedAt: string | null;
 subscriptionEndsAt: string | null;
};

function formatDateTime(iso: string) {
 return new Date(iso).toLocaleString('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
 });
}

// Computes a subscription state from the end date: how many whole days remain,
// whether it has lapsed, and whether it's expiring soon (≤7 days).
function getSubscriptionState(endsAt: string | null) {
 if (!endsAt) return { label: 'No subscription', tone: 'none' as const, daysLeft: null as number | null };
 const end = new Date(endsAt).getTime();
 const now = Date.now();
 const daysLeft = Math.ceil((end - now) / (24 * 60 * 60 * 1000));
 if (daysLeft <= 0) return { label: 'Expired', tone: 'expired' as const, daysLeft };
 if (daysLeft <= 7) return { label: `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`, tone: 'soon' as const, daysLeft };
 return { label: `${daysLeft} days left`, tone: 'active' as const, daysLeft };
}

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

function teamRoleLabel(role: string) {
 switch (role) {
  case 'owner':
   return 'Owner';
  case 'admin':
   return 'Admin';
  case 'member':
   return 'Editor';
  case 'viewer':
   return 'Reviewer';
  default:
   return role;
 }
}

function UserRow({
 user,
 nested,
 roleInTeam,
 expandedUser,
 setExpandedUser,
 setPendingDelete,
}: {
 user: AdminUser;
 nested: boolean;
 roleInTeam?: string;
 expandedUser: string | null;
 setExpandedUser: React.Dispatch<React.SetStateAction<string | null>>;
 setPendingDelete: (user: AdminUser) => void;
}) {
 const router = useRouter();
 return (
  <React.Fragment key={user.id}>
   <tr
    onClick={() => router.push(`/admin/users/${user.id}`)}
    className={`cursor-pointer hover:bg-gray-50 transition-colors ${nested ? 'bg-gray-50/50' : ''}`}
   >
    <td className="px-4 py-3">
     <div className={`flex items-center gap-3 ${nested ? 'pl-8' : ''}`}>
      {nested && <span className="text-gray-300">↳</span>}
      <Avatar user={user} />
      <div>
       <div className="font-medium text-gray-900 flex items-center gap-1.5">
        {user.name}
        {roleInTeam && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-500">{teamRoleLabel(roleInTeam)}</span>}
       </div>
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
       onClick={(e) => {
        e.stopPropagation();
        setExpandedUser((prev) => (prev === user.id ? null : user.id));
       }}
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
      onClick={(e) => {
       e.stopPropagation();
       setPendingDelete(user);
      }}
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
 );
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

type AddUserModalProps = {
 onCancel: () => void;
 onCreated: () => void;
};

function AddUserModal({ onCancel, onCreated }: AddUserModalProps) {
 const [name, setName] = useState('');
 const [email, setEmail] = useState('');
 const [durationDays, setDurationDays] = useState('30');
 const [isSubmitting, setIsSubmitting] = useState(false);
 const [error, setError] = useState<string | null>(null);

 const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setError(null);

  const trimmedEmail = email.trim();
  if (!trimmedEmail) {
   setError('Email or username is required.');
   return;
  }
  const days = Number(durationDays);
  if (!Number.isFinite(days) || days <= 0) {
   setError('Enter a positive number of days.');
   return;
  }

  setIsSubmitting(true);
  try {
   const res = await fetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim(), email: trimmedEmail, durationDays: days }),
   });
   const data = (await res.json()) as { error?: string };
   if (!res.ok) {
    setError(data.error || 'Failed to create user.');
    return;
   }
   await alertDialog({
    title: 'User created',
    message: `Share "${trimmedEmail}" with them — no email was sent. They can set their own password from the sign-in page's "Set your password" link.`,
   });
   onCreated();
  } catch {
   setError('Network error. Please try again.');
  } finally {
   setIsSubmitting(false);
  }
 };

 return (
  <div className="fixed inset-0 z-50 flex items-center justify-center">
   <div
    className="absolute inset-0 bg-black/40"
    onClick={onCancel}
   />
   <form
    onSubmit={handleSubmit}
    className="relative bg-white rounded-2xl shadow-xl p-6 w-full max-w-md mx-4"
   >
    <h2 className="text-lg font-semibold text-gray-900 mb-1">Add user</h2>
    <p className="text-sm text-gray-500 mb-4">
     No email is sent. Give them the email/username you enter here — they set their own password from the sign-in page&apos;s &quot;Set your password&quot; link. No
     payment approval needed.
    </p>

    <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
    <input
     type="text"
     value={name}
     onChange={(e) => setName(e.target.value)}
     placeholder="Full name (optional)"
     className="w-full mb-3 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
    />

    <label className="block text-xs font-medium text-gray-600 mb-1">Email or username</label>
    <input
     type="text"
     required
     autoFocus
     value={email}
     onChange={(e) => setEmail(e.target.value)}
     placeholder="user@example.com or a username"
     className="w-full mb-3 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
    />

    <label className="block text-xs font-medium text-gray-600 mb-1">Subscription duration (days)</label>
    <input
     type="number"
     min={1}
     value={durationDays}
     onChange={(e) => setDurationDays(e.target.value)}
     className="w-full mb-2 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
    />
    <div className="flex gap-2 mb-4">
     {[30, 90, 365].map((d) => (
      <button
       key={d}
       type="button"
       onClick={() => setDurationDays(String(d))}
       className="text-xs px-2 py-1 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50"
      >
       {d}d
      </button>
     ))}
    </div>

    {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

    <div className="flex justify-end gap-3">
     <button
      type="button"
      onClick={onCancel}
      disabled={isSubmitting}
      className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
     >
      Cancel
     </button>
     <button
      type="submit"
      disabled={isSubmitting}
      className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-60"
     >
      {isSubmitting ? 'Creating…' : 'Create user'}
     </button>
    </div>
   </form>
  </div>
 );
}

function StatusBadge({ status }: { status: AccessRequest['status'] }) {
 const styles =
  status === 'approved'
   ? 'bg-green-50 text-green-700'
   : status === 'rejected'
    ? 'bg-red-50 text-red-700'
    : 'bg-amber-50 text-amber-700';
 return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${styles}`}>{status}</span>;
}

type AccessRequestsPanelProps = {
 requests: AccessRequest[];
 loading: boolean;
 reviewingId: string | null;
 onRefresh: () => void;
 onReview: (request: AccessRequest, action: 'approve' | 'reject' | 'renew' | 'setDays') => void;
};

function AccessRequestsPanel({ requests, loading, reviewingId, onRefresh, onReview }: AccessRequestsPanelProps) {
 const pending = requests.filter((r) => r.status === 'pending');
 const expired = requests.filter((r) => {
  const s = getSubscriptionState(r.subscriptionEndsAt);
  return r.status === 'approved' && s.tone === 'expired';
 });
 const expiringSoon = requests.filter((r) => {
  const s = getSubscriptionState(r.subscriptionEndsAt);
  return r.status === 'approved' && s.tone === 'soon';
 });

 return (
  <>
   {(expired.length > 0 || expiringSoon.length > 0) && (
    <div className="mb-4 flex flex-wrap gap-3">
     {expired.length > 0 && (
      <div className="flex-1 min-w-48 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
       <span className="font-semibold">{expired.length}</span> subscription{expired.length === 1 ? '' : 's'} expired — needs renewal.
      </div>
     )}
     {expiringSoon.length > 0 && (
      <div className="flex-1 min-w-48 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
       <span className="font-semibold">{expiringSoon.length}</span> subscription{expiringSoon.length === 1 ? '' : 's'} expiring within 7 days.
      </div>
     )}
    </div>
   )}

   <div className="flex items-center gap-3 mb-4">
    <h2 className="text-sm font-semibold text-gray-700">Payment approval requests</h2>
    <button
     onClick={onRefresh}
     className="px-3 py-2 text-sm rounded-lg border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
    >
     Refresh
    </button>
    <span className="text-xs text-gray-400 ml-auto">{pending.length} pending</span>
   </div>

   <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
    {loading ? (
     <div className="py-16 text-center text-sm text-gray-400">Loading requests…</div>
    ) : requests.length === 0 ? (
     <div className="py-16 text-center text-sm text-gray-400">No access requests yet.</div>
    ) : (
     <table className="w-full text-sm">
      <thead>
       <tr className="bg-gray-50 border-b border-gray-200">
        <th className="text-left px-4 py-3 font-medium text-gray-500">User</th>
        <th className="text-left px-4 py-3 font-medium text-gray-500 hidden sm:table-cell">Plan / Amount</th>
        <th className="text-left px-4 py-3 font-medium text-gray-500 hidden md:table-cell">Paid</th>
        <th className="text-left px-4 py-3 font-medium text-gray-500">Subscription</th>
        <th className="text-left px-4 py-3 font-medium text-gray-500">Proof</th>
        <th className="text-center px-4 py-3 font-medium text-gray-500">Status</th>
        <th className="px-4 py-3" />
       </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
       {requests.map((request) => {
        const sub = getSubscriptionState(request.subscriptionEndsAt);
        const subTone =
         sub.tone === 'expired'
          ? 'bg-red-50 text-red-700'
          : sub.tone === 'soon'
           ? 'bg-amber-50 text-amber-800'
           : sub.tone === 'active'
            ? 'bg-green-50 text-green-700'
            : 'bg-gray-100 text-gray-500';
        return (
        <tr key={request.id} className={`transition-colors align-top ${sub.tone === 'expired' ? 'bg-red-50/40 hover:bg-red-50' : 'hover:bg-gray-50'}`}>
         <td className="px-4 py-3">
          <div className="font-medium text-gray-900">{request.name}</div>
          <div className="text-xs text-gray-400">{request.email}</div>
          {request.company && <div className="mt-1 text-xs text-gray-600">{request.company}</div>}
          {(request.phone || request.country) && (
           <div className="text-xs text-gray-400">{[request.phone, request.country].filter(Boolean).join(' · ')}</div>
          )}
          {request.txReference && <div className="mt-1 text-xs text-gray-400 break-all">tx: {request.txReference}</div>}
         </td>
         <td className="px-4 py-3 hidden sm:table-cell">
          {request.plan && <div className="text-gray-900 font-medium">{request.plan}</div>}
          <div className="text-gray-700">{request.amount || '—'}</div>
          <div className="text-xs text-gray-400">{request.network}</div>
         </td>
         <td className="px-4 py-3 text-gray-500 hidden md:table-cell whitespace-nowrap">{formatDate(request.createdAt)}</td>
         <td className="px-4 py-3">
          {request.subscriptionEndsAt ? (
           <>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${subTone}`}>{sub.label}</span>
            <div className="mt-1 text-xs text-gray-400 whitespace-nowrap">Ends {formatDateTime(request.subscriptionEndsAt)}</div>
            {request.subscriptionStartedAt && (
             <div className="text-xs text-gray-400 whitespace-nowrap">Started {formatDate(request.subscriptionStartedAt)}</div>
            )}
           </>
          ) : (
           <span className="text-gray-300">—</span>
          )}
         </td>
         <td className="px-4 py-3">
          {request.hasProof ? (
           <a
            href={`/api/admin/access-requests/${request.id}/proof`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-indigo-600 hover:underline"
           >
            View screenshot
           </a>
          ) : (
           <span className="text-gray-300">—</span>
          )}
         </td>
         <td className="px-4 py-3 text-center">
          <StatusBadge status={request.status} />
          {request.status === 'rejected' && request.note && <div className="mt-1 text-xs text-gray-400">{request.note}</div>}
         </td>
         <td className="px-4 py-3 text-right whitespace-nowrap">
          {request.status === 'pending' ? (
           <div className="inline-flex gap-2">
            <button
             onClick={() => onReview(request, 'approve')}
             disabled={reviewingId === request.id}
             className="text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-50"
            >
             Approve
            </button>
            <button
             onClick={() => onReview(request, 'reject')}
             disabled={reviewingId === request.id}
             className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
             Reject
            </button>
           </div>
          ) : request.status === 'approved' ? (
           <div className="inline-flex gap-2">
            <button
             onClick={() => onReview(request, 'renew')}
             disabled={reviewingId === request.id}
             className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50"
            >
             {sub.tone === 'expired' ? 'Renew' : 'Extend'}
            </button>
            <button
             onClick={() => onReview(request, 'setDays')}
             disabled={reviewingId === request.id}
             title="Manually set the exact number of days remaining"
             className="text-xs px-3 py-1.5 rounded-lg border border-indigo-200 text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
            >
             Set days
            </button>
            <button
             onClick={() => onReview(request, 'reject')}
             disabled={reviewingId === request.id}
             className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
             Deactivate
            </button>
           </div>
          ) : (
           <div className="inline-flex gap-2">
            <button
             onClick={() => onReview(request, 'renew')}
             disabled={reviewingId === request.id}
             className="text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-50"
            >
             Reactivate
            </button>
            <button
             onClick={() => onReview(request, 'setDays')}
             disabled={reviewingId === request.id}
             title="Manually set the exact number of days remaining"
             className="text-xs px-3 py-1.5 rounded-lg border border-indigo-200 text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
            >
             Set days
            </button>
           </div>
          )}
         </td>
        </tr>
        );
       })}
      </tbody>
     </table>
    )}
   </div>
  </>
 );
}

export default function AdminPage() {
 const { data: session, status } = useSession();
 const router = useRouter();

 const [tab, setTab] = useState<'users' | 'requests'>('requests');
 const [users, setUsers] = useState<AdminUser[]>([]);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);
 const [search, setSearch] = useState('');
 const [pendingDelete, setPendingDelete] = useState<AdminUser | null>(null);
 const [isDeleting, setIsDeleting] = useState(false);
 const [expandedUser, setExpandedUser] = useState<string | null>(null);
 const [showAddUser, setShowAddUser] = useState(false);

 const [requests, setRequests] = useState<AccessRequest[]>([]);
 const [requestsLoading, setRequestsLoading] = useState(true);
 const [reviewingId, setReviewingId] = useState<string | null>(null);

 const fetchRequests = useCallback(async () => {
  setRequestsLoading(true);
  try {
   const res = await fetch('/api/admin/access-requests');
   if (res.status === 403) {
    setError('forbidden');
    return;
   }
   if (!res.ok) throw new Error('Failed to load requests.');
   const data = (await res.json()) as { requests: AccessRequest[] };
   setRequests(data.requests);
  } catch {
   // surfaced via the empty state
  } finally {
   setRequestsLoading(false);
  }
 }, []);

 const reviewRequest = async (request: AccessRequest, action: 'approve' | 'reject' | 'renew' | 'setDays') => {
  let note = '';
  let days: number | undefined;
  if (action === 'reject') {
   const reason = await promptDialog({
    title: 'Reject access request',
    message: 'Reason for rejection (optional, shown to the user):',
   });
   if (reason === null) return;
   note = reason;
  } else if (action === 'approve') {
   if (!(await confirmDialog({ message: `Approve access for ${request.name} (${request.email})?` }))) return;
  } else if (action === 'renew') {
   if (!(await confirmDialog({ message: `Renew subscription for ${request.name} by one period?` }))) return;
  } else if (action === 'setDays') {
   const currentDaysLeft = getSubscriptionState(request.subscriptionEndsAt).daysLeft;
   const input = await promptDialog({
    title: 'Set remaining subscription days',
    message: `Set the exact number of days remaining for ${request.name} (${request.email}). This replaces the current expiry date.`,
    defaultValue: currentDaysLeft != null && currentDaysLeft > 0 ? String(currentDaysLeft) : '30',
    placeholder: 'Days remaining',
   });
   if (input === null) return;
   const parsed = Number(input.trim());
   if (!Number.isFinite(parsed) || parsed < 0) {
    await alertDialog({ title: 'Error', message: 'Enter a non-negative number of days.' });
    return;
   }
   days = parsed;
  }

  setReviewingId(request.id);
  try {
   const res = await fetch('/api/admin/access-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: request.id, userId: request.userId, action, note, days }),
   });
   const data = (await res.json()) as { ok?: boolean; status?: string; subscriptionEndsAt?: string; error?: string };
   if (!res.ok || !data.ok) {
    await alertDialog({ title: 'Error', message: data.error || 'Failed to update request.' });
    return;
   }
   setRequests((prev) =>
    prev.map((r) =>
     r.id === request.id
      ? {
         ...r,
         status: (data.status as AccessRequest['status']) || r.status,
         subscriptionEndsAt: data.subscriptionEndsAt ?? r.subscriptionEndsAt,
        }
      : r,
    ),
   );
   // Re-sync subscription dates set server-side on approve/renew.
   void fetchRequests();
  } catch {
   await alertDialog({ title: 'Error', message: 'Network error. Please try again.' });
  } finally {
   setReviewingId(null);
  }
 };

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
   void fetchRequests();
  }
 }, [status, fetchUsers, fetchRequests]);

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
    await alertDialog({ title: 'Error', message: data.error || 'Failed to delete user.' });
    return;
   }
   setUsers((prev) => prev.filter((u) => u.id !== pendingDelete.id));
   setPendingDelete(null);
  } catch {
   await alertDialog({ title: 'Error', message: 'Network error. Please try again.' });
  } finally {
   setIsDeleting(false);
  }
 };

 // Group users so teammates who don't own any workspace of their own are nested
 // under the owner of the workspace they belong to, instead of appearing as
 // separate top-level rows.
 const workspaceOwnerId = new Map<string, string>();
 for (const u of users) {
  for (const ws of u.workspaces) {
   if (ws.isOwner) workspaceOwnerId.set(ws.id, u.id);
  }
 }

 const childrenByParentId = new Map<string, Array<{ user: AdminUser; role: string }>>();
 const nestedChildIds = new Set<string>();
 for (const u of users) {
  const ownsAny = u.workspaces.some((ws) => ws.isOwner);
  if (ownsAny) continue;
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
 // Within each owner's group, list teammates by role hierarchy (admin above
 // member above viewer) rather than in arbitrary join order.
 const ROLE_RANK: Record<string, number> = { owner: 0, admin: 1, member: 2, viewer: 3 };
 for (const children of childrenByParentId.values()) {
  children.sort((a, b) => (ROLE_RANK[a.role] ?? 99) - (ROLE_RANK[b.role] ?? 99));
 }

 const searchLower = search.toLowerCase();
 const matchesSearch = (u: AdminUser) => u.name.toLowerCase().includes(searchLower) || u.email.toLowerCase().includes(searchLower);

 const userGroups = users
  .filter((u) => !nestedChildIds.has(u.id))
  .map((user) => {
   const children = childrenByParentId.get(user.id) ?? [];
   const parentMatches = !search || matchesSearch(user);
   const visibleChildren = parentMatches ? children : children.filter((c) => matchesSearch(c.user));
   return { user, children: visibleChildren, include: parentMatches || children.some((c) => matchesSearch(c.user)) };
  })
  .filter((g) => g.include);

 const visibleUserCount = userGroups.reduce((sum, g) => sum + 1 + g.children.length, 0);

 const stats: Stats = {
  totalUsers: users.length,
  totalWorkspaces: users.reduce((s, u) => s + u.workspaceCount, 0),
  credentialUsers: users.filter((u) => u.authProvider === 'credentials').length,
  oauthUsers: users.filter((u) => u.authProvider === 'oauth').length,
 };

 if (status === 'loading') {
  return (
   <div dir="ltr" className="min-h-screen flex items-center justify-center bg-gray-50">
    <div className="text-gray-400 text-sm">Loading…</div>
   </div>
  );
 }

 if (error === 'forbidden') {
  return (
   <div dir="ltr" className="min-h-screen flex items-center justify-center bg-gray-50">
    <div className="text-center">
     <p className="text-4xl mb-2">🚫</p>
     <h1 className="text-xl font-semibold text-gray-800 mb-1">Access Denied</h1>
     <p className="text-sm text-gray-500">You are not authorised to view this page.</p>
    </div>
   </div>
  );
 }

 return (
  // This is an internal admin tool, not localized — force LTR regardless of the signed-in
  // admin's app language preference (document.documentElement.dir is set globally by
  // LanguageContext, and would otherwise mirror this page's hardcoded-LTR table/layout
  // classes, misaligning headers against body columns when the active language is Arabic).
  <div dir="ltr" className="min-h-screen bg-gray-50">
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
    {/* Tab strip */}
    <div className="mb-6 flex gap-1 border-b border-gray-200">
     {([
      { key: 'requests' as const, label: 'Access Requests' },
      { key: 'users' as const, label: 'Users' },
     ]).map((item) => {
      const pendingCount = item.key === 'requests' ? requests.filter((r) => r.status === 'pending').length : 0;
      return (
       <button
        key={item.key}
        onClick={() => setTab(item.key)}
        className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition ${
         tab === item.key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-700'
        }`}
       >
        {item.label}
        {pendingCount > 0 && (
         <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">{pendingCount}</span>
        )}
       </button>
      );
     })}
    </div>

    {tab === 'requests' && (
     <AccessRequestsPanel
      requests={requests}
      loading={requestsLoading}
      reviewingId={reviewingId}
      onRefresh={() => void fetchRequests()}
      onReview={(req, action) => void reviewRequest(req, action)}
     />
    )}

    {tab === 'users' && (
     <>
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
     <button
      onClick={() => setShowAddUser(true)}
      className="px-3 py-2 text-sm rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700"
     >
      + Add user
     </button>
     <span className="text-xs text-gray-400 ml-auto">
      {visibleUserCount} of {users.length} users
     </span>
    </div>

    {/* Table */}
    <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
     {loading ? (
      <div className="py-16 text-center text-sm text-gray-400">Loading users…</div>
     ) : error ? (
      <div className="py-16 text-center text-sm text-red-500">{error}</div>
     ) : userGroups.length === 0 ? (
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
        {userGroups.map(({ user, children }) => (
         <React.Fragment key={user.id}>
          <UserRow
           user={user}
           nested={false}
           expandedUser={expandedUser}
           setExpandedUser={setExpandedUser}
           setPendingDelete={setPendingDelete}
          />
          {children.map(({ user: child, role }) => (
           <UserRow
            key={child.id}
            user={child}
            nested
            roleInTeam={role}
            expandedUser={expandedUser}
            setExpandedUser={setExpandedUser}
            setPendingDelete={setPendingDelete}
           />
          ))}
         </React.Fragment>
        ))}
       </tbody>
      </table>
     )}
    </div>
     </>
    )}
   </div>

   {pendingDelete && (
    <DeleteDialog
     user={pendingDelete}
     onCancel={() => setPendingDelete(null)}
     onConfirm={() => void handleDelete()}
     isDeleting={isDeleting}
    />
   )}

   {showAddUser && (
    <AddUserModal
     onCancel={() => setShowAddUser(false)}
     onCreated={() => {
      setShowAddUser(false);
      void fetchUsers();
     }}
    />
   )}
  </div>
 );
}
