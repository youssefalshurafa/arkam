'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { getProviders, signIn, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { accountingApi } from '@/lib/accountingApi';

type SignupResponse = {
 ok: true;
 defaultWorkspaceId: string | null;
};

export default function SignupPage() {
 const router = useRouter();
 const { status } = useSession();

 const [fullName, setFullName] = useState('');
 const [workspaceName, setWorkspaceName] = useState('');
 const [email, setEmail] = useState('');
 const [password, setPassword] = useState('');
 const [showPassword, setShowPassword] = useState(false);
 const [error, setError] = useState('');
 const [isSubmitting, setIsSubmitting] = useState(false);
 const [isGoogleEnabled, setIsGoogleEnabled] = useState(false);

 const inferredWorkspaceName = useMemo(() => {
  const trimmed = fullName.trim();
  return trimmed ? `${trimmed} Workspace` : '';
 }, [fullName]);

 useEffect(() => {
  let isMounted = true;

  const loadProviders = async () => {
   try {
    const providers = await getProviders();
    if (!isMounted) {
     return;
    }
    setIsGoogleEnabled(Boolean(providers?.google));
   } catch {
    if (!isMounted) {
     return;
    }
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
      <p className="mb-4 text-sm text-gray-600">Continue to your workspace.</p>
      <div className="flex flex-wrap gap-2">
       <button
        type="button"
        onClick={() => router.push('/')}
        className="rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800"
       >
        Go to Dashboard
       </button>
       <button
        type="button"
        onClick={() => router.push('/login')}
        className="rounded border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
       >
        Back to login
       </button>
      </div>
     </section>
    </div>
   </main>
  );
 }

 const onSignup = async (event: FormEvent) => {
  event.preventDefault();
  setError('');
  setIsSubmitting(true);

  try {
   const response = await fetch('/api/auth/signup', {
    method: 'POST',
    headers: {
     'Content-Type': 'application/json',
    },
    body: JSON.stringify({
     name: fullName,
     email,
     password,
     workspaceName: workspaceName.trim() || inferredWorkspaceName,
    }),
   });

   const payload = (await response.json()) as SignupResponse | { error?: string };

   if (!response.ok || !('ok' in payload && payload.ok)) {
    throw new Error(('error' in payload && payload.error) || 'Signup failed.');
   }

   if (payload.defaultWorkspaceId) {
    accountingApi.setActiveWorkspaceId(payload.defaultWorkspaceId);
   }

   const signInResult = await signIn('credentials', {
    email,
    password,
    redirect: false,
   });

   if (!signInResult || signInResult.error) {
    throw new Error(signInResult?.error || 'Account created but sign in failed.');
   }

   router.push('/');
   router.refresh();
  } catch (signupError) {
   setError(signupError instanceof Error ? signupError.message : 'Signup failed.');
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
       onSubmit={(event) => void onSignup(event)}
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
       <div>
        <label className="mb-1 block text-xs font-semibold text-gray-600">Password</label>
        <div className="relative">
         <input
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password (min 8 chars)"
          className="w-full rounded border border-gray-300 px-3 py-2 pr-10 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          minLength={8}
          required
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
       <div>
        <label className="mb-1 block text-xs font-semibold text-gray-600">Workspace name</label>
        <input
         type="text"
         value={workspaceName}
         onChange={(e) => setWorkspaceName(e.target.value)}
         placeholder={inferredWorkspaceName || 'Workspace name'}
         className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
       </div>

       {error ? <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

       <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
       >
        {isSubmitting ? 'Creating account...' : 'Create account'}
       </button>
      </form>

      <div className="border-t border-gray-200 pt-4 text-center">
       <button
        type="button"
        onClick={() => {
         if (!email || !password) {
          setError('Enter email and password first, then click Sign in.');
          return;
         }
         void signIn('credentials', { email, password, callbackUrl: '/' });
        }}
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
