'use client';

import { FormEvent, useEffect, useState } from 'react';
import { getProviders, signIn, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export default function SignupPage() {
 const router = useRouter();
 const { status } = useSession();

 const [fullName, setFullName] = useState('');
 const [email, setEmail] = useState('');
 const [error, setError] = useState('');
 const [isSubmitting, setIsSubmitting] = useState(false);
 const [isGoogleEnabled, setIsGoogleEnabled] = useState(false);
 const [emailSent, setEmailSent] = useState(false);

 useEffect(() => {
  if (status === 'authenticated') {
   router.replace('/');
  }
 }, [status, router]);

 useEffect(() => {
  let isMounted = true;
  const loadProviders = async () => {
   try {
    const providers = await getProviders();
    if (!isMounted) return;
    setIsGoogleEnabled(Boolean(providers?.google));
   } catch {
    if (!isMounted) return;
    setIsGoogleEnabled(false);
   }
  };
  void loadProviders();
  return () => {
   isMounted = false;
  };
 }, []);

 if (status === 'authenticated') {
  return (
   <main className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
    <div className="w-full max-w-sm">
     <div className="mb-6 text-center">
      <div className="inline-flex items-center justify-center rounded bg-blue-800 px-4 py-2 mb-3">
       <span className="text-lg font-bold tracking-widest text-white">ARKAM</span>
      </div>
     </div>
     <section className="rounded border border-gray-300 bg-white p-6 shadow-md">
      <h2 className="mb-4 text-sm font-semibold text-gray-700">You are already signed in.</h2>
      <div className="flex flex-wrap gap-2">
       <button
        type="button"
        onClick={() => router.push('/')}
        className="rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800"
       >
        Go to Dashboard
       </button>
      </div>
     </section>
    </div>
   </main>
  );
 }

 const onSubmit = async (event: FormEvent) => {
  event.preventDefault();
  setError('');
  setIsSubmitting(true);
  try {
   const res = await fetch('/api/auth/signup/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: fullName, email }),
   });
   const payload = (await res.json()) as { ok?: boolean; error?: string };
   if (!res.ok || !payload.ok) {
    throw new Error(payload.error || 'Failed to send verification email.');
   }
   setEmailSent(true);
  } catch (err) {
   setError(err instanceof Error ? err.message : 'Something went wrong.');
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
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-4xl">✉️</div>
      <h2 className="mb-2 text-base font-semibold text-gray-900">Check your inbox</h2>
      <p className="mb-1 text-sm text-gray-600">We sent a verification link to</p>
      <p className="mb-5 text-sm font-semibold text-gray-900 break-all">{email}</p>
      <p className="text-xs text-gray-400 mb-5">Click the link in the email to finish setting up your account. It expires in 24 hours.</p>
      <button
       type="button"
       onClick={() => {
        setEmailSent(false);
        setError('');
       }}
       className="text-sm text-blue-700 hover:underline"
      >
       Wrong email? Go back
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
     <p className="text-sm text-gray-500">Create your account</p>
    </div>

    <section className="rounded border border-gray-300 bg-white shadow-md">
     <div className="border-b border-gray-200 bg-gray-50 px-5 py-3 flex items-center justify-between">
      <h2 className="text-sm font-semibold text-gray-700">Sign Up</h2>
      <button
       type="button"
       onClick={() => router.push('/login')}
       className="text-sm text-blue-700 transition hover:text-blue-900 hover:underline"
      >
       Sign in
      </button>
     </div>

     <div className="p-5 space-y-4">
      {isGoogleEnabled ? (
       <>
        <button
         type="button"
         onClick={() => {
          setError('');
          void signIn('google', { callbackUrl: '/' });
         }}
         className="inline-flex w-full items-center justify-center gap-2 rounded border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50"
        >
         <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-blue-600 text-xs font-bold text-white">G</span>
         Continue with Google
        </button>
        <div className="flex items-center gap-3 text-xs text-gray-400">
         <span className="h-px flex-1 bg-gray-200" />
         <span>or</span>
         <span className="h-px flex-1 bg-gray-200" />
        </div>
       </>
      ) : null}

      <form
       className="space-y-4"
       onSubmit={(e) => void onSubmit(e)}
      >
       <div>
        <label className="mb-1 block text-xs font-semibold text-gray-600">Full name</label>
        <input
         type="text"
         value={fullName}
         onChange={(e) => setFullName(e.target.value)}
         placeholder="Full name"
         className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
         required
        />
       </div>
       <div>
        <label className="mb-1 block text-xs font-semibold text-gray-600">Email</label>
        <input
         type="email"
         value={email}
         onChange={(e) => setEmail(e.target.value)}
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
        {isSubmitting ? 'Sending verification email…' : 'Continue'}
       </button>
      </form>

      <div className="border-t border-gray-200 pt-4 text-center">
       <button
        type="button"
        onClick={() => router.push('/login')}
        className="text-sm text-blue-700 transition hover:text-blue-900 hover:underline"
       >
        Already have an account? Sign in
       </button>
      </div>
     </div>
    </section>
   </div>
  </main>
 );
}
