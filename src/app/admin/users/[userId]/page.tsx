'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useParams, useRouter } from 'next/navigation';

type WorkspaceStats = {
 organizationCount: number;
 clientCount: number;
 accountCount: number;
 transactionCount: number;
 adjustmentCount: number;
 lastTransactionAt: string | null;
};

type Workspace = {
 id: string;
 name: string;
 slug: string;
 role: string;
 isOwner: boolean;
 createdAt: string;
 stats: WorkspaceStats;
};

type UserDetail = {
 id: string;
 email: string;
 name: string;
 image: string | null;
 authProvider: 'credentials' | 'oauth';
 createdAt: string;
 status: 'pending' | 'approved' | 'rejected';
 subscriptionStartedAt: string | null;
 subscriptionEndsAt: string | null;
};

type DetailResponse = {
 user: UserDetail;
 workspaces: Workspace[];
 totals: WorkspaceStats;
};

function formatDate(iso: string | null) {
 if (!iso) return '—';
 return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(iso: string | null) {
 if (!iso) return 'Never';
 return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getSubscriptionState(endsAt: string | null) {
 if (!endsAt) return { label: 'No subscription', tone: 'none' as const };
 const daysLeft = Math.ceil((new Date(endsAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
 if (daysLeft <= 0) return { label: 'Expired', tone: 'expired' as const };
 if (daysLeft <= 7) return { label: `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`, tone: 'soon' as const };
 return { label: `${daysLeft} days left`, tone: 'active' as const };
}

function getInitials(name: string) {
 return name
  .split(' ')
  .map((w) => w[0])
  .join('')
  .toUpperCase()
  .slice(0, 2);
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

function StatCard({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
 return (
  <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-1">
   <span className="text-2xl font-bold text-gray-900">{value}</span>
   <span className="text-sm font-medium text-gray-700">{label}</span>
   {sub && <span className="text-xs text-gray-400">{sub}</span>}
  </div>
 );
}

export default function AdminUserDetailPage() {
 const { status: sessionStatus } = useSession();
 const router = useRouter();
 const params = useParams<{ userId: string }>();
 const userId = params?.userId || '';

 const [data, setData] = useState<DetailResponse | null>(null);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);

 useEffect(() => {
  if (sessionStatus === 'unauthenticated') {
   router.replace('/login');
  }
 }, [sessionStatus, router]);

 const loadUser = useCallback(async () => {
  setLoading(true);
  setError(null);
  try {
   const res = await fetch(`/api/admin/users/${userId}`);
   if (res.status === 403) {
    setError('forbidden');
    return;
   }
   if (res.status === 404) {
    setError('not_found');
    return;
   }
   if (!res.ok) throw new Error('Failed to load user.');
   setData((await res.json()) as DetailResponse);
  } catch {
   setError('Failed to load user.');
  } finally {
   setLoading(false);
  }
 }, [userId]);

 useEffect(() => {
  if (sessionStatus !== 'authenticated' || !userId) return;
  void loadUser();
 }, [sessionStatus, userId, loadUser]);

 if (sessionStatus === 'loading' || loading) {
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

 if (error === 'not_found' || !data) {
  return (
   <div className="min-h-screen flex items-center justify-center bg-gray-50">
    <div className="text-center">
     <p className="text-4xl mb-2">🔍</p>
     <h1 className="text-xl font-semibold text-gray-800 mb-1">User not found</h1>
     <button
      onClick={() => router.push('/admin')}
      className="mt-3 text-sm text-indigo-600 hover:underline"
     >
      Back to admin panel
     </button>
    </div>
   </div>
  );
 }

 const { user, workspaces, totals } = data;
 const sub = getSubscriptionState(user.subscriptionEndsAt);
 const subTone =
  sub.tone === 'expired' ? 'bg-red-50 text-red-700' : sub.tone === 'soon' ? 'bg-amber-50 text-amber-800' : sub.tone === 'active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500';

 return (
  <div dir="ltr" className="min-h-screen bg-gray-50">
   <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-3">
    <button
     onClick={() => router.push('/admin')}
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
    <h1 className="text-base font-semibold text-gray-900">User details</h1>
   </div>

   <div className="max-w-5xl mx-auto px-6 py-8">
    {/* Profile card */}
    <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6 flex items-center gap-4">
     {user.image ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
       src={user.image}
       alt={user.name}
       className="w-14 h-14 rounded-full object-cover"
      />
     ) : (
      <div className="w-14 h-14 rounded-full bg-indigo-600 flex items-center justify-center text-white text-lg font-semibold shrink-0">{getInitials(user.name)}</div>
     )}
     <div className="flex-1">
      <div className="flex items-center gap-2">
       <h2 className="text-lg font-semibold text-gray-900">{user.name}</h2>
       <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
         user.authProvider === 'oauth' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'
        }`}
       >
        {user.authProvider === 'oauth' ? 'Google' : 'Password'}
       </span>
       <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${subTone}`}>{sub.label}</span>
      </div>
      <p className="text-sm text-gray-400">{user.email}</p>
      <p className="text-xs text-gray-400 mt-1">
       Joined {formatDate(user.createdAt)}
       {user.subscriptionStartedAt ? ` · Subscription started ${formatDate(user.subscriptionStartedAt)}` : ''}
       {user.subscriptionEndsAt ? ` · Ends ${formatDate(user.subscriptionEndsAt)}` : ''}
      </p>
     </div>
    </div>

    {/* Usage stats — the growth signal: how much this account is actually being used */}
    <h3 className="text-sm font-semibold text-gray-700 mb-3">Usage across all workspaces</h3>
    <div className="grid grid-cols-2 gap-4 mb-8 sm:grid-cols-3 lg:grid-cols-6">
     <StatCard
      label="Workspaces"
      value={workspaces.length}
     />
     <StatCard
      label="Organizations"
      value={totals.organizationCount}
     />
     <StatCard
      label="Clients"
      value={totals.clientCount}
     />
     <StatCard
      label="Accounts"
      value={totals.accountCount}
     />
     <StatCard
      label="Transactions"
      value={totals.transactionCount}
      sub={`${totals.adjustmentCount} expense${totals.adjustmentCount === 1 ? '' : 's'}`}
     />
     <StatCard
      label="Last activity"
      value={totals.lastTransactionAt ? formatDate(totals.lastTransactionAt) : '—'}
      sub={totals.lastTransactionAt ? formatDateTime(totals.lastTransactionAt) : 'No transactions yet'}
     />
    </div>

    {/* Per-workspace breakdown */}
    <h3 className="text-sm font-semibold text-gray-700 mb-3">Workspaces</h3>
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
     {workspaces.length === 0 ? (
      <div className="py-16 text-center text-sm text-gray-400">No workspaces.</div>
     ) : (
      <table className="w-full text-sm">
       <thead>
        <tr className="bg-gray-50 border-b border-gray-200">
         <th className="text-left px-4 py-3 font-medium text-gray-500">Workspace</th>
         <th className="text-center px-4 py-3 font-medium text-gray-500">Orgs</th>
         <th className="text-center px-4 py-3 font-medium text-gray-500">Clients</th>
         <th className="text-center px-4 py-3 font-medium text-gray-500">Accounts</th>
         <th className="text-center px-4 py-3 font-medium text-gray-500">Transactions</th>
         <th className="text-left px-4 py-3 font-medium text-gray-500 hidden sm:table-cell">Last activity</th>
        </tr>
       </thead>
       <tbody className="divide-y divide-gray-100">
        {workspaces.map((ws) => (
         <tr
          key={ws.id}
          className="hover:bg-gray-50"
         >
          <td className="px-4 py-3">
           <div className="font-medium text-gray-900 flex items-center gap-1.5">
            {ws.name}
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${ws.isOwner ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
             {teamRoleLabel(ws.role)}
            </span>
           </div>
           <div className="text-xs text-gray-400">/{ws.slug}</div>
          </td>
          <td className="px-4 py-3 text-center text-gray-700">{ws.stats.organizationCount}</td>
          <td className="px-4 py-3 text-center text-gray-700">{ws.stats.clientCount}</td>
          <td className="px-4 py-3 text-center text-gray-700">{ws.stats.accountCount}</td>
          <td className="px-4 py-3 text-center text-gray-700">{ws.stats.transactionCount}</td>
          <td className="px-4 py-3 text-gray-500 hidden sm:table-cell whitespace-nowrap">{formatDateTime(ws.stats.lastTransactionAt)}</td>
         </tr>
        ))}
       </tbody>
      </table>
     )}
    </div>
   </div>
  </div>
 );
}
