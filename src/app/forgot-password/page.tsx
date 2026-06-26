'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ForgotPasswordPage() {
 const router = useRouter();
 const [email, setEmail] = useState('');
 const [error, setError] = useState('');
 const [emailSent, setEmailSent] = useState(false);
 const [isSubmitting, setIsSubmitting] = useState(false);

 const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  setError('');
  setIsSubmitting(true);

  try {
   const response = await fetch('/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
   });

   const payload = (await response.json()) as { ok?: boolean; error?: string };

   if (!response.ok) {
    throw new Error(payload.error || 'Failed to request password reset.');
   }

   setEmailSent(true);
  } catch (requestError) {
   setError(requestError instanceof Error ? requestError.message : 'Failed to request password reset.');
  } finally {
   setIsSubmitting(false);
  }
 };

 if (emailSent) {
  return (
   <main className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
    <div className="w-full max-w-sm">
     <div className="mb-6 text-center">
      <div className="inline-flex items-center justify-center rounded bg-blue-800 px-4 py-2 mb-3">
       <span className="text-lg font-bold tracking-widest text-white">ARKAM</span>
      </div>
     </div>
     <section className="rounded border border-gray-300 bg-white p-8 shadow-md text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-4xl">
       ✉️
      </div>
      <h2 className="mb-2 text-base font-semibold text-gray-900">Check your inbox</h2>
      <p className="mb-1 text-sm text-gray-600">If an account exists for</p>
      <p className="mb-4 text-sm font-semibold text-gray-900 break-all">{email}</p>
      <p className="text-xs text-gray-400 mb-6">you will receive a password reset link. It expires in 1 hour.</p>
      <button
       type="button"
       onClick={() => router.push('/login')}
       className="text-sm text-blue-700 hover:underline"
      >
       Back to sign in
      </button>
     </section>
    </div>
   </main>
  );
 }

 return (
  <main className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
   <div className="w-full max-w-sm">
    <div className="mb-6 text-center">
     <div className="inline-flex items-center justify-center rounded bg-blue-800 px-4 py-2 mb-3">
      <span className="text-lg font-bold tracking-widest text-white">ARKAM</span>
     </div>
    </div>
    <section className="rounded border border-gray-300 bg-white shadow-md">
     <div className="border-b border-gray-200 bg-gray-50 px-5 py-3">
      <h2 className="text-sm font-semibold text-gray-700">Forgot Password</h2>
     </div>
     <div className="p-5">
      <p className="mb-4 text-sm text-gray-600">Enter your account email and we will send you a reset link.</p>
      <form className="space-y-4" onSubmit={(event) => void onSubmit(event)}>
       <div>
        <label className="mb-1 block text-xs font-semibold text-gray-600">Email</label>
        <input
         type="email"
         value={email}
         onChange={(event) => setEmail(event.target.value)}
         placeholder="Email"
         className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
         required
        />
       </div>

       {error ? <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

       <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
       >
        {isSubmitting ? 'Sending reset link…' : 'Send reset link'}
       </button>
      </form>

      <div className="mt-4 border-t border-gray-200 pt-4 text-center">
       <button
        type="button"
        onClick={() => router.push('/login')}
        className="text-sm text-blue-700 transition hover:text-blue-900 hover:underline"
       >
        Back to sign in
       </button>
      </div>
     </div>
    </section>
   </div>
  </main>
 );
}
