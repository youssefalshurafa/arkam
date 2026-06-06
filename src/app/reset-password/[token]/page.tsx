'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function ResetPasswordPage() {
 const router = useRouter();
 const params = useParams<{ token: string }>();
 const token = params?.token || '';

 const [password, setPassword] = useState('');
 const [confirmPassword, setConfirmPassword] = useState('');
 const [error, setError] = useState('');
 const [success, setSuccess] = useState('');
 const [isTokenValid, setIsTokenValid] = useState(true);
 const [isValidating, setIsValidating] = useState(true);
 const [isSubmitting, setIsSubmitting] = useState(false);

 useEffect(() => {
  let isMounted = true;

  const validateToken = async () => {
   if (!token) {
    if (isMounted) {
     setIsTokenValid(false);
     setIsValidating(false);
    }
    return;
   }

   try {
    const response = await fetch(`/api/auth/reset-password?token=${encodeURIComponent(token)}`);
    const payload = (await response.json()) as { valid?: boolean };

    if (!isMounted) {
     return;
    }

    setIsTokenValid(Boolean(payload.valid));
   } catch {
    if (isMounted) {
     setIsTokenValid(false);
    }
   } finally {
    if (isMounted) {
     setIsValidating(false);
    }
   }
  };

  void validateToken();

  return () => {
   isMounted = false;
  };
 }, [token]);

 const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  setError('');
  setSuccess('');

  if (password.length < 8) {
   setError('Password must be at least 8 characters.');
   return;
  }

  if (password !== confirmPassword) {
   setError('Passwords do not match.');
   return;
  }

  setIsSubmitting(true);

  try {
   const response = await fetch('/api/auth/reset-password', {
    method: 'POST',
    headers: {
     'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token, password }),
   });

   const payload = (await response.json()) as { ok?: boolean; error?: string };

   if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Failed to reset password.');
   }

   setSuccess('Password reset successful. Redirecting to sign in...');
   router.replace('/login');
   return;
  } catch (resetError) {
   setError(resetError instanceof Error ? resetError.message : 'Failed to reset password.');
  } finally {
   setIsSubmitting(false);
  }
 };

 return (
  <main
   className="flex min-h-screen items-center justify-center p-4 text-slate-900 sm:p-6 lg:p-8"
   style={{
    background:
     'radial-gradient(circle at top, rgba(34,211,238,0.14), transparent 34%), radial-gradient(circle at bottom right, rgba(59,130,246,0.18), transparent 30%), linear-gradient(180deg, #020617 0%, #0f172a 100%)',
   }}
  >
   <section className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900/95 p-6 text-slate-100 shadow-[0_24px_60px_-32px_rgba(15,23,42,0.35)] sm:p-8 lg:p-9">
    <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-100">
     Reset password
    </div>
    <h1 className="mt-4 text-2xl font-semibold tracking-tight text-white">Set a new password</h1>

    {isValidating ? <p className="mt-3 text-sm text-slate-300">Validating reset link...</p> : null}

    {!isValidating && !isTokenValid ? (
     <div className="mt-4 rounded-2xl border border-red-400/35 bg-red-500/10 px-4 py-3 text-sm text-red-200">This reset link is invalid or has expired.</div>
    ) : null}

    {!isValidating && isTokenValid ? (
     <form
      className="mt-6 space-y-4"
      onSubmit={(event) => void onSubmit(event)}
     >
      <div className="space-y-2">
       <label className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-300">New password</label>
       <input
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder="New password"
        className="w-full rounded-2xl border border-white/15 bg-slate-800 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-400 focus:border-cyan-300/70 focus:bg-slate-800 focus:ring-4 focus:ring-cyan-300/20"
        minLength={8}
        required
       />
      </div>

      <div className="space-y-2">
       <label className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-300">Confirm password</label>
       <input
        type="password"
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        placeholder="Confirm password"
        className="w-full rounded-2xl border border-white/15 bg-slate-800 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-400 focus:border-cyan-300/70 focus:bg-slate-800 focus:ring-4 focus:ring-cyan-300/20"
        minLength={8}
        required
       />
      </div>

      {error ? <p className="rounded-2xl border border-red-400/35 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p> : null}
      {success ? <p className="rounded-2xl border border-emerald-400/35 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</p> : null}

      <button
       type="submit"
       disabled={isSubmitting}
       className="inline-flex w-auto items-center justify-center rounded-2xl bg-blue-700 px-6 py-3 text-sm font-semibold text-white shadow-[0_14px_30px_-18px_rgba(29,78,216,0.9)] transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-70"
      >
       {isSubmitting ? 'Resetting...' : 'Reset password'}
      </button>
     </form>
    ) : null}

    <button
     type="button"
     onClick={() => router.push('/login')}
     className="mt-5 inline-flex text-sm font-medium text-blue-300 underline decoration-blue-500/50 underline-offset-4 transition hover:text-blue-200"
    >
     Back to sign in
    </button>
   </section>
  </main>
 );
}
