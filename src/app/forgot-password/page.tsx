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
  <main className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
   <div className="w-full max-w-sm">
    <div className="mb-6 text-center">
     <div className="inline-flex items-center justify-center rounded bg-blue-800 px-4 py-2 mb-3">
      <span className="text-lg font-bold tracking-widest text-white">ARKAM</span>
     </div>
    </div>
    <section className="rounded border border-gray-300 bg-white shadow-md">
     <div className="border-b border-gray-200 bg-gray-50 px-5 py-3">
      <h2 className="text-sm font-semibold text-gray-700">Password Reset</h2>
     </div>
     <div className="p-5">
      <p className="mb-4 text-sm text-gray-600">Enter your account email and we will generate a reset link.</p>
      <form
       className="space-y-4"
       onSubmit={(event) => void onSubmit(event)}
      >
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
       {message ? <p className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700">{message}</p> : null}

       {resetUrl ? (
        <div className="rounded border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-800">
         <p className="font-semibold">Reset link:</p>
         <a
          href={resetUrl}
          className="mt-1 inline-flex break-all text-blue-700 underline underline-offset-4"
         >
          {resetUrl}
         </a>
        </div>
       ) : null}

       <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
       >
        {isSubmitting ? 'Generating...' : 'Generate reset link'}
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
