'use client';

import { FormEvent, useEffect, useState } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { accountingApi } from '@/lib/accountingApi';
import { Suspense } from 'react';

type VerifyResponse = {
 ok: true;
 email: string;
 name: string;
};

type CompleteResponse = {
 ok: true;
 user: { id: string; email: string; name: string };
 defaultWorkspaceId: string | null;
};

function CompleteForm() {
 const router = useRouter();
 const searchParams = useSearchParams();
 const { status } = useSession();
 const token = searchParams.get('token') ?? '';

 const [tokenState, setTokenState] = useState<'loading' | 'valid' | 'invalid'>('loading');
 const [verifiedEmail, setVerifiedEmail] = useState('');
 const [verifiedName, setVerifiedName] = useState('');
 const [password, setPassword] = useState('');
 const [showPassword, setShowPassword] = useState(false);
 const [error, setError] = useState('');
 const [isSubmitting, setIsSubmitting] = useState(false);

 useEffect(() => {
  if (status === 'authenticated') {
   router.replace('/');
  }
 }, [status, router]);

 useEffect(() => {
  if (!token) {
   setTokenState('invalid');
   return;
  }

  let isMounted = true;

  const check = async () => {
   try {
    const res = await fetch(`/api/auth/signup/verify?token=${encodeURIComponent(token)}`);
    if (!isMounted) return;

    if (res.ok) {
     const data = (await res.json()) as VerifyResponse;
     setVerifiedEmail(data.email);
     setVerifiedName(data.name);
     setTokenState('valid');
    } else {
     setTokenState('invalid');
    }
   } catch {
    if (!isMounted) return;
    setTokenState('invalid');
   }
  };

  void check();

  return () => {
   isMounted = false;
  };
 }, [token]);

 const onSubmit = async (event: FormEvent) => {
  event.preventDefault();
  setError('');
  setIsSubmitting(true);

  try {
   const res = await fetch('/api/auth/signup/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password }),
   });

   const payload = (await res.json()) as CompleteResponse | { error?: string };

   if (!res.ok || !('ok' in payload)) {
    throw new Error(('error' in payload && payload.error) || 'Failed to create account.');
   }

   if ('defaultWorkspaceId' in payload && payload.defaultWorkspaceId) {
    accountingApi.setActiveWorkspaceId(payload.defaultWorkspaceId);
   }

   const signInResult = await signIn('credentials', {
    email: verifiedEmail,
    password,
    redirect: false,
   });

   if (!signInResult || signInResult.error) {
    throw new Error('Account created! Please sign in.');
   }

   router.push('/');
   router.refresh();
  } catch (err) {
   setError(err instanceof Error ? err.message : 'Something went wrong.');
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
     <p className="text-sm text-gray-500">Complete your account</p>
    </div>

    <section className="rounded border border-gray-300 bg-white shadow-md">
     <div className="border-b border-gray-200 bg-gray-50 px-5 py-3">
      <h2 className="text-sm font-semibold text-gray-700">Create a password</h2>
     </div>

     <div className="p-5">
      {tokenState === 'loading' && (
       <div className="flex items-center justify-center py-8">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
       </div>
      )}

      {tokenState === 'invalid' && (
       <div className="text-center py-6">
        <p className="text-sm text-red-600 mb-4">This link is invalid or has expired. Please sign up again.</p>
        <button
         onClick={() => router.push('/signup')}
         className="rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800"
        >
         Back to sign up
        </button>
       </div>
      )}

      {tokenState === 'valid' && (
       <>
        {/* Verified identity banner */}
        <div className="mb-5 flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
         <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#16a34a"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0"
         >
          <polyline points="20 6 9 17 4 12" />
         </svg>
         <div className="min-w-0">
          <p className="text-xs font-semibold text-green-800 truncate">{verifiedName}</p>
          <p className="text-xs text-green-700 truncate">{verifiedEmail}</p>
         </div>
        </div>

        <form
         className="space-y-4"
         onSubmit={(e) => void onSubmit(e)}
        >
         <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">Password</label>
          <div className="relative">
           <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (min 8 characters)"
            className="w-full rounded border border-gray-300 px-3 py-2 pr-10 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            minLength={8}
            required
            autoFocus
           />
           <button
            type="button"
            onClick={() => setShowPassword((c) => !c)}
            className="absolute inset-y-0 right-0 inline-flex w-9 items-center justify-center text-gray-400 transition hover:text-gray-600"
           >
            <svg
             xmlns="http://www.w3.org/2000/svg"
             viewBox="0 0 24 24"
             fill="none"
             stroke="currentColor"
             strokeWidth="2"
             width="16"
             height="16"
             aria-hidden="true"
            >
             {showPassword ? (
              <>
               <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 3l18 18"
               />
               <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.58 10.58a2 2 0 102.83 2.83"
               />
              </>
             ) : (
              <>
               <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.56 11.38C3.94 7.57 7.64 4.88 12 4.88s8.06 2.69 9.44 6.5c-1.38 3.81-5.08 6.5-9.44 6.5s-8.06-2.69-9.44-6.5z"
               />
               <circle
                cx="12"
                cy="11.38"
                r="3"
               />
              </>
             )}
            </svg>
           </button>
          </div>
         </div>

         {error && <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

         <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
         >
          {isSubmitting ? 'Creating account…' : 'Create account'}
         </button>
        </form>
       </>
      )}
     </div>
    </section>
   </div>
  </main>
 );
}

export default function SignupCompletePage() {
 return (
  <Suspense>
   <CompleteForm />
  </Suspense>
 );
}
