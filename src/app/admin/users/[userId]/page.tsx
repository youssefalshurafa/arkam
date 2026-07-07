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

type PendingAccessRequest = {
 id: string;
 plan: string;
 amount: string;
 network: string;
 txReference: string;
 hasProof: boolean;
 createdAt: string;
};

type DetailResponse = {
 user: UserDetail;
 workspaces: Workspace[];
 totals: WorkspaceStats;
 pendingAccessRequest: PendingAccessRequest | null;
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
 if (!endsAt) return { label: 'No subscription', tone: 'none' as const, daysLeft: null as number | null };
 const daysLeft = Math.ceil((new Date(endsAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
 if (daysLeft <= 0) return { label: 'Expired', tone: 'expired' as const, daysLeft };
 if (daysLeft <= 7) return { label: `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`, tone: 'soon' as const, daysLeft };
 return { label: `${daysLeft} days left`, tone: 'active' as const, daysLeft };
}

// Mirrors the paid-plan durations in src/config/plan.ts, so an admin's manual "renew"
// grants exactly what a real monthly/6-month/annual purchase would.
const RENEW_QUICK_OPTIONS = [
 { label: '+30 days', days: 30 },
 { label: '+6 months', days: 180 },
 { label: '+1 year', days: 365 },
];

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

 // Subscription quick-edit: manual "days remaining" override, plus the +30/+6mo/+1yr
 // renew shortcuts. Both hit the same admin endpoint the main panel's per-row
 // Renew/Set days buttons use; success patches `data` locally instead of a full reload.
 const [daysInput, setDaysInput] = useState('');
 const [subMutating, setSubMutating] = useState(false);
 const [subError, setSubError] = useState('');

 useEffect(() => {
  const daysLeft = data ? getSubscriptionState(data.user.subscriptionEndsAt).daysLeft : null;
  setDaysInput(daysLeft != null && daysLeft > 0 ? String(daysLeft) : '0');
 }, [data]);

 const applySubscriptionResult = (endsAt: string) => {
  setData((prev) => (prev ? { ...prev, user: { ...prev.user, status: 'approved', subscriptionEndsAt: endsAt } } : prev));
 };

 const onSetDays = async () => {
  const parsed = Number(daysInput.trim());
  if (!Number.isFinite(parsed) || parsed < 0) {
   setSubError('Enter a non-negative number of days.');
   return;
  }
  setSubMutating(true);
  setSubError('');
  try {
   const res = await fetch('/api/admin/access-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, action: 'setDays', days: parsed }),
   });
   const result = (await res.json()) as { ok?: boolean; subscriptionEndsAt?: string; error?: string };
   if (!res.ok || !result.ok || !result.subscriptionEndsAt) {
    setSubError(result.error || 'Failed to update subscription.');
    return;
   }
   applySubscriptionResult(result.subscriptionEndsAt);
  } catch {
   setSubError('Failed to update subscription.');
  } finally {
   setSubMutating(false);
  }
 };

 const onRenew = async (durationDays: number) => {
  setSubMutating(true);
  setSubError('');
  try {
   const res = await fetch('/api/admin/access-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, action: 'renew', durationDays }),
   });
   const result = (await res.json()) as { ok?: boolean; subscriptionEndsAt?: string; error?: string };
   if (!res.ok || !result.ok || !result.subscriptionEndsAt) {
    setSubError(result.error || 'Failed to renew subscription.');
    return;
   }
   applySubscriptionResult(result.subscriptionEndsAt);
  } catch {
   setSubError('Failed to renew subscription.');
  } finally {
   setSubMutating(false);
  }
 };

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

 const { user, workspaces, totals, pendingAccessRequest } = data;
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

    {/* Pending access request — surfaced here so the admin doesn't have to
        cross-reference the separate Access Requests tab to know one exists. */}
    {pendingAccessRequest && (
     <div className="bg-amber-50 rounded-xl border border-amber-200 p-6 mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
       <div>
        <h3 className="text-sm font-semibold text-amber-900">Pending access request</h3>
        <p className="mt-1 text-sm text-amber-800">
         {pendingAccessRequest.plan ? <span className="font-medium">{pendingAccessRequest.plan}</span> : null}
         {pendingAccessRequest.amount ? ` · ${pendingAccessRequest.amount}` : ''}
         {pendingAccessRequest.network ? ` · ${pendingAccessRequest.network}` : ''}
        </p>
        <p className="mt-1 text-xs text-amber-700">
         Submitted {formatDateTime(pendingAccessRequest.createdAt)}
         {pendingAccessRequest.txReference ? ` · tx: ${pendingAccessRequest.txReference}` : ''}
        </p>
       </div>
       <div className="flex items-center gap-2">
        {pendingAccessRequest.hasProof && (
         <a
          href={`/api/admin/access-requests/${pendingAccessRequest.id}/proof`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs px-3 py-1.5 rounded-lg border border-amber-300 text-amber-800 font-medium hover:bg-amber-100"
         >
          View screenshot
         </a>
        )}
        <button
         onClick={() => router.push('/admin')}
         className="text-xs px-3 py-1.5 rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-700"
        >
         Review in Access Requests
        </button>
       </div>
      </div>
     </div>
    )}

    {/* Subscription management */}
    <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
     <h3 className="text-sm font-semibold text-gray-700 mb-4">Subscription</h3>
     {subError && <p className="mb-3 text-sm text-red-600">{subError}</p>}
     <div className="flex flex-wrap items-end gap-6">
      <div>
       <label className="block text-xs font-medium text-gray-500 mb-1">Days remaining</label>
       <div className="flex items-center gap-2">
        <input
         type="number"
         min={0}
         value={daysInput}
         onChange={(e) => setDaysInput(e.target.value)}
         disabled={subMutating}
         className="w-24 rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 disabled:opacity-50"
        />
        <button
         onClick={() => void onSetDays()}
         disabled={subMutating}
         className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
         Save
        </button>
       </div>
       <p className="mt-1 text-xs text-gray-400">Replaces the current expiry date exactly.</p>
      </div>
      <div>
       <label className="block text-xs font-medium text-gray-500 mb-1">Quick renew</label>
       <div className="flex items-center gap-2">
        {RENEW_QUICK_OPTIONS.map((opt) => (
         <button
          key={opt.days}
          onClick={() => void onRenew(opt.days)}
          disabled={subMutating}
          title={sub.tone === 'expired' || sub.tone === 'none' ? `Start a fresh ${opt.label} subscription from today` : `Add ${opt.label} on top of the current expiry date`}
          className="text-xs px-3 py-1.5 rounded-lg border border-blue-200 text-blue-700 font-medium hover:bg-blue-50 disabled:opacity-50"
         >
          {opt.label}
         </button>
        ))}
       </div>
       <p className="mt-1 text-xs text-gray-400">Adds on top of the current expiry (or starts from today if expired).</p>
      </div>
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
    <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
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
