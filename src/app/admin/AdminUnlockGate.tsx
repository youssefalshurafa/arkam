'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

// Password prompt shown by the /admin layout when the signed-in super-admin hasn't
// unlocked the panel yet (see permissions.ts: isAdminPanelUnlocked). Submitting sets an
// httpOnly cookie server-side, then router.refresh() re-runs the server layout, which
// now sees the cookie and renders the real page — the admin content never mounts until
// this succeeds.
export default function AdminUnlockGate() {
 const router = useRouter();
 const [password, setPassword] = useState('');
 const [error, setError] = useState<string | null>(null);
 const [isSubmitting, setIsSubmitting] = useState(false);

 // Render the form only after mount. The gate is entirely client-driven, so SSR of it
 // adds no value, and skipping it avoids hydration mismatches caused by password-manager
 // extensions that mutate the password field/form before React hydrates.
 const [mounted, setMounted] = useState(false);
 useEffect(() => setMounted(true), []);

 const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setError(null);
  setIsSubmitting(true);
  try {
   const res = await fetch('/api/admin/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
   });
   if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setError(data.error || 'Incorrect password.');
    return;
   }
   setPassword('');
   router.refresh();
  } catch {
   setError('Network error. Please try again.');
  } finally {
   setIsSubmitting(false);
  }
 };

 if (!mounted) {
  return <div dir="ltr" className="min-h-screen bg-gray-50" />;
 }

 return (
  <div dir="ltr" className="min-h-screen flex items-center justify-center bg-gray-50">
   <form onSubmit={handleSubmit} className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-gray-200 p-6">
    <h1 className="text-lg font-semibold text-gray-900 mb-1">Admin panel locked</h1>
    <p className="text-sm text-gray-500 mb-4">Enter the admin panel password to continue.</p>
    <input
     type="password"
     autoFocus
     value={password}
     onChange={(e) => setPassword(e.target.value)}
     placeholder="Panel password"
     className="w-full mb-3 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
    />
    {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
    <button
     type="submit"
     disabled={isSubmitting || !password}
     className="w-full px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-60"
    >
     {isSubmitting ? 'Checking…' : 'Unlock'}
    </button>
   </form>
  </div>
 );
}
