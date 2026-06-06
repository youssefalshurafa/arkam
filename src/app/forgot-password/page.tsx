'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ForgotPasswordPage() {
 const router = useRouter();
 const [email, setEmail] = useState('');
 const [error, setError] = useState('');
 const [message, setMessage] = useState('');
 const [resetUrl, setResetUrl] = useState('');
 const [isSubmitting, setIsSubmitting] = useState(false);

 const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  setError('');
  setMessage('');
  setResetUrl('');
  setIsSubmitting(true);

  try {
   const response = await fetch('/api/auth/forgot-password', {
    method: 'POST',
    headers: {
     'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
   });

   const payload = (await response.json()) as { message?: string; error?: string; resetUrl?: string | null };

   if (!response.ok) {
    throw new Error(payload.error || 'Failed to request password reset.');
   }

   setMessage(payload.message || 'If the email exists, a reset link was created.');
   if (payload.resetUrl) {
    setResetUrl(payload.resetUrl);
   }
  } catch (requestError) {
   setError(requestError instanceof Error ? requestError.message : 'Failed to request password reset.');
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
     Password reset
    </div>
    <h1 className="mt-4 text-2xl font-semibold tracking-tight text-white">Forgot your password?</h1>
    <p className="mt-2 text-sm leading-6 text-slate-300">Enter your account email and we will generate a reset link.</p>

    <form
     className="mt-6 space-y-4"
     onSubmit={(event) => void onSubmit(event)}
    >
     <div className="space-y-2">
      <label className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-300">Email</label>
      <input
       type="email"
       value={email}
       onChange={(event) => setEmail(event.target.value)}
       placeholder="Email"
       className="w-full rounded-2xl border border-white/15 bg-slate-800 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-400 focus:border-cyan-300/70 focus:bg-slate-800 focus:ring-4 focus:ring-cyan-300/20"
       required
      />
     </div>

     {error ? <p className="rounded-2xl border border-red-400/35 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p> : null}
     {message ? <p className="rounded-2xl border border-emerald-400/35 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{message}</p> : null}

     {resetUrl ? (
      <div className="rounded-2xl border border-cyan-300/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
       <p className="font-medium">Reset link generated:</p>
       <a
        href={resetUrl}
        className="mt-2 inline-flex break-all text-cyan-200 underline underline-offset-4"
       >
        {resetUrl}
       </a>
      </div>
     ) : null}

     <button
      type="submit"
      disabled={isSubmitting}
      className="inline-flex w-auto items-center justify-center rounded-2xl bg-blue-700 px-6 py-3 text-sm font-semibold text-white shadow-[0_14px_30px_-18px_rgba(29,78,216,0.9)] transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-70"
     >
      {isSubmitting ? 'Generating...' : 'Generate reset link'}
     </button>
    </form>

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
